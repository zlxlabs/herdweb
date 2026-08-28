export type NotifyDecisionReason =
	| 'armed-quiet'
	| 'session-end'
	| 'service-restart'
	| 'cooldown'
	| 'lane-cooldown'
	| 'restart-gap'
	| 'duplicate'
	| 'not-loopback'
	| 'unauthorized'
	| 'rate-limited'
	| 'invalid-event'
	| 'payload-too-large'

export type NotifyDecisionOutcome = 'accepted' | 'skipped' | 'duplicate' | 'rejected'

export const NOTIFY_DECISION_REASONS = [
	'armed-quiet',
	'session-end',
	'service-restart',
	'cooldown',
	'lane-cooldown',
	'restart-gap',
	'duplicate',
	'not-loopback',
	'unauthorized',
	'rate-limited',
	'invalid-event',
	'payload-too-large',
] as const satisfies readonly NotifyDecisionReason[]

export const NOTIFY_DECISION_LOG_PREFIX = 'herdweb: notify decision'

export interface NotifyDecisionLog {
	readonly outcome: NotifyDecisionOutcome
	readonly reason?: NotifyDecisionReason
	readonly kind?: string
	readonly id?: string
	readonly bytes?: number
	readonly remainingMs?: number
	readonly armed?: boolean
	readonly status?: number
}

function appendField(
	parts: string[],
	key: string,
	value: string | number | boolean | undefined,
): void {
	if (value === undefined) return
	parts.push(`${key}=${value}`)
}

export function logNotifyDecision(entry: NotifyDecisionLog): void {
	const parts = [`${NOTIFY_DECISION_LOG_PREFIX} ${entry.outcome}`]
	appendField(parts, 'kind', entry.kind)
	appendField(parts, 'id', entry.id)
	appendField(parts, 'reason', entry.reason)
	appendField(parts, 'bytes', entry.bytes)
	appendField(parts, 'remainingMs', entry.remainingMs)
	appendField(parts, 'armed', entry.armed)
	appendField(parts, 'status', entry.status)
	console.log(parts.join(' '))
}
