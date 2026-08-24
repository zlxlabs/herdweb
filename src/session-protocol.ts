export interface InputMessage {
	readonly type: 'input'
	readonly attachmentId: string
	readonly data: string
}

export interface ResizeMessage {
	readonly type: 'resize'
	readonly attachmentId: string
	readonly cols: number
	readonly rows: number
}

export interface PingMessage {
	readonly type: 'ping'
	readonly nonce: string
}

export interface InputActionMessage {
	readonly type: 'input-action'
	readonly attachmentId: string
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
	readonly attachmentId: string
	readonly data: string
	readonly sessionId: string
	readonly outputWatermark: number
}

export interface OutputMessage {
	readonly type: 'output'
	readonly attachmentId: string
	readonly data: string
	readonly seq: number
}

export interface ExitMessage {
	readonly type: 'exit'
	readonly attachmentId: string
	readonly exitCode: number
	readonly signal: number | null
}

export interface ErrorMessage {
	readonly type: 'error'
	readonly attachmentId: string
	readonly message: string
}

export interface PongMessage {
	readonly type: 'pong'
	readonly nonce: string
}

/** @public */
export type TargetProcessState = 'not-started' | 'starting' | 'process-running' | 'process-exited'
/** @public */
export type TargetFailure = 'target-start-failed' | 'target-process-exited'

/** @public */
export interface TargetSummary {
	readonly id: string
	readonly name: string
	readonly processState: TargetProcessState
	readonly lastActivityAt?: number
	readonly exit?: { readonly code: number; readonly signal: number | null }
	readonly failure?: TargetFailure
	readonly capabilities: { readonly imageDrop: 'local-path' | 'disabled' }
}

/** @public */
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
	Readonly<Record<'targetId' | 'sessionId', string>>
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
	readonly attachmentId: string
	readonly id: string
}

export type InputRejectedReason = 'id-conflict' | 'session-unavailable'

export interface InputRejectedMessage {
	readonly type: 'input-rejected'
	readonly attachmentId: string
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

function isTargetName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		[...value].length <= 80 &&
		!/\p{Cc}/u.test(value)
	)
}

const isTargetProcessState = (value: unknown): value is TargetProcessState =>
	value === 'not-started' ||
	value === 'starting' ||
	value === 'process-running' ||
	value === 'process-exited'

const isTargetFailure = (value: unknown): value is TargetFailure =>
	value === 'target-start-failed' || value === 'target-process-exited'

const isImageDrop = (value: unknown): value is TargetSummary['capabilities']['imageDrop'] =>
	value === 'local-path' || value === 'disabled'

const isAttachError = (value: unknown): value is AttachError =>
	value === 'unknown-target' ||
	value === 'target-start-failed' ||
	value === 'target-process-exited' ||
	value === 'attach-superseded' ||
	value === 'snapshot-failed' ||
	value === 'protocol-violation'

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value)
}

function parseTargetSummary(value: unknown): TargetSummary | null {
	if (!isRecord(value)) return null
	const { id, name, processState, lastActivityAt, exit, failure, capabilities } = value
	if (
		!isTargetId(id) ||
		!isTargetName(name) ||
		!isTargetProcessState(processState) ||
		!isRecord(capabilities) ||
		!isImageDrop(capabilities.imageDrop) ||
		(lastActivityAt !== undefined && (!isInteger(lastActivityAt) || lastActivityAt < 0)) ||
		(failure !== undefined && !isTargetFailure(failure))
	) {
		return null
	}
	const parsedExit =
		exit === undefined
			? undefined
			: isRecord(exit) && isInteger(exit.code) && (exit.signal === null || isInteger(exit.signal))
				? { code: exit.code, signal: exit.signal }
				: null
	if (parsedExit === null) return null
	return {
		id,
		name,
		processState,
		...(lastActivityAt === undefined ? {} : { lastActivityAt }),
		...(parsedExit === undefined ? {} : { exit: parsedExit }),
		...(failure === undefined ? {} : { failure }),
		capabilities: { imageDrop: capabilities.imageDrop },
	}
}

function parseTargetRequestFields(value: Record<string, unknown>): TargetRequestFields | null {
	return isProtocolId(value.requestId) && isTargetId(value.targetId)
		? { requestId: value.requestId, targetId: value.targetId }
		: null
}

function parseAttachmentFields(value: Record<string, unknown>): AttachmentFields | null {
	const fields = parseTargetRequestFields(value)
	return fields !== null && isProtocolId(value.attachmentId)
		? { ...fields, attachmentId: value.attachmentId }
		: null
}

