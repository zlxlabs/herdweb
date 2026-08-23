import webpush from 'web-push'
import { type NotifyEvent, isRecord } from './events'
import {
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

interface NotifyServiceDeps {
	readonly stateDir: string
	readonly historyLimit: number
	readonly vapidOverride?: VapidConfig
	readonly sendPush?: typeof webpush.sendNotification
	readonly now?: () => number
}

export interface NotifyService {
	dispatchEvent(event: NotifyEvent): 'accepted' | 'duplicate'
	awaitInFlight(timeoutMs: number): Promise<void>
	lastEventAt(session?: string): number | undefined
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
	let testCounter = 0
	const dedup = new DedupStore(1000)
	const inFlight = new Set<Promise<void>>()
	const lastBySession = new Map<string, number>()
	let globalLastEventAt: number | undefined
	let vapid: VapidKeys | undefined
	let staleScanTimer: ReturnType<typeof setInterval> | undefined

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
		if (subs.length === 0) return

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
					sub.lastSuccessAt = now()
				} catch (error: unknown) {
					const statusCode = readStatusCode(error)
					if (statusCode === 401 || statusCode === 404 || statusCode === 410) {
						throw Object.assign(new Error('subscription gone'), { endpoint: sub.endpoint })
					}
					throw error
				}
			}),
		)

		const removed = new Set<string>()
		let deliverySucceeded = false
		for (const result of results) {
			if (result.status === 'fulfilled') {
				deliverySucceeded = true
			}
			if (result.status === 'rejected') {
				const reason = result.reason
				if (isSubscriptionGoneReason(reason)) {
					removed.add(reason.endpoint)
				}
			}
		}

		const kept = subs.filter((sub) => !removed.has(sub.endpoint))
		if (removed.size > 0 || deliverySucceeded) {
			writeSubscriptions(deps.stateDir, kept)
		}
	}

	function recordLastEvent(event: NotifyEvent): void {
		globalLastEventAt = event.ts
		if (event.session !== undefined) {
			lastBySession.set(event.session, event.ts)
		}
	}

	function pruneStaleSubscriptions(): void {
		if (inFlight.size > 0) return
		const subs = readSubscriptions(deps.stateDir)
		const cutoff = now() - STALE_SUBSCRIPTION_MS
		const kept = subs.filter((sub) => sub.lastSuccessAt >= cutoff)
		if (kept.length !== subs.length) {
			writeSubscriptions(deps.stateDir, kept)
		}
	}

	staleScanTimer = setInterval(pruneStaleSubscriptions, STALE_SCAN_INTERVAL_MS)
	if (typeof staleScanTimer === 'object' && 'unref' in staleScanTimer) {
		staleScanTimer.unref()
	}

	return {
		dispatchEvent(event: NotifyEvent): 'accepted' | 'duplicate' {
			const normalized = normalizeEvent(event)

			if (normalized.kind !== 'test') {
				if (dedup.has(normalized.id)) {
					return 'duplicate'
				}
				dedup.add(normalized.id)
				appendEventLine(deps.stateDir, normalized, deps.historyLimit)
			}

			recordLastEvent(normalized)
			const pushPromise = pushToAll(normalized)
				.catch((error: unknown) => {
					console.error('herdweb: notify push failed', error)
				})
				.finally(() => {
					inFlight.delete(pushPromise)
				})
			inFlight.add(pushPromise)
			return 'accepted'
		},

		async awaitInFlight(timeoutMs: number): Promise<void> {
			const pending = [...inFlight]
			if (pending.length === 0) return
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				await Promise.race([
					Promise.allSettled(pending),
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, timeoutMs)
						timer.unref()
					}),
				])
			} finally {
				if (timer !== undefined) clearTimeout(timer)
			}
		},

		lastEventAt(session?: string): number | undefined {
			if (session !== undefined) {
				return lastBySession.get(session)
			}
			return globalLastEventAt
		},

		dispose(): void {
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
