export const NOTIFY_KINDS = [
	'asking',
	'done',
	'ci-red',
	'silence',
	'health',
	'test',
	'patrol',
] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]
export type NotifyTaskRole = 'root' | 'child'
export type NotifyLevel = 'act_now' | 'act_soon' | 'collect' | 'fyi'

/**
 * Producer-side guess about whether the user is at the keyboard. The `likely-`
 * prefix marks it as an inference, not a fact; herdweb only consumes it on the
 * outbound gate. Absent or `unknown` means "no signal".
 */
export type NotifyPresence = 'likely-present' | 'likely-away' | 'unknown'

/** A `presenceAt` older than this many ms is stale and downgrades to `unknown`. */
export const PRESENCE_FRESH_MS = 120_000

/** Ingress lower bound for `ts`: values below this are Unix seconds (or earlier), not epoch ms. */
export const NOTIFY_TS_MIN_MS = 1_000_000_000_000

const NOTIFY_PRESENCE_VALUES = ['likely-present', 'likely-away', 'unknown'] as const
const NOTIFY_LEVEL_VALUES = ['act_now', 'act_soon', 'collect', 'fyi'] as const

function isNotifyPresence(value: unknown): value is NotifyPresence {
	return typeof value === 'string' && NOTIFY_PRESENCE_VALUES.some((p) => p === value)
}

function isNotifyLevel(value: unknown): value is NotifyLevel {
	return typeof value === 'string' && NOTIFY_LEVEL_VALUES.some((level) => level === value)
}

interface NotifyEventFields {
	readonly id: string
	readonly kind: NotifyKind
	readonly level?: NotifyLevel
	readonly session?: string
	readonly title: string
	readonly body?: string
	readonly contentMarkdown?: string
	readonly reason?: string
	readonly ts: number
	readonly role?: NotifyTaskRole
	readonly parentId?: string
	readonly startedAt?: number
	readonly presence?: NotifyPresence
	readonly presenceAt?: number
	readonly task_id?: string
	readonly dispatch_id?: string
	readonly drift?: string
}

export interface NotifyEventV1 extends NotifyEventFields {
	readonly v: 1
}

export interface NotifyEventV2 extends NotifyEventFields {
	readonly v: 2
	readonly targetId: string
}

export type NotifyEvent = NotifyEventV1 | NotifyEventV2

const ALLOWED_FIELDS = new Set([
	'v',
	'targetId',
	'id',
	'kind',
	'level',
	'session',
	'title',
	'body',
	'contentMarkdown',
	'reason',
	'ts',
	'role',
	'parentId',
	'startedAt',
	'presence',
	'presenceAt',
	'task_id',
	'dispatch_id',
	'drift',
])
const NOTIFY_TASK_ROLES = ['root', 'child'] as const

function isNotifyTaskRole(value: unknown): value is NotifyTaskRole {
	return typeof value === 'string' && NOTIFY_TASK_ROLES.some((role) => role === value)
}
const MAX_RAW_BYTES = 16 * 1024
const TITLE_MAX = 120
const BODY_MAX = 200
const REASON_MAX = 120
const CONTENT_MARKDOWN_MAX_BYTES = 4096

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