function parseProtocol2TargetMessage(parsed: Record<string, unknown>): ServerMessage | null {
	switch (parsed.type) {
		case 'server-ready':
			return parsed.protocol === 2 ? { type: 'server-ready', protocol: 2 } : null
		case 'targets': {
			if (!Array.isArray(parsed.targets) || parsed.targets.length < 1 || parsed.targets.length > 8)
				return null
			const ids = new Set<string>()
			const targets: TargetSummary[] = []
			for (const item of parsed.targets) {
				const target = parseTargetSummary(item)
				if (target === null || ids.has(target.id)) return null
				ids.add(target.id)
				targets.push(target)
			}
			return { type: 'targets', targets }
		}
		case 'target-status': {
			const target = parseTargetSummary(parsed.target)
			return target === null ? null : { type: 'target-status', target }
		}
		case 'attach-started':
		case 'attach-committed': {
			const fields = parseAttachmentFields(parsed)
			if (fields === null) return null
			return {
				type: parsed.type,
				...fields,
			}
		}
		case 'attach-rejected': {
			const fields = parseTargetRequestFields(parsed)
			return fields !== null && isAttachError(parsed.reason)
				? {
						type: 'attach-rejected',
						...fields,
						reason: parsed.reason,
					}
				: null
		}
		case 'snapshot-failed': {
			const fields = parseAttachmentFields(parsed)
			return fields !== null && parsed.reason === 'timeout'
				? {
						type: 'snapshot-failed',
						...fields,
						reason: 'timeout',
					}
				: null
		}
		case 'target-restarted':
			return isTargetId(parsed.targetId) && isProtocolId(parsed.sessionId)
				? { type: 'target-restarted', targetId: parsed.targetId, sessionId: parsed.sessionId }
				: null
		default:
			return null
	}
}

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
				return isProtocolId(parsed.attachmentId) &&
					typeof parsed.data === 'string' &&
					isInputWithinLimit(parsed.data)
					? { type: 'input', attachmentId: parsed.attachmentId, data: parsed.data }
					: null

			case 'resize':
				return isProtocolId(parsed.attachmentId) &&
					isFinitePositiveInteger(parsed.cols) &&
					isFinitePositiveInteger(parsed.rows) &&
					parsed.cols <= MAX_RESIZE_COLS &&
					parsed.rows <= MAX_RESIZE_ROWS
					? {
							type: 'resize',
							attachmentId: parsed.attachmentId,
							cols: parsed.cols,
							rows: parsed.rows,
						}
					: null

			case 'ping':
				return isProtocolId(parsed.nonce) ? { type: 'ping', nonce: parsed.nonce } : null

			case 'input-action':
				return isProtocolId(parsed.attachmentId) &&
					isProtocolId(parsed.id) &&
					typeof parsed.data === 'string' &&
					isInputWithinLimit(parsed.data)
					? {
							type: 'input-action',
							attachmentId: parsed.attachmentId,
							id: parsed.id,
							data: parsed.data,
						}
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: attachment-scoped session frames
export function parseServerMessage(payload: string): ServerMessage | null {
	try {
		const parsed: unknown = JSON.parse(payload)
		if (!isRecord(parsed) || typeof parsed.type !== 'string') {
			return null
		}
		const protocol2TargetMessage = parseProtocol2TargetMessage(parsed)
		if (protocol2TargetMessage !== null) return protocol2TargetMessage

		switch (parsed.type) {
			case 'snapshot':
				return isProtocolId(parsed.attachmentId) &&
					typeof parsed.data === 'string' &&
					isProtocolId(parsed.sessionId) &&
					Number.isInteger(parsed.outputWatermark) &&
					typeof parsed.outputWatermark === 'number' &&
					parsed.outputWatermark >= 0
					? {
							type: 'snapshot',
							attachmentId: parsed.attachmentId,
							data: parsed.data,
							sessionId: parsed.sessionId,
							outputWatermark: parsed.outputWatermark,
						}
					: null

			case 'output':
				return isProtocolId(parsed.attachmentId) &&
					typeof parsed.data === 'string' &&
					Number.isInteger(parsed.seq) &&
					typeof parsed.seq === 'number' &&
					parsed.seq > 0
					? {
							type: 'output',
							attachmentId: parsed.attachmentId,
							data: parsed.data,
							seq: parsed.seq,
						}
					: null

			case 'exit':
				return isProtocolId(parsed.attachmentId) &&
					typeof parsed.exitCode === 'number' &&
					(parsed.signal === null || typeof parsed.signal === 'number')
					? {
							type: 'exit',
							attachmentId: parsed.attachmentId,
							exitCode: parsed.exitCode,
							signal: parsed.signal,
						}
					: null

			case 'error':
				return isProtocolId(parsed.attachmentId) && typeof parsed.message === 'string'
					? { type: 'error', attachmentId: parsed.attachmentId, message: parsed.message }
					: null

			case 'pong':
				return isProtocolId(parsed.nonce) ? { type: 'pong', nonce: parsed.nonce } : null

			case 'input-accepted':
				return isProtocolId(parsed.attachmentId) && isProtocolId(parsed.id)
					? { type: 'input-accepted', attachmentId: parsed.attachmentId, id: parsed.id }
					: null

			case 'input-rejected':
				return isProtocolId(parsed.attachmentId) &&
					isProtocolId(parsed.id) &&
					(parsed.reason === 'id-conflict' || parsed.reason === 'session-unavailable')
					? {
							type: 'input-rejected',
							attachmentId: parsed.attachmentId,
							id: parsed.id,
							reason: parsed.reason,
						}
					: null

			default:
				return null
		}
	} catch {
		return null
	}
}
