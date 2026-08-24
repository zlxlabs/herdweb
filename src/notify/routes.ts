import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { NotifyEventError, isRecord, parseNotifyEvent, validateNotifyEventForMode } from './events'
import { parseHistoryLimitParam, readEventHistory } from './history'
import {
	type PushSubscriptionRecord,
	ensureVapidKeys,
	readSubscriptions,
	writeSubscriptions,
} from './push'
import { SlidingWindowRateLimiter } from './rate-limit'
import type { NotifyService } from './service'

const EVENTS_RATE_LIMIT = 60
const EVENTS_WINDOW_MS = 60_000

function isLoopbackAddress(address: string): boolean {
	return (
		address === '127.0.0.1' ||
		address === '::1' ||
		address === 'localhost' ||
		address === '::ffff:127.0.0.1'
	)
}

interface NotifyRouteDeps {
	readonly basePath: string
	readonly notifyService: NotifyService
	readonly stateDir: string
	readonly targetMode?: 'single' | 'explicit'
	readonly targetIds?: readonly string[]
	readonly token?: string
	readonly vapidOverride?: Parameters<typeof ensureVapidKeys>[1]
	readonly securityHeadersForRequest: (hostHeader: string | undefined) => Record<string, string>
	readonly routeVariants: (basePath: string, path: string) => readonly string[]
	readonly withSecurityHeaders: (response: Response, headers: Record<string, string>) => Response
	readonly isAllowedOrigin: (origin: string | undefined, host: string | undefined) => boolean
}

function isLoopbackRequest(c: Context): boolean {
	const info = getConnInfo(c)
	const address = info.remote.address ?? ''
	return isLoopbackAddress(address)
}

function checkBearerToken(c: Context, token: string | undefined): boolean {
	if (token === undefined || token.length === 0) return true
	const header = c.req.header('authorization')
	return header === `Bearer ${token}`
}

function deny(
	c: Context,
	deps: NotifyRouteDeps,
	securityHeaders: Record<string, string>,
	message: string,
	status: ContentfulStatusCode,
): Response {
	return deps.withSecurityHeaders(c.text(message, status), securityHeaders)
}

function requireOrigin(
	c: Context,
	deps: NotifyRouteDeps,
	securityHeaders: Record<string, string>,
): Response | null {
	if (!deps.isAllowedOrigin(c.req.header('origin'), c.req.header('host'))) {
		return deny(c, deps, securityHeaders, 'Forbidden', 403)
	}
	return null
}

interface PushSubscribeBody {
	readonly endpoint?: unknown
	readonly keys?: { readonly p256dh?: unknown; readonly auth?: unknown }
}

function isPushSubscribeBody(value: unknown): value is PushSubscribeBody {
	return isRecord(value)
}

function isUnsubscribeBody(value: unknown): value is { readonly endpoint?: unknown } {
	return isRecord(value)
}

async function readJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		return null
	}
}

function parseSubscriptionBody(body: PushSubscribeBody): PushSubscriptionRecord | null {
	if (typeof body.endpoint !== 'string' || body.endpoint.length === 0) return null
	if (
		typeof body.keys?.p256dh !== 'string' ||
		body.keys.p256dh.length === 0 ||
		typeof body.keys?.auth !== 'string' ||
		body.keys.auth.length === 0
	) {
		return null
	}
	return {
		endpoint: body.endpoint,
		keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
		lastSuccessAt: Date.now(),
	}
}

