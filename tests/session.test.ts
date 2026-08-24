import { describe, expect, test, vi } from 'vitest'
import { SharedTerminalSession, buildSessionEnv } from '../src/session'
import type { ServerMessage } from '../src/session-protocol'
import { sleep } from '../src/util/node-compat'

function createClientRecorder() {
	const messages: ServerMessage[] = []
	let closeCount = 0

	return {
		client: {
			send(message: ServerMessage) {
				messages.push(message)
			},
			close() {
				closeCount += 1
			},
		},
		getMessages() {
			return messages
		},
		getCloseCount() {
			return closeCount
		},
	}
}

type ClientRecorder = ReturnType<typeof createClientRecorder>

function receivedText(recorder: ClientRecorder): string {
	return recorder
		.getMessages()
		.map((message) => ('data' in message ? message.data : ''))
		.join('')
}

// Emit an escape sequence into the PTY, wait until it has demonstrably
// reached the session (a watcher client sees the marker), then connect a
// late client and return its snapshot.
async function lateJoinSnapshot(sequence: string): Promise<string> {
	const session = new SharedTerminalSession([
		'bash',
		'--norc',
		'--noprofile',
		'-lc',
		`printf "${sequence}sequence-applied"; sleep 5`,
	])
	try {
		const watcher = createClientRecorder()
		await session.addClient(watcher.client)
		await vi.waitFor(() => {
			expect(receivedText(watcher)).toContain('sequence-applied')
		})

		const lateClient = createClientRecorder()
		await session.addClient(lateClient.client)
		const snapshot = lateClient.getMessages().find((message) => message.type === 'snapshot')
		expect(snapshot).toBeDefined()
		return snapshot?.type === 'snapshot' ? snapshot.data : ''
	} finally {
		await session.dispose()
	}
}

function createMirrorBacklogProbe() {
	const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'sleep 5'])
	const pty = (session as unknown as { pty: { pause(): void; resume(): void } }).pty
	const mirror = (
		session as unknown as {
			mirror: { write(data: string, callback: () => void): void }
		}
	).mirror
	const callbacks: Array<() => void> = []
	mirror.write = (_data, callback) => callbacks.push(callback)
	return {
		session,
		mirror,
		pause: vi.spyOn(pty, 'pause'),
		resume: vi.spyOn(pty, 'resume'),
		callbacks,
		enqueue: (
			session as unknown as { enqueueMirrorWrite(data: string): void }
		).enqueueMirrorWrite.bind(session),
		chunk: 'a'.repeat(512 * 1024),
	}
}

