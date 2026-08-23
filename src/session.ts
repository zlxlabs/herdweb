import { randomUUID } from 'node:crypto'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import XtermHeadless from '@xterm/headless'
import { type IPty, spawnPty } from './pty'
import type { ClientMessage, InputRejectedReason, ServerMessage } from './session-protocol'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const TERMINAL_ERROR = 'Terminal failed; restart herdweb.'

const HeadlessTerminal = XtermHeadless.Terminal
type HeadlessTerminalInstance = InstanceType<typeof HeadlessTerminal>

// Typed view of the xterm internal the snapshot relies on: the serialize
// addon replays mouse *tracking* modes but the public IModes exposes no
// mouse *encoding*, so it is read from the parser state instead. All
// members optional — if the internals move in a future xterm bump, the
// snapshot degrades to appending nothing rather than crashing. Not
// consumer-visible: package exports have no "./session" entry.
declare module '@xterm/headless' {
	interface Terminal {
		_core?: { coreMouseService?: { activeEncoding?: string } }
	}
}

export interface SessionClient {
	send(message: ServerMessage): void
	close(): void
}

interface SessionExit {
	readonly exitCode: number
	readonly signal: number | null
}

function normaliseCommand(command: readonly string[]): { file: string; args: string[] } {
	const [file, ...args] = command
	if (!file) {
		throw new Error('herdweb serve requires a command to start')
	}
	return { file, args: [...args] }
}

function toSignalValue(signal: number | undefined): number | null {
	return typeof signal === 'number' ? signal : null
}

// Nested herdr client markers: when present, attach commands may treat the
// launch as nested inside an existing client instead of attaching to the real session.
function isNestedHerdrEnvVar(key: string): boolean {
	return key.startsWith('HERDR')
}

export function buildSessionEnv(sourceEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	// Rebuild without HERDR_* markers — `delete` triggers biome noDelete,
	// and `env.X = undefined` coerces to the string "undefined" on process.env
	const rest = Object.fromEntries(
		Object.entries(sourceEnv).filter(([key]) => !isNestedHerdrEnvVar(key)),
	)
	return { ...rest, TERM: 'xterm-256color' }
}

interface ActivityRecord {
	readonly bytes: number
	readonly ts: number
}

export class SharedTerminalSession {
	private readonly sessionId = randomUUID()
	private readonly startedAt = Date.now()
	private readonly pty: IPty
	private readonly mirror: HeadlessTerminalInstance
	private readonly serializeAddon: SerializeAddon
	private readonly clients = new Set<SessionClient>()
	private readonly exitPromise: Promise<SessionExit>
	private exitResolve: ((exit: SessionExit) => void) | null = null
	private exited: SessionExit | null = null
	private pendingMirrorWrite: Promise<void> = Promise.resolve()
	private outputSeq = 0
	private terminalFailed = false
	private readonly inputActions = new Map<string, string>()
	private readonly activityRecords: ActivityRecord[] = []

	constructor(command: readonly string[]) {
		const { file, args } = normaliseCommand(command)

		this.pty = spawnPty(file, args, {
			name: 'xterm-256color',
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
			cwd: process.cwd(),
			// Strip tmux client markers so `tmux new-session -A -s ...` attaches to
			// the real session instead of behaving like a nested in-tmux command.
			env: buildSessionEnv(process.env),
		})

		this.mirror = new HeadlessTerminal({
			allowProposedApi: true,
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
			scrollback: 5000,
		})
		this.serializeAddon = new SerializeAddon()
		this.mirror.loadAddon(this.serializeAddon)
		const unicode11 = new Unicode11Addon()
		this.mirror.loadAddon(unicode11)
		this.mirror.unicode.activeVersion = '11'

		this.exitPromise = new Promise<SessionExit>((resolve) => {
			this.exitResolve = resolve
		})

		this.pty.onData((data) => {
			const seq = ++this.outputSeq
			this.recordActivity(data)
			this.pendingMirrorWrite = this.pendingMirrorWrite
				.then(() => {
					if (this.terminalFailed) return
					return new Promise<void>((resolve) => {
						this.mirror.write(data, resolve)
					})
				})
				.catch(() => {
					this.failTerminal()
				})

			this.broadcast({ type: 'output', data, seq })
		})

		this.pty.onExit(({ exitCode, signal }) => {
			const exit: SessionExit = { exitCode, signal: toSignalValue(signal) }
			this.exited = exit
			this.broadcast({ type: 'exit', ...exit })
			for (const client of this.clients) {
				client.close()
			}
			this.clients.clear()
			this.exitResolve?.(exit)
			this.exitResolve = null
		})
	}

	get pid(): number {
		return this.pty.pid
	}

	get onExit(): Promise<SessionExit> {
		return this.exitPromise
	}

	/** Stable per-process identity for health notifications. */
	get id(): string {
		return this.sessionId
	}

	/** PTY spawn timestamp (ms) for deterministic health event ids. */
	get startTime(): number {
		return this.startedAt
	}

	/** Sum of PTY output bytes in the trailing window (ms from now). */
	bytesInWindow(windowMs: number, now = Date.now()): number {
		const cutoff = now - windowMs
		this.pruneActivity(cutoff)
		let total = 0
		for (const record of this.activityRecords) {
			if (record.ts >= cutoff) {
				total += record.bytes
			}
		}
		return total
	}