/** Register notify HTTP routes on every base-path variant. */
export function registerNotifyRoutes(app: Hono, deps: NotifyRouteDeps): void {
	const targetMode = deps.targetMode ?? 'single'
	const targetIds = deps.targetIds ?? ['default']
	const eventsLimiter = new SlidingWindowRateLimiter(EVENTS_RATE_LIMIT, EVENTS_WINDOW_MS)
	const pushLimiter = new SlidingWindowRateLimiter(EVENTS_RATE_LIMIT, EVENTS_WINDOW_MS)

	for (const route of deps.routeVariants(deps.basePath, '/api/events')) {
		app.post(route, async (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			if (!isLoopbackRequest(c)) {
				return deny(c, deps, securityHeaders, 'Forbidden', 403)
			}
			if (!checkBearerToken(c, deps.token)) {
				return deny(c, deps, securityHeaders, 'Unauthorized', 401)
			}
			if (!eventsLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}

			const raw = await c.req.text()
			let event: ReturnType<typeof parseNotifyEvent>
			try {
				event = parseNotifyEvent(raw)
				validateNotifyEventForMode(event, targetMode, targetIds)
			} catch (error) {
				if (error instanceof NotifyEventError) {
					return deny(c, deps, securityHeaders, error.message, error.statusCode)
				}
				return deny(c, deps, securityHeaders, 'invalid event', 400)
			}

			deps.notifyService.dispatchEvent(event)
			return deps.withSecurityHeaders(c.body(null, 202), securityHeaders)
		})
	}

	for (const route of deps.routeVariants(deps.basePath, '/api/events/history')) {
		app.get(route, (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			if (!pushLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}
			const requestedTargetId = c.req.query('targetId')
			const targetId =
				targetMode === 'single' ? (requestedTargetId ?? 'default') : requestedTargetId
			if (targetId === undefined || !targetIds.includes(targetId)) {
				return deny(c, deps, securityHeaders, 'unknown targetId', 400)
			}
			const limit = parseHistoryLimitParam(c.req.query('limit'))
			const events = readEventHistory(deps.stateDir, limit, targetId)
			return deps.withSecurityHeaders(c.json({ events }), securityHeaders)
		})
	}

	for (const route of deps.routeVariants(deps.basePath, '/api/push/vapid-key')) {
		app.get(route, (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			if (!pushLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}
			const keys = ensureVapidKeys(deps.stateDir, deps.vapidOverride)
			return deps.withSecurityHeaders(c.json({ publicKey: keys.publicKey }), securityHeaders)
		})
	}

	for (const route of deps.routeVariants(deps.basePath, '/api/push/test')) {
		app.post(route, (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			const denied = requireOrigin(c, deps, securityHeaders)
			if (denied) return denied
			if (!pushLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}

			const requestedTargetId = c.req.query('targetId')
			const targetId =
				targetMode === 'single' ? (requestedTargetId ?? 'default') : requestedTargetId
			if (!targetId || !targetIds.includes(targetId)) {
				return deny(c, deps, securityHeaders, 'unknown targetId', 400)
			}
			const event = parseNotifyEvent(
				JSON.stringify({
					v: targetMode === 'explicit' ? 2 : 1,
					...(targetMode === 'explicit' ? { targetId } : {}),
					kind: 'test',
					title: 'herdweb test',
					body: 'Test notification from panel',
					ts: Date.now(),
				}),
			)
			deps.notifyService.dispatchEvent(event)
			return deps.withSecurityHeaders(c.body(null, 202), securityHeaders)
		})
	}

	for (const route of deps.routeVariants(deps.basePath, '/api/push/subscribe')) {
		app.post(route, async (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			const denied = requireOrigin(c, deps, securityHeaders)
			if (denied) return denied
			if (!pushLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}

			const body = await readJsonBody(c)
			const record = isPushSubscribeBody(body) ? parseSubscriptionBody(body) : null
			if (!record) {
				return deny(c, deps, securityHeaders, 'invalid subscription', 400)
			}

			const subs = readSubscriptions(deps.stateDir)
			const existing = subs.findIndex((sub) => sub.endpoint === record.endpoint)
			if (existing >= 0) {
				const previous = subs[existing]
				subs[existing] = {
					...record,
					lastSuccessAt: previous?.lastSuccessAt ?? Date.now(),
				}
			} else {
				subs.push(record)
			}
			writeSubscriptions(deps.stateDir, subs)
			return deps.withSecurityHeaders(c.body(null, 201), securityHeaders)
		})
	}

	for (const route of deps.routeVariants(deps.basePath, '/api/push/subscription')) {
		app.delete(route, async (c) => {
			const securityHeaders = deps.securityHeadersForRequest(c.req.header('host'))
			const denied = requireOrigin(c, deps, securityHeaders)
			if (denied) return denied
			if (!pushLimiter.allow()) {
				return deny(c, deps, securityHeaders, 'Too Many Requests', 429)
			}

			const body = await readJsonBody(c)
			if (
				!isUnsubscribeBody(body) ||
				typeof body.endpoint !== 'string' ||
				body.endpoint.length === 0
			) {
				return deny(c, deps, securityHeaders, 'invalid subscription', 400)
			}

			const subs = readSubscriptions(deps.stateDir)
			const kept = subs.filter((sub) => sub.endpoint !== body.endpoint)
			if (kept.length !== subs.length) {
				writeSubscriptions(deps.stateDir, kept)
			}
			return deps.withSecurityHeaders(c.body(null, 204), securityHeaders)
		})
	}
}
