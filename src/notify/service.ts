import webpush from 'web-push'
import type { NotifyChannel } from '../types'
import { DONE_COALESCE_MS, coalesceSessionKey, decideOutbound } from './attention-policy'
import { sendNotifyChannels } from './channels'
import { type NotifyDecisionReason, logNotifyDecision } from './decision-log'
import {
	type NotifyEvent,
	isRecord,
	targetIdForNotifyEvent,
	validateNotifyEventForMode,
} from './events'
import {
	type PushSubscriptionRecord,
	STALE_SUBSCRIPTION_MS,
	type VapidConfig,
	type VapidKeys,
	ensureVapidKeys,
	readSubscriptions,
	writeSubscriptions,
} from './push'
import { appendEventLine } from './state'

const PUSH_TTL_SECONDS = 3600
const STALE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000

function readStatusCode(error: unknown): number | undefined {
	if (!isRecord(error) || typeof error.statusCode !== 'number') return undefined
	return error.statusCode
}

function isSubscriptionGoneReason(reason: unknown): reason is { endpoint: string } {
	return isRecord(reason) && typeof reason.endpoint === 'string'
}

function formatEndpointForLog(endpoint: string): string {
	try {
		return new URL(endpoint).host
	} catch {
		return endpoint.slice(0, 40)
	}
}

interface NotifyServiceDeps {
	readonly stateDir: string
	readonly historyLimit: number
	readonly targetMode?: 'single' | 'explicit'
	readonly targetIds?: readonly string[]
	readonly vapidOverride?: VapidConfig
	readonly sendPush?: typeof webpush.sendNotification
	readonly channels?: readonly NotifyChannel[]
	readonly now?: () => number
}

interface SubscriptionDelta {
	readonly snapshot: PushSubscriptionRecord
	readonly lastSuccessAt?: number
	readonly remove: boolean
}

function acceptedReasonFor(event: NotifyEvent): NotifyDecisionReason | undefined {
	if (event.kind === 'silence') return 'armed-quiet'
	if (event.kind === 'health') {
		return event.reason !== undefined ? 'session-end' : 'service-restart'
	}
	return undefined
}

function logAcceptedDecision(event: NotifyEvent): void {
	logNotifyDecision({
		outcome: 'accepted',
		kind: event.kind,
		id: event.id,
		reason: acceptedReasonFor(event),
	})
}

function sameSubscriptionRecord(
	left: PushSubscriptionRecord,
	right: PushSubscriptionRecord,
): boolean {
	return (
		left.endpoint === right.endpoint &&
		left.keys.p256dh === right.keys.p256dh &&
		left.keys.auth === right.keys.auth &&
		left.lastSuccessAt === right.lastSuccessAt
	)
}

/** Apply delivery/prune deltas to the newest on-disk subscription ledger. */
function mergeSubscriptionDeltas(
	stateDir: string,
	deltas: ReadonlyMap<string, SubscriptionDelta>,
): void {
	if (deltas.size === 0) return

	const latest = readSubscriptions(stateDir)
	const merged = latest.flatMap((sub) => {
		const delta = deltas.get(sub.endpoint)
		if (delta === undefined || !sameSubscriptionRecord(sub, delta.snapshot)) {
			return [sub]
		}
		if (delta.remove) return []
		return [{ ...sub, lastSuccessAt: delta.lastSuccessAt ?? sub.lastSuccessAt }]
	})
	writeSubscriptions(stateDir, merged)
}

export interface NotifyService {
	dispatchEvent(event: NotifyEvent): 'accepted' | 'duplicate'
	awaitInFlight(timeoutMs: number): Promise<void>
	lastEventAt(targetId: string, session?: string): number | undefined
	dispose(): void
}

class DedupStore {
	private readonly ids = new Set<string>()
	private readonly fifo: string[] = []
	private readonly capacity: number

	constructor(capacity: number) {
		this.capacity = capacity
	}

	has(id: string): boolean {
		return this.ids.has(id)
	}

