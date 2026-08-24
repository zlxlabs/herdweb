import { describe, expect, test, vi } from 'vitest'
import {
	TargetRegistry,
	type TargetSession,
	type TargetSessionFactory,
} from '../src/target-registry'
const target = (id: string) => ({
	id,
	name: id,
	command: ['fake', id],
	imageDrop: 'disabled' as const,
})
class FakeSession implements TargetSession {
	id: string
	onExit: Promise<{ exitCode: number; signal: number | null }>
	private finish!: (exit: { exitCode: number; signal: number | null }) => void
	constructor(id: string) {
		this.id = id
		this.onExit = new Promise((resolve) => {
			this.finish = resolve
		})
	}
	exit = (exitCode = 0, signal: number | null = null): void => this.finish({ exitCode, signal })
	dispose = (): Promise<void> => Promise.resolve()
}
const registryFor = (
	factory: TargetSessionFactory = (command) => new FakeSession(command[1] ?? 'session'),
) => new TargetRegistry([target('a'), target('b')], factory)
describe('TargetRegistry', () => {
	test('is lazy and rejects unknown targets', () => {
		const factory = vi.fn<TargetSessionFactory>(() => new FakeSession('unused'))
		const registry = registryFor(factory)
		expect(registry.getStatus('a')).toEqual({ state: 'not-started' })
		expect(factory).not.toHaveBeenCalled()
		expect(() => registry.getOrStart('missing')).toThrow('Unknown target')
	})
	test('summaries expose an allowlist and retain process facts', async () => {
		const sessions: FakeSession[] = []
		const registry = new TargetRegistry(
			[
				{ ...target('a'), name: 'Alpha', imageDrop: 'local-path' },
				{ ...target('b'), name: 'Beta', imageDrop: 'disabled' },
			],
			(command) => {
				const session = new FakeSession(command[1] ?? 'session')
				sessions.push(session)
				return session
			},
		)
		expect(registry.getSummaries()).toEqual([
			{
				id: 'a',
				name: 'Alpha',
				processState: 'not-started',
				capabilities: { imageDrop: 'local-path' },
			},
			{
				id: 'b',
				name: 'Beta',
				processState: 'not-started',
				capabilities: { imageDrop: 'disabled' },
			},
		])
		expect(JSON.stringify(registry.getSummaries())).not.toContain('fake')
		await registry.getOrStart('a')
		expect(registry.getSummaries()[0]).toMatchObject({ id: 'a', processState: 'process-running' })
		sessions[0]?.exit(7, 15)
		await sessions[0]?.onExit
		expect(registry.getSummaries()[0]).toEqual({
			id: 'a',
			name: 'Alpha',
			processState: 'process-exited',
			exit: { code: 7, signal: 15 },
			failure: 'target-process-exited',
			capabilities: { imageDrop: 'local-path' },
		})
		await registry.dispose()
		const failed = new TargetRegistry([target('failed')], () => {
			throw new Error('private command failure')
		})
		expect(() => failed.getOrStart('failed')).toThrow('private command failure')
		expect(failed.getSummaries()).toEqual([
			{
				id: 'failed',
				name: 'failed',
				processState: 'process-exited',
				failure: 'target-start-failed',
				capabilities: { imageDrop: 'disabled' },
			},
		])
	})
	test('single-flights concurrent starts and isolates an exited target', async () => {
		const sessions: FakeSession[] = []
		const factory = vi.fn<TargetSessionFactory>((command) => {
			const session = new FakeSession(command[1] ?? 'session')
			sessions.push(session)
			return session
		})
		const registry = registryFor(factory)
		const [a1, a2, b] = await Promise.all([
			registry.getOrStart('a'),
			registry.getOrStart('a'),
			registry.getOrStart('b'),
		])
		expect(a1).toBe(a2)
		expect(factory).toHaveBeenCalledTimes(2)
		sessions[0]?.exit(7, 15)
		await sessions[0]?.onExit
		expect(registry.getStatus('a')).toEqual({
			state: 'process-exited',
			exitCode: 7,
			signal: 15,
		})
		expect(registry.getStatus('b')).toEqual({ state: 'process-running', sessionId: b.id })
		expect(await registry.getOrStart('b')).toBe(b)
		expect(() => registry.getOrStart('a')).toThrow('process-exited')
		await registry.dispose()
	})
	test('restart creates one new session only after exit', async () => {
		const sessions: FakeSession[] = []
		const registry = registryFor((command) => {
			const session = new FakeSession(`${command[1]}-${sessions.length}`)
			sessions.push(session)
			return session
		})
		const old = await registry.getOrStart('a')
		sessions[0]?.exit()
		await sessions[0]?.onExit
		const [next1, next2] = await Promise.all([registry.restart('a'), registry.restart('a')])
		expect(next1).toBe(next2)
		expect(next1.id).not.toBe(old.id)
		expect(sessions).toHaveLength(2)
		await registry.dispose()
	})
	test('spawn errors are rethrown and retained as an exited fact', () => {
		const error = new Error('spawn failed')
		const registry = registryFor(() => {
			throw error
		})
		expect(() => registry.getOrStart('a')).toThrow(error)
		expect(registry.getStatus('a')).toEqual({
			state: 'process-exited',
			exitCode: null,
			signal: null,
			error,
		})
	})
	test('dispose closes the registry before taking its session snapshot', async () => {
		const factory = vi.fn<TargetSessionFactory>(() => new FakeSession('late'))
		const registry = registryFor(factory)
		const disposePromise = registry.dispose()

		expect(() => registry.getOrStart('a')).toThrow('closing')
		expect(() => registry.restart('a')).toThrow('closing')
		expect(factory).not.toHaveBeenCalled()
		await disposePromise
	})
})
