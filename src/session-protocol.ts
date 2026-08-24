export interface InputMessage {
	readonly type: 'input'
	readonly data: string
}

export interface ResizeMessage {
	readonly type: 'resize'
	readonly cols: number
	readonly rows: number
}

export interface PingMessage {
	readonly type: 'ping'
	readonly id: string
}

export interface InputActionMessage {
	readonly type: 'input-action'
	readonly id: string
	readonly data: string
}

type TargetRequestFields = Readonly<Record<'requestId' | 'targetId', string>>
type AttachmentFields = TargetRequestFields & Readonly<Record<'attachmentId', string>>
type ProtocolMessage<Type extends string, Fields> = { readonly type: Type } & Fields

export type AttachTargetMessage = ProtocolMessage<
	'attach-target',
	TargetRequestFields & Readonly<Record<'cols' | 'rows', number>>
>

export type RestartTargetMessage = ProtocolMessage<'restart-target', TargetRequestFields>

export type SnapshotAppliedMessage = ProtocolMessage<
	'snapshot-applied',
	Readonly<Record<'requestId' | 'attachmentId', string>>
>

export type ClientMessage =
	| InputMessage
	| ResizeMessage
	| PingMessage
	| InputActionMessage
	| AttachTargetMessage
	| RestartTargetMessage
	| SnapshotAppliedMessage

export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024
export const MAX_CLIENT_INPUT_BYTES = 256 * 1024
export const MAX_PROTOCOL_ID_BYTES = 64
export const MAX_RESIZE_COLS = 500
export const MAX_RESIZE_ROWS = 200

export interface SnapshotMessage {
	readonly type: 'snapshot'
	readonly data: string
	readonly sessionId: string
	readonly outputWatermark: number
}

export interface OutputMessage {
	readonly type: 'output'
	readonly data: string
	readonly seq: number
}

export interface ExitMessage {
	readonly type: 'exit'
	readonly exitCode: number
	readonly signal: number | null
}

export interface ErrorMessage {
	readonly type: 'error'
	readonly message: string
}

export interface PongMessage {
	readonly type: 'pong'
	readonly id: string
}

export type TargetProcessState = 'not-started' | 'starting' | 'process-running' | 'process-exited'
export type TargetFailure = 'target-start-failed' | 'target-process-exited'

export interface TargetSummary {
	readonly id: string
	readonly name: string
	readonly processState: TargetProcessState
	readonly lastActivityAt?: number
	readonly exit?: { readonly code: number; readonly signal: number | null }
	readonly failure?: TargetFailure
	readonly capabilities: { readonly imageDrop: 'local-path' | 'disabled' }
}

export type AttachError =
	| 'unknown-target'
	| 'target-start-failed'
	| 'target-process-exited'
	| 'attach-superseded'
	| 'snapshot-failed'
	| 'protocol-violation'

export type ServerReadyMessage = ProtocolMessage<'server-ready', { readonly protocol: 2 }>
export type TargetsMessage = ProtocolMessage<'targets', { readonly targets: TargetSummary[] }>
export type TargetStatusMessage = ProtocolMessage<
	'target-status',
	{ readonly target: TargetSummary }
>

export type AttachStartedMessage = AttachmentFields & { readonly type: 'attach-started' }
export type AttachCommittedMessage = AttachmentFields & { readonly type: 'attach-committed' }

export type AttachRejectedMessage = ProtocolMessage<
	'attach-rejected',
	TargetRequestFields & Readonly<Record<'reason', AttachError>>
>

export type SnapshotFailedMessage = ProtocolMessage<
	'snapshot-failed',
	AttachmentFields & Readonly<Record<'reason', 'timeout'>>
>

export type TargetRestartedMessage = ProtocolMessage<
	'target-restarted',
	Record<'targetId' | 'sessionId', string>
>

/**
 * herdweb 已把 data 交给当前 PTY 的写入队列，并已记入 session 内去重账本。
 *
 * 不保证操作系统层面写入成功：node-pty@1.1.0 的写入走 fs.write 异步回调，
 * 失败时只 console.error 并清空整个写队列（lib/unixTerminal.js:314-327），
 * 不 emit、不回调，调用方无法观察。更不代表 Herdr 已执行完成。
 */
export interface InputAcceptedMessage {
	readonly type: 'input-accepted'
	readonly id: string
}

export type InputRejectedReason = 'id-conflict' | 'session-unavailable'

export interface InputRejectedMessage {
	readonly type: 'input-rejected'
	readonly id: string
	readonly reason: InputRejectedReason
}

export type ServerMessage =
	| SnapshotMessage
	| OutputMessage
	| ExitMessage
	| ErrorMessage
	| PongMessage
	| InputAcceptedMessage
	| InputRejectedMessage
	| ServerReadyMessage
	| TargetsMessage
	| TargetStatusMessage
	| AttachStartedMessage
	| AttachCommittedMessage
	| AttachRejectedMessage
	| SnapshotFailedMessage
	| TargetRestartedMessage

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFinitePositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && typeof value === 'number' && value > 0
}

