import { SharedTerminalSession } from './session'
import type { TargetConfig } from './types'
export type TargetSession = Pick<SharedTerminalSession, 'id' | 'onExit' | 'dispose'>
export type TargetSessionFactory = (command: readonly string[]) => TargetSession
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
	constructor(
		targets: readonly TargetConfig[],
		createSession: TargetSessionFactory = (command) => new SharedTerminalSession(command),
	) {
		this.createSession = createSession
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
	getOrStart(id: string): Promise<TargetSession> {
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
		const entry = this.entry(id)
		if (entry.restartInFlight) return required(entry.startPromise)
		if (entry.status.state !== 'process-exited') {
			throw new Error(`Target "${id}" must be process-exited to restart`)
		}
		return this.start(entry, true)
	}
	async dispose(): Promise<void> {
		await Promise.all(
			[...this.entries.values()].map(
				(entry) =>
					entry.startPromise?.then((session) => session.dispose()) ??
					entry.session?.dispose() ??
					Promise.resolve(),
			),
		)
	}
	private entry(id: string): Entry {
		const entry = this.entries.get(id)
		if (entry === undefined) throw new Error(`Unknown target "${id}"`)
		return entry
	}
	private start(entry: Entry, restarting = false): Promise<TargetSession> {
		entry.restartInFlight = restarting
		entry.status = { state: 'starting' }
		let session: TargetSession
		try {
			session = this.createSession(entry.target.command)
		} catch (error) {
			entry.status = { state: 'process-exited', exitCode: null, signal: null, error }
			entry.restartInFlight = false
			throw error
		}
		entry.session = session
		entry.status = { state: 'process-running', sessionId: session.id }
		const promise = Promise.resolve(session)
		entry.startPromise = promise
		promise.then(() => {
			entry.startPromise = undefined
			entry.restartInFlight = false
		})
		session.onExit.then((exit) => {
			entry.status = { state: 'process-exited', ...exit }
		})
		return promise
	}
}