function truncateUtf8Bytes(value: string, maxBytes: number): string {
	const buf = Buffer.from(value, 'utf8')
	if (buf.byteLength <= maxBytes) return value
	let end = maxBytes
	while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) {
		end--
	}
	if (end > 0) {
		const leading = buf[end] ?? 0
		let seqLen = 1
		if ((leading & 0xe0) === 0xc0) seqLen = 2
		else if ((leading & 0xf0) === 0xe0) seqLen = 3
		else if ((leading & 0xf8) === 0xf0) seqLen = 4
		if (end + seqLen <= maxBytes) {
			end += seqLen
		}
	}
	return buf.subarray(0, end).toString('utf8')
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

	if (obj.v !== 1 && obj.v !== 2) {
		throw new NotifyEventError('unsupported event version', 400)
	}
	if (obj.v === 2 && (typeof obj.targetId !== 'string' || obj.targetId.length === 0)) {
		throw new NotifyEventError('targetId is required for v2', 400)
	}
	if (obj.v === 1 && obj.targetId !== undefined) {
		throw new NotifyEventError('targetId requires v2', 400)
	}

	if (!isNotifyKind(obj.kind)) {
		throw new NotifyEventError('invalid kind', 400)
	}

	if (obj.level !== undefined && !isNotifyLevel(obj.level)) {
		throw new NotifyEventError('invalid level', 400)
	}

	if (typeof obj.title !== 'string') {
		throw new NotifyEventError('title must be a string', 400)
	}

	if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) {
		throw new NotifyEventError('ts must be a finite number', 400)
	}
	if (obj.ts < NOTIFY_TS_MIN_MS) {
		throw new NotifyEventError('ts must be epoch milliseconds', 400)
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

	if (obj.contentMarkdown !== undefined && typeof obj.contentMarkdown !== 'string') {
		throw new NotifyEventError('contentMarkdown must be a string', 400)
	}

	if (obj.reason !== undefined && typeof obj.reason !== 'string') {
		throw new NotifyEventError('reason must be a string', 400)
	}

	if (obj.role !== undefined && !isNotifyTaskRole(obj.role)) {
		throw new NotifyEventError('invalid role', 400)
	}

	if (
		obj.parentId !== undefined &&
		(typeof obj.parentId !== 'string' || obj.parentId.length === 0)
	) {
		throw new NotifyEventError('parentId must be a non-empty string', 400)
	}

	if (
		obj.startedAt !== undefined &&
		(typeof obj.startedAt !== 'number' || !Number.isFinite(obj.startedAt))
	) {
		throw new NotifyEventError('startedAt must be a finite number', 400)
	}

	if (obj.presence !== undefined && !isNotifyPresence(obj.presence)) {
		throw new NotifyEventError('invalid presence', 400)
	}

	if (
		obj.presenceAt !== undefined &&
		(typeof obj.presenceAt !== 'number' || !Number.isFinite(obj.presenceAt))
	) {
		throw new NotifyEventError('presenceAt must be a finite number', 400)
	}

	if (obj.task_id !== undefined && typeof obj.task_id !== 'string') {
		throw new NotifyEventError('task_id must be a string', 400)
	}

	if (obj.dispatch_id !== undefined && typeof obj.dispatch_id !== 'string') {
		throw new NotifyEventError('dispatch_id must be a string', 400)
	}

	if (obj.drift !== undefined && typeof obj.drift !== 'string') {
		throw new NotifyEventError('drift must be a string', 400)
	}

	const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : undefined
	if (obj.kind !== 'test' && id === undefined) {
		throw new NotifyEventError('id is required', 400)
	}

	const fields = {
		id: id ?? '',
		kind: obj.kind,
		title: truncate(obj.title, TITLE_MAX),
		ts: obj.ts,
	}

	const optional = {
		...(isNotifyLevel(obj.level) ? { level: obj.level } : {}),
		...(obj.session !== undefined ? { session: obj.session } : {}),
		...(obj.body !== undefined ? { body: truncate(obj.body, BODY_MAX) } : {}),
		...(typeof obj.contentMarkdown === 'string'
			? { contentMarkdown: truncateUtf8Bytes(obj.contentMarkdown, CONTENT_MARKDOWN_MAX_BYTES) }
			: {}),
		...(obj.reason !== undefined ? { reason: truncate(obj.reason, REASON_MAX) } : {}),
		...(isNotifyTaskRole(obj.role) ? { role: obj.role } : {}),
		...(typeof obj.parentId === 'string' && obj.parentId.length > 0
			? { parentId: obj.parentId }
			: {}),
		...(typeof obj.startedAt === 'number' && Number.isFinite(obj.startedAt)
			? { startedAt: obj.startedAt }
			: {}),
		...(isNotifyPresence(obj.presence) ? { presence: obj.presence } : {}),
		...(typeof obj.presenceAt === 'number' && Number.isFinite(obj.presenceAt)
			? { presenceAt: obj.presenceAt }
			: {}),
		...(typeof obj.task_id === 'string' ? { task_id: obj.task_id } : {}),
		...(typeof obj.dispatch_id === 'string' ? { dispatch_id: obj.dispatch_id } : {}),
		...(typeof obj.drift === 'string' ? { drift: obj.drift } : {}),
	}

	return obj.v === 2
		? { v: 2, targetId: String(obj.targetId), ...fields, ...optional }
		: { v: 1, ...fields, ...optional }
}

export function targetIdForNotifyEvent(event: NotifyEvent): string {
	return event.v === 2 ? event.targetId : 'default'
}

export function validateNotifyEventForMode(
	event: NotifyEvent,
	targetMode: 'single' | 'explicit',
	targetIds: readonly string[],
): void {
	if (targetMode === 'single' && event.v !== 1) {
		throw new NotifyEventError('single mode requires v1', 400)
	}
	if (targetMode === 'explicit' && event.v !== 2) {
		throw new NotifyEventError('explicit mode requires v2', 400)
	}
	if (event.v === 2 && !targetIds.includes(event.targetId)) {
		throw new NotifyEventError('unknown targetId', 400)
	}
}