describe('SharedTerminalSession', () => {
	test('mirror backlog pauses at high watermark and resumes below low watermark', async () => {
		const { session, pause, resume, callbacks, enqueue, chunk } = createMirrorBacklogProbe()

		try {
			enqueue(chunk)
			enqueue(chunk)
			expect(pause).toHaveBeenCalledTimes(1)
			await vi.waitFor(() => expect(callbacks).toHaveLength(1))
			callbacks[0]?.()
			expect(resume).not.toHaveBeenCalled()
			await vi.waitFor(() => expect(callbacks).toHaveLength(2))
			callbacks[1]?.()
			expect(resume).toHaveBeenCalledTimes(1)
		} finally {
			await session.dispose()
		}
	})

	test('mirror backlog failure resumes PTY and keeps terminal failure close behavior', async () => {
		const { session, mirror, pause, resume, enqueue, chunk } = createMirrorBacklogProbe()
		const recorder = createClientRecorder()
		let writes = 0
		mirror.write = (_data, callback) => {
			writes += 1
			if (writes === 1) {
				callback()
				return
			}
			throw new Error('mirror contains terminal data')
		}
		try {
			await session.addClient(recorder.client)
			enqueue(chunk)
			enqueue(chunk)
			await vi.waitFor(() => expect(writes).toBe(2))
			expect(pause).toHaveBeenCalledTimes(1)
			expect(resume).toHaveBeenCalledTimes(1)
			expect(recorder.getMessages()).toContainEqual({
				type: 'error',
				message: 'Terminal failed; restart herdweb.',
			})
			expect(recorder.getCloseCount()).toBe(1)
		} finally {
			await session.dispose()
		}
	})

	test('mirror backlog disposal resumes a paused PTY', async () => {
		const { session, mirror, pause, resume, enqueue, chunk } = createMirrorBacklogProbe()
		mirror.write = () => {}

		enqueue(chunk)
		enqueue(chunk)
		expect(pause).toHaveBeenCalledTimes(1)
		await session.dispose()
		expect(resume).toHaveBeenCalledTimes(1)
	})

	test('buildSessionEnv strips HERDR-prefixed variables before launching the command', () => {
		const env = buildSessionEnv({
			SHELL: '/bin/zsh',
			HOME: '/home/user',
			PATH: '/usr/bin',
			HERDR_SESSION: 'main',
			HERDR_SOCKET_PATH: '/Users/x/.config/herdr/sessions/main/herdr.sock',
			HERDR_PANE_ID: 'w1:p1',
			HERDR_TAB_ID: 'w1:t1',
			HERDR_WORKSPACE_ID: 'w1',
			HERDR_FUTURE_VAR: 'future-proof',
		})

		expect(env.SHELL).toBe('/bin/zsh')
		expect(env.HOME).toBe('/home/user')
		expect(env.PATH).toBe('/usr/bin')
		expect(env.TERM).toBe('xterm-256color')
		expect('HERDR_SESSION' in env).toBe(false)
		expect('HERDR_SOCKET_PATH' in env).toBe(false)
		expect('HERDR_PANE_ID' in env).toBe(false)
		expect('HERDR_TAB_ID' in env).toBe(false)
		expect('HERDR_WORKSPACE_ID' in env).toBe(false)
		expect('HERDR_FUTURE_VAR' in env).toBe(false)
	})

	test('buildSessionEnv does not strip non-HERDR multiplexer variables', () => {
		const env = buildSessionEnv({
			SHELL: '/bin/zsh',
			TMUX: '/tmp/tmux-1000/default,1860,0',
			TMUX_PANE: '%42',
			ZELLIJ: '0',
		})

		expect(env.TMUX).toBe('/tmp/tmux-1000/default,1860,0')
		expect(env.TMUX_PANE).toBe('%42')
		expect(env.ZELLIJ).toBe('0')
	})

	test('closes connected clients when the PTY exits naturally', async () => {
		const session = new SharedTerminalSession([
			'bash',
			'--norc',
			'--noprofile',
			'-lc',
			'printf "session-live\\n"; sleep 0.1; exit 0',
		])
		const recorder = createClientRecorder()

		await session.addClient(recorder.client)
		const exit = await session.onExit
		await sleep(50)

		expect(exit.exitCode).toBe(0)
		expect(recorder.getMessages().some((message) => message.type === 'exit')).toBe(true)
		expect(recorder.getCloseCount()).toBe(1)
	})

	test('handleClientMessage silently ignores input and resize after PTY exit', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'exit 0'])

		await session.onExit

		const recorder = createClientRecorder()

		// pty.resize() throws EBADF after exit — these must not throw
		session.handleClientMessage(recorder.client, { type: 'input', data: 'hello' })
		session.handleClientMessage(recorder.client, { type: 'resize', cols: 120, rows: 40 })

		// ping should still work — pure WS, no PTY involvement
		session.handleClientMessage(recorder.client, { type: 'ping', id: 'ping-1' })
		expect(recorder.getMessages()).toEqual([{ type: 'pong', id: 'ping-1' }])
	})

	test('snapshot identifies the session and watermarks sequenced output', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const recorder = createClientRecorder()

		try {
			await session.addClient(recorder.client)
			const initialSnapshot = recorder.getMessages()[0]
			expect(initialSnapshot).toMatchObject({
				type: 'snapshot',
				sessionId: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				),
				outputWatermark: 0,
			})

			session.handleClientMessage(recorder.client, {
				type: 'input',
				data: 'printf "seq-marker"\n',
			})
			await vi.waitFor(() => {
				expect(receivedText(recorder)).toContain('seq-marker')
			})

			const outputs = recorder
				.getMessages()
				.filter(
					(message): message is Extract<ServerMessage, { type: 'output' }> =>
						message.type === 'output',
				)
			expect(outputs.map((message) => message.seq)).toEqual(outputs.map((_, index) => index + 1))
		} finally {
			await session.dispose()
		}
	})

	test('snapshot retries when output arrives during mirror synchronization', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const recorder = createClientRecorder()
		let releasePending!: () => void
		const pending = new Promise<void>((resolve) => {
			releasePending = resolve
		})
		;(session as unknown as { pendingMirrorWrite: Promise<void> }).pendingMirrorWrite = pending

		try {
			const addPromise = session.addClient(recorder.client)
			session.handleClientMessage(recorder.client, {
				type: 'input',
				data: 'printf "during-snapshot"\n',
			})
			await vi.waitFor(() => {
				expect(receivedText(recorder)).toContain('during-snapshot')
			})
			releasePending()
			await addPromise

			const snapshot = recorder.getMessages().find((message) => message.type === 'snapshot')
			const outputSeqs = recorder
				.getMessages()
				.filter(
					(message): message is Extract<ServerMessage, { type: 'output' }> =>
						message.type === 'output',
				)
				.map((message) => message.seq)
			expect(snapshot).toMatchObject({
				type: 'snapshot',
				data: expect.stringContaining('during-snapshot'),
				outputWatermark: Math.max(...outputSeqs),
			})
		} finally {
			releasePending()
			await session.dispose()
		}
	})

	test('mirror failure is sticky, fail-loud, and makes later action clients unavailable', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const watcher = createClientRecorder()
		const mirror = (
			session as unknown as {
				mirror: { write(data: string, callback: () => void): void }
			}
		).mirror
		await session.addClient(watcher.client)
		mirror.write = () => {
			throw new Error('mirror contains terminal data')
		}

		try {
			session.handleClientMessage(watcher.client, { type: 'input', data: 'secret-marker' })
			await vi.waitFor(() => {
				expect(watcher.getMessages()).toContainEqual({
					type: 'error',
					message: 'Terminal failed; restart herdweb.',
				})
			})
			expect(watcher.getMessages()).not.toContainEqual(
				expect.objectContaining({ message: expect.stringContaining('secret-marker') }),
			)
			expect(watcher.getCloseCount()).toBe(1)

			const lateClient = createClientRecorder()
			await session.addClient(lateClient.client)
			expect(lateClient.getMessages()).toEqual([
				{ type: 'error', message: 'Terminal failed; restart herdweb.' },
			])
			expect(lateClient.getCloseCount()).toBe(1)

			session.handleClientMessage(watcher.client, {
				type: 'input-action',
				id: 'unavailable-action',
				data: 'secret-marker',
			})
			expect(watcher.getMessages().at(-1)).toEqual({
				type: 'input-rejected',
				id: 'unavailable-action',
				reason: 'session-unavailable',
			})
			const messageCount = watcher.getMessages().length
			session.handleClientMessage(watcher.client, { type: 'input', data: 'ignored' })
			expect(watcher.getMessages()).toHaveLength(messageCount)
		} finally {
			await session.dispose()
		}
	})

	test('snapshot replays SGR mouse encoding for late clients', async () => {
		expect(await lateJoinSnapshot('\\e[?1002h\\e[?1006h')).toContain('\x1b[?1006h')
	})

	test('snapshot replays SGR pixels mouse encoding for late clients', async () => {
		expect(await lateJoinSnapshot('\\e[?1002h\\e[?1016h')).toContain('\x1b[?1016h')
	})

	test('snapshot omits mouse encoding when no mouse modes were set', async () => {
		const data = await lateJoinSnapshot('plain-output')
		expect(data).not.toContain('\x1b[?1006h')
		expect(data).not.toContain('\x1b[?1016h')
	})

	test('snapshot omits mouse encoding after the app turns it off again', async () => {
		expect(await lateJoinSnapshot('\\e[?1006h\\e[?1006l')).not.toContain('\x1b[?1006h')
	})

	test('late clients receive the final snapshot and exit after the PTY is gone', async () => {
		const session = new SharedTerminalSession([
			'bash',
			'--norc',
			'--noprofile',
			'-lc',
			'printf "session-finished\\n"; exit 0',
		])

		const exit = await session.onExit
		const recorder = createClientRecorder()
		await session.addClient(recorder.client)

		expect(exit.exitCode).toBe(0)
		expect(recorder.getMessages()[0]).toMatchObject({ type: 'snapshot' })
		expect(recorder.getMessages()[1]).toEqual({ type: 'exit', ...exit })
		expect(recorder.getCloseCount()).toBe(1)
	})
})