	/** Timestamp of the most recent PTY output chunk, or undefined when silent. */
	lastOutputAt(now = Date.now()): number | undefined {
		this.pruneActivity(now - 60_000)
		const last = this.activityRecords.at(-1)
		return last?.ts
	}

	async addClient(client: SessionClient): Promise<void> {
		if (this.terminalFailed) {
			this.rejectUnavailable(client)
			return
		}

		const exitedBeforeSnapshot = this.exited
		if (exitedBeforeSnapshot) {
			const snapshot = await this.snapshot()
			if (this.terminalFailed) {
				this.rejectUnavailable(client)
				return
			}
			client.send({ type: 'snapshot', ...snapshot, sessionId: this.sessionId })
			client.send({
				type: 'exit',
				exitCode: exitedBeforeSnapshot.exitCode,
				signal: exitedBeforeSnapshot.signal,
			})
			client.close()
			return
		}

		this.clients.add(client)
		const snapshot = await this.snapshot()
		if (this.terminalFailed) {
			if (this.clients.delete(client)) {
				this.rejectUnavailable(client)
			} else {
				client.close()
			}
			return
		}
		client.send({ type: 'snapshot', ...snapshot, sessionId: this.sessionId })

		const exitedAfterSnapshot = this.exited
		if (exitedAfterSnapshot) {
			client.send({
				type: 'exit',
				exitCode: exitedAfterSnapshot.exitCode,
				signal: exitedAfterSnapshot.signal,
			})
			client.close()
			this.clients.delete(client)
		}
	}

	removeClient(client: SessionClient): void {
		this.clients.delete(client)
	}

	handleClientMessage(client: SessionClient, message: ClientMessage): void {
		switch (message.type) {
			case 'input':
				if (this.exited || this.terminalFailed) return
				this.pty.write(message.data)
				return

			case 'resize':
				if (this.exited) return
				this.pty.resize(message.cols, message.rows)
				this.mirror.resize(message.cols, message.rows)
				return

			case 'ping':
				client.send({ type: 'pong', id: message.id })
				return

			case 'input-action':
				this.handleInputAction(client, message.id, message.data)
				return
		}
	}

	async dispose(): Promise<void> {
		for (const client of this.clients) {
			client.close()
		}
		this.clients.clear()

		if (this.exited === null) {
			this.pty.kill()
			await this.exitPromise
		}
	}

	private async snapshot(): Promise<{ data: string; outputWatermark: number }> {
		for (;;) {
			const pending = this.pendingMirrorWrite
			await pending
			if (this.pendingMirrorWrite !== pending) continue
			return {
				data: this.serializeAddon.serialize() + this.serializeMouseEncoding(),
				outputWatermark: this.outputSeq,
			}
		}
	}

	private handleInputAction(client: SessionClient, id: string, data: string): void {
		if (this.exited || this.terminalFailed) {
			this.sendInputRejected(client, id, 'session-unavailable')
			client.close()
			this.clients.delete(client)
			return
		}

		const recordedData = this.inputActions.get(id)
		if (recordedData !== undefined) {
			if (recordedData === data) {
				client.send({ type: 'input-accepted', id })
			} else {
				this.sendInputRejected(client, id, 'id-conflict')
			}
			return
		}

		try {
			this.pty.write(data)
		} catch {
			this.sendInputRejected(client, id, 'session-unavailable')
			this.failTerminal()
			return
		}

		this.inputActions.set(id, data)
		if (this.inputActions.size > 128) {
			const oldestId = this.inputActions.keys().next().value
			if (oldestId !== undefined) this.inputActions.delete(oldestId)
		}
		client.send({ type: 'input-accepted', id })
	}

	private sendInputRejected(client: SessionClient, id: string, reason: InputRejectedReason): void {
		client.send({ type: 'input-rejected', id, reason })
	}

	private rejectUnavailable(client: SessionClient): void {
		client.send({ type: 'error', message: TERMINAL_ERROR })
		client.close()
	}

	private failTerminal(): void {
		if (this.terminalFailed) return
		this.terminalFailed = true
		this.broadcast({ type: 'error', message: TERMINAL_ERROR })
		for (const client of this.clients) {
			client.close()
		}
		this.clients.clear()
	}

	// Without ?1006h in the snapshot, late-joining browser clients fall back
	// to legacy X10 encoding and their mouse reports arrive via term.onBinary,
	// which the client does not forward — taps in mouse-driven apps (e.g.
	// herdr's tab bar) are silently dropped.
	private serializeMouseEncoding(): string {
		switch (this.mirror._core?.coreMouseService?.activeEncoding) {
			case 'SGR':
				return '\x1b[?1006h'
			case 'SGR_PIXELS':
				return '\x1b[?1016h'
			default:
				return ''
		}
	}

	private broadcast(message: ServerMessage): void {
		for (const client of this.clients) {
			client.send(message)
		}
	}

	private recordActivity(data: string): void {
		const ts = Date.now()
		this.activityRecords.push({ bytes: Buffer.byteLength(data, 'utf8'), ts })
		this.pruneActivity(ts - 60_000)
	}

	private pruneActivity(cutoff: number): void {
		let first = this.activityRecords[0]
		while (first !== undefined && first.ts < cutoff) {
			this.activityRecords.shift()
			first = this.activityRecords[0]
		}
	}
}