	add(id: string): void {
		if (this.ids.has(id)) return
		this.ids.add(id)
		this.fifo.push(id)
		while (this.fifo.length > this.capacity) {
			const evicted = this.fifo.shift()
			if (evicted !== undefined) this.ids.delete(evicted)
		}
	}
}

export function createNotifyService(deps: NotifyServiceDeps): NotifyService {
	const now = deps.now ?? Date.now
	const targetMode = deps.targetMode ?? 'single'
	const targetIds = deps.targetIds ?? ['default']
	let testCounter = 0
	const dedup = new DedupStore(1000)
	const inFlight = new Set<Promise<void>>()
	const lastByIdentity = new Map<string, number>()
	let vapid: VapidKeys | undefined
	let staleScanTimer: ReturnType<typeof setInterval> | undefined
	const pendingCoalesce = new Map<
		string,
		{ event: NotifyEvent; timer: ReturnType<typeof setTimeout> }
	>()

	function ensureVapid(): VapidKeys {
		vapid ??= ensureVapidKeys(deps.stateDir, deps.vapidOverride)
		webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
		return vapid
	}

	function normalizeEvent(event: NotifyEvent): NotifyEvent {
		if (event.kind === 'test' && event.id.length === 0) {
			testCounter += 1
			return { ...event, id: `test:${testCounter}` }
		}
		return event
	}

	async function pushToAll(event: NotifyEvent): Promise<void> {
		ensureVapid()
		const subs = readSubscriptions(deps.stateDir)
		if (subs.length === 0) {
			console.log('herdweb: notify push skipped — no subscriptions')
			return
		}

		const payload = JSON.stringify(event)
		const send = deps.sendPush ?? webpush.sendNotification.bind(webpush)
		const results = await Promise.allSettled(
			subs.map(async (sub) => {
				try {
					await send(
						{
							endpoint: sub.endpoint,
							keys: sub.keys,
						},
						payload,
						{ TTL: PUSH_TTL_SECONDS },
					)
					return now()
				} catch (error: unknown) {
					const statusCode = readStatusCode(error)
					if (statusCode === 401 || statusCode === 404 || statusCode === 410) {
						throw Object.assign(new Error('subscription gone'), { endpoint: sub.endpoint })
					}
					throw error
				}
			}),
		)

		const deltas = new Map<string, SubscriptionDelta>()
		for (let i = 0; i < results.length; i++) {
			const result = results[i]
			const sub = subs[i]
			if (result === undefined || sub === undefined) continue
			if (result.status === 'fulfilled') {
				deltas.set(sub.endpoint, {
					snapshot: sub,
					lastSuccessAt: result.value,
					remove: false,
				})
				console.log(`herdweb: notify push delivered → ${formatEndpointForLog(sub.endpoint)}`)
			}
			if (result.status === 'rejected') {
				const reason = result.reason
				if (isSubscriptionGoneReason(reason)) {
					deltas.set(reason.endpoint, { snapshot: sub, remove: true })
					console.log(
						`herdweb: notify subscription removed (stale ) → ${formatEndpointForLog(reason.endpoint)}`,
					)
				}
			}
		}
		mergeSubscriptionDeltas(deps.stateDir, deltas)
	}

	function recordLastEvent(event: NotifyEvent): void {
		const targetId = targetIdForNotifyEvent(event)
		lastByIdentity.set(`${targetId}\u0000${event.session ?? ''}`, event.ts)
	}

	function pruneStaleSubscriptions(): void {
		if (inFlight.size > 0) return
		const subs = readSubscriptions(deps.stateDir)
		const cutoff = now() - STALE_SUBSCRIPTION_MS
		const deltas = new Map<string, SubscriptionDelta>()
		for (const sub of subs) {
			if (sub.lastSuccessAt < cutoff) {
				deltas.set(sub.endpoint, { snapshot: sub, remove: true })
			}
		}
		mergeSubscriptionDeltas(deps.stateDir, deltas)
	}

	staleScanTimer = setInterval(pruneStaleSubscriptions, STALE_SCAN_INTERVAL_MS)
	if (typeof staleScanTimer === 'object' && 'unref' in staleScanTimer) {
		staleScanTimer.unref()
	}

	function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
		if (typeof timer === 'object' && 'unref' in timer) timer.unref()
	}

	function deliverOutbound(event: NotifyEvent): void {
		logAcceptedDecision(event)
		const pushPromise = pushToAll(event)
			.catch((error: unknown) => {
				console.error('herdweb: notify push failed', error)
			})
			.finally(() => {
				inFlight.delete(pushPromise)
			})
		inFlight.add(pushPromise)
		if (deps.channels !== undefined && deps.channels.length > 0) {
			const channelPromise = sendNotifyChannels(deps.channels, event).finally(() => {
				inFlight.delete(channelPromise)
			})
			inFlight.add(channelPromise)
		}
	}

	function queueCoalesce(event: NotifyEvent): void {
		logNotifyDecision({
			outcome: 'skipped',
			kind: event.kind,
			id: event.id,
			reason: 'done-coalesced',
		})
		const key = coalesceSessionKey(event)
		const existing = pendingCoalesce.get(key)
		if (existing !== undefined) {
			clearTimeout(existing.timer)
		}
		const timer = setTimeout(() => {
			const current = pendingCoalesce.get(key)
			if (current === undefined) return
			pendingCoalesce.delete(key)
			deliverOutbound(current.event)
		}, DONE_COALESCE_MS)
		unrefTimer(timer)
		pendingCoalesce.set(key, { event, timer })
	}

	function flushAllCoalesced(): void {
		const pending = [...pendingCoalesce.values()]
		pendingCoalesce.clear()
		for (const item of pending) {
			clearTimeout(item.timer)
			deliverOutbound(item.event)
		}
	}

	return {
		dispatchEvent(event: NotifyEvent): 'accepted' | 'duplicate' {
			validateNotifyEventForMode(event, targetMode, targetIds)
			const normalized = normalizeEvent(event)
			const dedupKey = `${targetIdForNotifyEvent(normalized)}\u0000${normalized.id}`

			if (normalized.kind !== 'test') {
				if (dedup.has(dedupKey)) {
					logNotifyDecision({
						outcome: 'duplicate',
						kind: normalized.kind,
						id: normalized.id,
						reason: 'duplicate',
					})
					return 'duplicate'
				}
				dedup.add(dedupKey)
				appendEventLine(deps.stateDir, normalized, deps.historyLimit)
			}

			recordLastEvent(normalized)
			const decision = decideOutbound(normalized)
			if (decision.action === 'withhold') {
				logNotifyDecision({
					outcome: 'skipped',
					kind: normalized.kind,
					id: normalized.id,
					reason: decision.reason,
				})
				return 'accepted'
			}
			if (decision.action === 'coalesce') {
				queueCoalesce(normalized)
				return 'accepted'
			}
			deliverOutbound(normalized)
			return 'accepted'
		},

		async awaitInFlight(timeoutMs: number): Promise<void> {
			flushAllCoalesced()
			const pending = [...inFlight]
			if (pending.length === 0) return
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				await Promise.race([
					Promise.allSettled(pending),
					new Promise<void>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error(`notify drain timed out after ${timeoutMs}ms`)),
							timeoutMs,
						)
						timer.unref()
					}),
				])
			} finally {
				if (timer !== undefined) clearTimeout(timer)
			}
		},

		lastEventAt(targetId: string, session?: string): number | undefined {
			return lastByIdentity.get(`${targetId}\u0000${session ?? ''}`)
		},

		dispose(): void {
			flushAllCoalesced()
			if (staleScanTimer !== undefined) {
				clearInterval(staleScanTimer)
				staleScanTimer = undefined
			}
		},
	}
}

/** Drain hook for serve shutdown — card 2 inserts last-session / health here. */
export async function notifyDrain(service: NotifyService): Promise<void> {
	await service.awaitInFlight(10_000)
}
