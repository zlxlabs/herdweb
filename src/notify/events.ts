export const NOTIFY_KINDS = ['asking', 'done', 'ci-red', 'silence', 'health', 'test'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]

export interface NotifyEvent {
	readonly v: 1
	readonly id: string
	readonly kind: NotifyKind
	readonly session?: string
	readonly title: string
	readonly body?: string
	readonly reason?: string
	readonly ts: number
}

const ALLOWED_FIELDS = new Set(['v', 'id', 'kind', 'session', 'title', 'body', 'reason', 'ts'])
const MAX_RAW_BYTES = 4 * 1024
const TITLE_MAX = 120
const BODY_MAX = 200
const REASON_MAX = 120

export class NotifyEventError extends Error {
	readonly statusCode: 400 | 413

	constructor(message: string, statusCode: 400 | 413) {
		super(message)
		this.name = 'NotifyEventError'
		this.statusCode = statusCode
	}
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value
	return value.slice(0, max)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNotifyKind(value: unknown): value is NotifyKind {
	if (typeof value !== 'string') return false
	return NOTIFY_KINDS.some((kind) => kind === value)
}

/** Parse and validate a v1 notify event JSON string. Throws NotifyEventError on 400/413. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: table-driven validation is intentionally explicit
export function parseNotifyEvent(raw: string): NotifyEvent {
	if (Buffer.byteLength(raw, 'utf8') > MAX_RAW_BYTES) {
		throw new NotifyEventError('payload too large', 413)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new NotifyEventError('invalid JSON', 400)
	}

	if (!isRecord(parsed)) {
		throw new NotifyEventError('invalid event object', 400)
	}

	const obj = parsed
	for (const key of Object.keys(obj)) {
		if (!ALLOWED_FIELDS.has(key)) {
			throw new NotifyEventError(`unknown field: ${key}`, 400)
		}
	}

	if (obj.v !== 1) {
		throw new NotifyEventError('unsupported event version', 400)
	}

	if (!isNotifyKind(obj.kind)) {
		throw new NotifyEventError('invalid kind', 400)
	}

	if (typeof obj.title !== 'string') {
		throw new NotifyEventError('title must be a string', 400)
	}

	if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) {
		throw new NotifyEventError('ts must be a finite number', 400)
	}

	if (obj.id !== undefined && typeof obj.id !== 'string') {
		throw new NotifyEventError('id must be a string', 400)
	}

	if (obj.session !== undefined && typeof obj.session !== 'string') {
		throw new NotifyEventError('session must be a string', 400)
	}

	if (obj.body !== undefined && typeof obj.body !== 'string') {
		throw new NotifyEventError('body must be a string', 400)
	}

	if (obj.reason !== undefined && typeof obj.reason !== 'string') {
		throw new NotifyEventError('reason must be a string', 400)
	}

	const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : undefined
	if (obj.kind !== 'test' && id === undefined) {
		throw new NotifyEventError('id is required', 400)
	}

	const event: NotifyEvent = {
		v: 1,
		id: id ?? '',
		kind: obj.kind,
		title: truncate(obj.title, TITLE_MAX),
		ts: obj.ts,
	}

	if (obj.session !== undefined) {
		return {
			...event,
			session: obj.session,
			...(obj.body !== undefined ? { body: truncate(obj.body, BODY_MAX) } : {}),
			...(obj.reason !== undefined ? { reason: truncate(obj.reason, REASON_MAX) } : {}),
		}
	}

	return {
		...event,
		...(obj.body !== undefined ? { body: truncate(obj.body, BODY_MAX) } : {}),
		...(obj.reason !== undefined ? { reason: truncate(obj.reason, REASON_MAX) } : {}),
	}
}
