import type { NotifyEvent, NotifyTaskRole } from './events'

export type { NotifyTaskRole }

export const DONE_COALESCE_MS = 600_000

export type OutboundDecision =
	| { action: 'send-now' }
	| { action: 'withhold'; reason: 'not-attention' | 'child-done' }
	| { action: 'coalesce'; reason: 'done-coalesced' }

export function coalesceSessionKey(event: NotifyEvent): string {
	return event.session ?? 'default'
}

export function decideOutbound(event: NotifyEvent): OutboundDecision {
	if (event.kind === 'silence') {
		return { action: 'withhold', reason: 'not-attention' }
	}
	if (event.kind !== 'done') {
		return { action: 'send-now' }
	}
	if (event.role === 'child') {
		return { action: 'withhold', reason: 'child-done' }
	}
	if (event.role === 'root') {
		return { action: 'send-now' }
	}
	return { action: 'coalesce', reason: 'done-coalesced' }
}
