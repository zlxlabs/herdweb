import { type NotifyEvent, type NotifyTaskRole, PRESENCE_FRESH_MS } from './events'

export type { NotifyTaskRole }

export const DONE_COALESCE_MS = 600_000
export const PRESENCE_DEFER_MS = 300_000

export type OutboundDecision =
	| { action: 'send-now' }
	| { action: 'withhold'; reason: 'not-attention' | 'child-done' }
	| { action: 'coalesce'; reason: 'done-coalesced' }
	| { action: 'defer'; reason: 'user-present' }

export function coalesceSessionKey(event: NotifyEvent): string {
	return event.session ?? 'default'
}

/**
 * True when the event carries a `likely-present` signal that is still fresh:
 * no `presenceAt`, at most PRESENCE_FRESH_MS old, or a future timestamp.
 * A stale `presenceAt` downgrades the signal to `unknown`.
 */
export function isFreshLikelyPresent(event: NotifyEvent, now: number): boolean {
	if (event.presence !== 'likely-present') return false
	if (event.presenceAt === undefined) return true
	if (event.presenceAt > now) return true
	return now - event.presenceAt <= PRESENCE_FRESH_MS
}

/**
 * Gate order: silence/patrol withholds -> child-done withholds -> presence defer ->
 * existing role rules. `ignorePresence` skips the defer lane for the second
 * pass after a deferred event is released.
 */
export function decideOutbound(
	event: NotifyEvent,
	opts: { awayMode: boolean; now: number; ignorePresence?: boolean },
): OutboundDecision {
	if (event.kind === 'silence' || event.kind === 'patrol') {
		return { action: 'withhold', reason: 'not-attention' }
	}
	if (event.kind === 'done' && event.role === 'child') {
		return { action: 'withhold', reason: 'child-done' }
	}
	if (!opts.awayMode && opts.ignorePresence !== true && isFreshLikelyPresent(event, opts.now)) {
		return { action: 'defer', reason: 'user-present' }
	}
	if (event.kind !== 'done') {
		return { action: 'send-now' }
	}
	if (event.role === 'root') {
		return { action: 'send-now' }
	}
	return { action: 'coalesce', reason: 'done-coalesced' }
}
