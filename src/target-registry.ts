import { SharedTerminalSession } from './session'
import type { TargetSummary } from './session-protocol'
import type { TargetConfig } from './types'
export type TargetSession = Pick<SharedTerminalSession, 'id' | 'onExit' | 'dispose'>
export type TargetSessionFactory = (command: readonly string[]) => TargetSession
type StatusChange = (summary: TargetSummary, session?: TargetSession) => void
type TargetStatus =
	| { readonly state: 'not-started' }
	| { readonly state: 'starting' }
	| { readonly state: 'process-running'; readonly sessionId: string }
	| {
			readonly state: 'process-exited'
			readonly exitCode: number | null
			readonly signal: number | null
			readonly error?: unknown
	  }
interface Entry {
	readonly target: TargetConfig
	status: TargetStatus
	session?: TargetSession
	startPromise?: Promise<TargetSession>
	restartInFlight: boolean
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Target lifecycle invariant violated')
	return value
}
export class TargetRegistry {
	private readonly entries = new Map<string, Entry>()
	private readonly createSession: TargetSessionFactory
	private readonly onStatusChange?: StatusChange
	private closing = false
	private disposePromise: Promise<void> | undefined
	constructor(
		targets: readonly TargetConfig[],
		createSession: TargetSessionFactory = (command) => new SharedTerminalSession(command),
		onStatusChange?: StatusChange,
	) {
		this.createSession = createSession
		this.onStatusChange = onStatusChange
		for (const target of targets) {
			this.entries.set(target.id, {
				target,
				status: { state: 'not-started' },
				restartInFlight: false,
			})
		}
	}
	getStatus(id: string): TargetStatus {
		return this.entry(id).status
	}
	getSummaries(): TargetSummary[] {
		const summaries: TargetSummary[] = []
		for (const { target, status } of this.entries.values()) {
			const summary = {
				id: target.id,
				name: target.name,
				processState: status.state,
				capabilities: { imageDrop: target.imageDrop },
			} satisfies Omit<TargetSummary, 'exit' | 'failure'>
			if (status.state !== 'process-exited') {
				summaries.push(summary)
				continue
			}
			if (status.error !== undefined || status.exitCode === null) {
				summaries.push({ ...summary, failure: 'target-start-failed' as const })
				continue
			}
			summaries.push({
				...summary,
				exit: { code: status.exitCode, signal: status.signal },
				failure: 'target-process-exited' as const,
			})
		}
		return summaries
	}
	getOrStart(id: string): Promise<TargetSession> {
		this.assertOpen()
		const entry = this.entry(id)
		if (entry.restartInFlight) return required(entry.startPromise)
		if (entry.status.state === 'process-running') {
			return Promise.resolve(required(entry.session))
		}
		if (entry.status.state === 'starting') {
			return required(entry.startPromise)
		}
		if (entry.status.state === 'process-exited') {
			throw new Error(`Target "${id}" is process-exited; use restart`)
		}
		return this.start(entry)
	}
	restart(id: string): Promise<TargetSession> {
		this.assertOpen()
		const entry = this.entry(id)
		if (entry.restartInFlight) return required(entry.startPromise)
		if (entry.status.state !== 'process-exited') {
			throw new Error(`Target "${id}" must be process-exited to restart`)
		}
		return this.start(entry, true)
	}
	close(): void {
		this.closing = true
	}
	async dispose(): Promise<void> {
		if (this.disposePromise !== undefined) return this.disposePromise
		this.close()
		this.disposePromise = Promise.all(
			[...this.entries.values()].map(
				(entry) =>
					entry.startPromise?.then((session) => session.dispose()) ??
					entry.session?.dispose() ??
					Promise.resolve(),
			),
		).then(() => undefined)
		return this.disposePromise
	}
	private assertOpen(): void {
		if (this.closing) throw new Error('Target registry is closing')
	}
	private entry(id: string): Entry {
		const entry = this.entries.get(id)
		if (entry === undefined) throw new Error(`Unknown target "${id}"`)
		return entry
	}
	private publish(entry: Entry, session?: TargetSession): void {
		this.onStatusChange?.(
			required(this.getSummaries().find((summary) => summary.id === entry.target.id)),
			session,
		)
	}
	private start(entry: Entry, restarting = false): Promise<TargetSession> {
		entry.restartInFlight = restarting
		entry.status = { state: 'starting' }
		this.publish(entry)
		let session: TargetSession
		try {
			session = this.createSession(entry.target.command)
		} catch (error) {
			entry.status = { state: 'process-exited', exitCode: null, signal: null, error }
			entry.restartInFlight = false
			this.publish(entry)
			throw error
		}
		entry.session = session
		entry.status = { state: 'process-running', sessionId: session.id }
		this.publish(entry, session)
		const promise = Promise.resolve(session)
		entry.startPromise = promise
		promise.then(() => {
			entry.startPromise = undefined
			entry.restartInFlight = false
		})
		session.onExit.then((exit) => {
			entry.status = { state: 'process-exited', ...exit }
			this.publish(entry)
		})
		return promise
	}
}