const utf8Encoder = new TextEncoder()

function isInputWithinLimit(value: string): boolean {
	return utf8Encoder.encode(value).byteLength <= MAX_CLIENT_INPUT_BYTES
}

function isProtocolId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		utf8Encoder.encode(value).byteLength <= MAX_PROTOCOL_ID_BYTES
	)
}

const targetIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const isTargetId = (value: unknown): value is string =>
	typeof value === 'string' && targetIdPattern.test(value)

export function serialiseClientMessage(message: ClientMessage): string {
	return JSON.stringify(message)
}

export function serialiseServerMessage(message: ServerMessage): string {
	return JSON.stringify(message)
}

export function parseClientMessage(payload: string): ClientMessage | null {
	try {
		const parsed: unknown = JSON.parse(payload)
		if (!isRecord(parsed) || typeof parsed.type !== 'string') {
			return null
		}

		switch (parsed.type) {
			case 'input':
				return typeof parsed.data === 'string' && isInputWithinLimit(parsed.data)
					? { type: 'input', data: parsed.data }
					: null

			case 'resize':
				return isFinitePositiveInteger(parsed.cols) &&
					isFinitePositiveInteger(parsed.rows) &&
					parsed.cols <= MAX_RESIZE_COLS &&
					parsed.rows <= MAX_RESIZE_ROWS
					? { type: 'resize', cols: parsed.cols, rows: parsed.rows }
					: null

			case 'ping':
				return isProtocolId(parsed.id) ? { type: 'ping', id: parsed.id } : null

			case 'input-action':
				return isProtocolId(parsed.id) &&
					typeof parsed.data === 'string' &&
					isInputWithinLimit(parsed.data)
					? { type: 'input-action', id: parsed.id, data: parsed.data }
					: null

			case 'attach-target':
				return isProtocolId(parsed.requestId) &&
					isTargetId(parsed.targetId) &&
					isFinitePositiveInteger(parsed.cols) &&
					parsed.cols <= MAX_RESIZE_COLS &&
					isFinitePositiveInteger(parsed.rows) &&
					parsed.rows <= MAX_RESIZE_ROWS
					? {
							type: 'attach-target',
							requestId: parsed.requestId,
							targetId: parsed.targetId,
							cols: parsed.cols,
							rows: parsed.rows,
						}
					: null

			case 'restart-target':
				return isProtocolId(parsed.requestId) && isTargetId(parsed.targetId)
					? { type: 'restart-target', requestId: parsed.requestId, targetId: parsed.targetId }
					: null

			case 'snapshot-applied':
				return isProtocolId(parsed.requestId) && isProtocolId(parsed.attachmentId)
					? {
							type: 'snapshot-applied',
							requestId: parsed.requestId,
							attachmentId: parsed.attachmentId,
						}
					: null

			default:
				return null
		}
	} catch {
		return null
	}
}

export function parseServerMessage(payload: string): ServerMessage | null {
	try {
		const parsed: unknown = JSON.parse(payload)
		if (!isRecord(parsed) || typeof parsed.type !== 'string') {
			return null
		}

		switch (parsed.type) {
			case 'snapshot':
				return typeof parsed.data === 'string' &&
					isProtocolId(parsed.sessionId) &&
					Number.isInteger(parsed.outputWatermark) &&
					typeof parsed.outputWatermark === 'number' &&
					parsed.outputWatermark >= 0
					? {
							type: 'snapshot',
							data: parsed.data,
							sessionId: parsed.sessionId,
							outputWatermark: parsed.outputWatermark,
						}
					: null

			case 'output':
				return typeof parsed.data === 'string' &&
					Number.isInteger(parsed.seq) &&
					typeof parsed.seq === 'number' &&
					parsed.seq > 0
					? { type: 'output', data: parsed.data, seq: parsed.seq }
					: null

			case 'exit':
				return typeof parsed.exitCode === 'number' &&
					(parsed.signal === null || typeof parsed.signal === 'number')
					? {
							type: 'exit',
							exitCode: parsed.exitCode,
							signal: parsed.signal,
						}
					: null

			case 'error':
				return typeof parsed.message === 'string'
					? { type: 'error', message: parsed.message }
					: null

			case 'pong':
				return isProtocolId(parsed.id) ? { type: 'pong', id: parsed.id } : null

			case 'input-accepted':
				return isProtocolId(parsed.id) ? { type: 'input-accepted', id: parsed.id } : null

			case 'input-rejected':
				return isProtocolId(parsed.id) &&
					(parsed.reason === 'id-conflict' || parsed.reason === 'session-unavailable')
					? { type: 'input-rejected', id: parsed.id, reason: parsed.reason }
					: null

			default:
				return null
		}
	} catch {
		return null
	}
}
