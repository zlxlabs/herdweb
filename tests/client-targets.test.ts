import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
	sockets: [] as FakeSocket[],
	terminals: [] as FakeTerminal[],
}))

class FakeTerminal {
	readonly options = { fontSize: 14 }
	readonly unicode = { activeVersion: '' }
	readonly writes: string[] = []
	readonly heldCallbacks: Array<() => void> = []
	holdCallbacks = false
	cols = 80
	rows = 24

	constructor() {
		harness.terminals.push(this)
	}

	loadAddon(): void {}
	open(): void {}
	onData(): { dispose(): void } {
		return { dispose() {} }
	}
	reset(): void {
		this.writes.push('<reset>')
	}
	write(data: string, callback?: () => void): void {
		this.writes.push(data)
		if (this.holdCallbacks && callback) {
			this.heldCallbacks.push(callback)
		} else {
			callback?.()
		}
	}
}

class FakeSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSED = 3
	readonly sent: string[] = []
	bufferedAmount = 0
	readyState = FakeSocket.CONNECTING

	constructor() {
		super()
		harness.sockets.push(this)
	}

	send(payload: string): void {
		this.sent.push(payload)
	}
	close(): void {
		if (this.readyState === FakeSocket.CLOSED) return
		this.readyState = FakeSocket.CLOSED
		this.dispatchEvent(new Event('close'))
	}
	open(): void {
		this.readyState = FakeSocket.OPEN
		this.dispatchEvent(new Event('open'))
	}
	receive(data: string): void {
		this.dispatchEvent(new MessageEvent('message', { data }))
	}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit(): void {}
	},
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../src/index', () => ({ createHookRegistry: () => ({}), init: vi.fn() }))

interface BootOptions {
	readonly mode?: 'single' | 'explicit'
	readonly url?: string
}

async function boot(options: BootOptions = {}): Promise<FakeSocket> {
	vi.resetModules()
	document.body.innerHTML = '<div id="terminal"></div>'
	window.history.replaceState(null, '', options.url ?? '/')
	Object.defineProperty(globalThis, '__herdwebConfig', {
		configurable: true,
		value: {
			name: 'test',
			theme: { background: '#000' },
			font: { family: 'monospace', mobileSizeDefault: 13 },
			reconnect: { enabled: false },
			targetMode: options.mode ?? 'single',
		},
	})
	Object.defineProperty(globalThis, '__herdwebBasePath', { configurable: true, value: '/' })
	await import('../src/client-entry')
	const socket = harness.sockets.at(-1)
	if (!socket) throw new Error('boot produced no socket')
	return socket
}

function send(socket: FakeSocket, message: Record<string, unknown>): void {
	socket.receive(JSON.stringify(message))
}

function target(id: string, processState = 'process-running'): Record<string, unknown> {
	return { id, name: id, processState, capabilities: { imageDrop: 'disabled' } }
}

function openWithTargets(socket: FakeSocket, targets: Record<string, unknown>[]): void {
	socket.open()
	send(socket, { type: 'server-ready', protocol: 2 })
	send(socket, { type: 'targets', targets })
}

function sentFrames(socket: FakeSocket): Record<string, unknown>[] {
	return socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
}

function lastAttach(socket: FakeSocket): Record<string, unknown> {
	const attach = sentFrames(socket)
		.filter((frame) => frame.type === 'attach-target')
		.at(-1)
	if (!attach) throw new Error('no attach-target sent')
	return attach
}

/** Drive the two-phase attach for the latest attach-target; returns the attachmentId. */
function commitAttach(socket: FakeSocket, targetId: string): string {
	const attach = lastAttach(socket)
	const attachmentId = `att-${targetId}-${socket.sent.length}`
	send(socket, {
		type: 'attach-started',
		requestId: attach.requestId,
		targetId,
		attachmentId,
	})
	send(socket, {
		type: 'snapshot',
		attachmentId,
		data: `snap-${targetId}`,
		sessionId: 's',
		outputWatermark: 0,
	})
	const applied = sentFrames(socket).at(-1)
	if (!applied) throw new Error('no snapshot-applied sent')
	expect(applied).toMatchObject({ type: 'snapshot-applied', attachmentId })
	send(socket, {
		type: 'attach-committed',
		requestId: applied.requestId,
		targetId,
		attachmentId,
	})
	return attachmentId
}

function restoreOverlay(): HTMLDivElement | null {
	return document.querySelector<HTMLDivElement>('#herdweb-target-restore')
}

function overlayButton(text: string): HTMLButtonElement {
	const button = [...(restoreOverlay()?.querySelectorAll('button') ?? [])].find(
		(candidate) => candidate.textContent === text,
	)
	if (!button) throw new Error(`overlay button not found: ${text}`)
	return button
}

describe('client target selection and restore', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(0)
		localStorage.clear()
		harness.sockets.length = 0
		harness.terminals.length = 0
		let uuid = 0
		vi.stubGlobal('crypto', { randomUUID: () => `uuid-${uuid++}` })
		vi.stubGlobal('WebSocket', FakeSocket)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test('single mode ignores a stale last target and auto-attaches the default', async () => {
		localStorage.setItem('herdweb:lastTargetId:/', 'workbox')
		const socket = await boot()
		openWithTargets(socket, [target('default')])
		expect(lastAttach(socket)).toMatchObject({ targetId: 'default', cols: 80, rows: 24 })
		commitAttach(socket, 'default')
		expect(localStorage.getItem('herdweb:lastTargetId:/')).toBe('default')
		expect(window.location.search).toBe('?target=default')
		expect(restoreOverlay()?.style.display ?? 'none').toBe('none')
		window.term?.input('hello', true)
		expect(sentFrames(socket).at(-1)).toMatchObject({ type: 'input', data: 'hello' })
	})

	test('single mode blocks on an invalid URL target until continuing with the default', async () => {
		const socket = await boot({ url: '/?target=nope' })
		openWithTargets(socket, [target('default')])
		expect(sentFrames(socket).some((frame) => frame.type === 'attach-target')).toBe(false)
		expect(restoreOverlay()?.textContent).toContain('"nope"')

		overlayButton('Continue with default').click()
		expect(lastAttach(socket)).toMatchObject({ targetId: 'default' })
		commitAttach(socket, 'default')
		expect(window.location.search).toBe('?target=default')
	})

	test('explicit mode blocks on an invalid URL target and attaches the chosen target', async () => {
		const socket = await boot({ mode: 'explicit', url: '/?target=nope' })
		openWithTargets(socket, [target('default'), target('workbox')])
		expect(sentFrames(socket).some((frame) => frame.type === 'attach-target')).toBe(false)

		overlayButton('workbox').click()
		expect(lastAttach(socket)).toMatchObject({ targetId: 'workbox' })
		commitAttach(socket, 'workbox')
		expect(localStorage.getItem('herdweb:lastTargetId:/')).toBe('workbox')
		expect(window.location.search).toBe('?target=workbox')
	})

	test('explicit mode restores a valid last target when there is no deep link', async () => {
		localStorage.setItem('herdweb:lastTargetId:/', 'workbox')
		const socket = await boot({ mode: 'explicit' })
		openWithTargets(socket, [target('default'), target('workbox')])
		expect(lastAttach(socket)).toMatchObject({ targetId: 'workbox' })
	})

	test('explicit mode blocks when the last target was removed', async () => {
		localStorage.setItem('herdweb:lastTargetId:/', 'deleted')
		const socket = await boot({ mode: 'explicit' })
		openWithTargets(socket, [target('default')])
		expect(sentFrames(socket).some((frame) => frame.type === 'attach-target')).toBe(false)
		expect(restoreOverlay()?.textContent).toContain('"deleted"')
	})

	test('explicit mode blocks loudly when storage is unreadable', async () => {
		const original = window.localStorage
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('denied')
			},
		})
		try {
			const socket = await boot({ mode: 'explicit' })
			openWithTargets(socket, [target('default')])
			expect(sentFrames(socket).some((frame) => frame.type === 'attach-target')).toBe(false)
			expect(restoreOverlay()?.textContent).toContain('storage')
		} finally {
			Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
		}
	})

	test('rapid A→B→C selection ignores late A/B frames and closes input immediately', async () => {
		const socket = await boot({ mode: 'explicit' })
		openWithTargets(socket, [target('default'), target('b'), target('c')])
		const attA = commitAttach(socket, 'default')
		const writesBefore = harness.terminals.at(-1)?.writes.length ?? 0

		window.term?.selectTarget?.('b')
		const attachB = lastAttach(socket)
		window.term?.input('must-drop', true)
		expect(sentFrames(socket).some((frame) => frame.type === 'input')).toBe(false)
		window.term?.selectTarget?.('c')

		// Late frames for A and B must not disturb C.
		send(socket, {
			type: 'attach-committed',
			requestId: (
				sentFrames(socket).filter((f) => f.type === 'attach-target')[0] as Record<string, unknown>
			).requestId,
			targetId: 'default',
			attachmentId: attA,
		})
		send(socket, {
			type: 'attach-started',
			requestId: attachB.requestId,
			targetId: 'b',
			attachmentId: 'att-b',
		})
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-b',
			data: 'b-snapshot',
			sessionId: 'sb',
			outputWatermark: 0,
		})
		send(socket, { type: 'output', attachmentId: attA, data: 'a-late', seq: 9 })
		expect(harness.terminals.at(-1)?.writes.slice(writesBefore) ?? []).toEqual([])

		const attC = commitAttach(socket, 'c')
		expect(window.term?.isConnected()).toBe(true)
		window.term?.input('for-c', true)
		expect(sentFrames(socket).at(-1)).toMatchObject({
			type: 'input',
			attachmentId: attC,
			data: 'for-c',
		})
		expect(localStorage.getItem('herdweb:lastTargetId:/')).toBe('c')
		expect(window.location.search).toBe('?target=c')
	})

	test('rotation during syncing supersedes with the latest geometry', async () => {
		const socket = await boot()
		openWithTargets(socket, [target('default')])
		const first = lastAttach(socket)
		send(socket, {
			type: 'attach-started',
			requestId: first.requestId,
			targetId: 'default',
			attachmentId: 'att-old',
		})

		const term = harness.terminals.at(-1)
		if (!term) throw new Error('no terminal')
		term.cols = 100
		term.rows = 40
		window.__herdwebResize?.()
		const second = lastAttach(socket)
		expect(second).toMatchObject({ cols: 100, rows: 40 })
		expect(second.requestId).not.toBe(first.requestId)

		// The superseded snapshot must not be treated as success.
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-old',
			data: 'stale',
			sessionId: 's',
			outputWatermark: 0,
		})
		expect(term.writes).toEqual([])
		expect(sentFrames(socket).some((frame) => frame.type === 'snapshot-applied')).toBe(false)

		send(socket, {
			type: 'attach-started',
			requestId: second.requestId,
			targetId: 'default',
			attachmentId: 'att-new',
		})
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-new',
			data: 'fresh',
			sessionId: 's',
			outputWatermark: 0,
		})
		expect(term.writes).toEqual(['<reset>', 'fresh'])
	})

	test('snapshot-applied waits for the last buffered output write callback', async () => {
		const socket = await boot()
		const term = harness.terminals.at(-1)
		if (!term) throw new Error('no terminal')
		term.holdCallbacks = true
		openWithTargets(socket, [target('default')])
		const attach = lastAttach(socket)
		send(socket, {
			type: 'attach-started',
			requestId: attach.requestId,
			targetId: 'default',
			attachmentId: 'att-1',
		})
		send(socket, { type: 'output', attachmentId: 'att-1', data: 'one', seq: 1 })
		send(socket, { type: 'output', attachmentId: 'att-1', data: 'two', seq: 2 })
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-1',
			data: 'snap',
			sessionId: 's',
			outputWatermark: 0,
		})

		expect(term.writes).toEqual(['<reset>', 'snap', 'one', 'two'])
		expect(term.heldCallbacks).toHaveLength(3)
		expect(sentFrames(socket).some((frame) => frame.type === 'snapshot-applied')).toBe(false)
		term.heldCallbacks[0]?.()
		term.heldCallbacks[1]?.()
		expect(sentFrames(socket).some((frame) => frame.type === 'snapshot-applied')).toBe(false)
		term.heldCallbacks[2]?.()
		expect(sentFrames(socket).at(-1)).toMatchObject({
			type: 'snapshot-applied',
			attachmentId: 'att-1',
		})

		// Input stays closed until the matching attach-committed arrives.
		window.term?.input('early', true)
		expect(sentFrames(socket).some((frame) => frame.type === 'input')).toBe(false)
		send(socket, {
			type: 'attach-committed',
			requestId: attach.requestId,
			targetId: 'default',
			attachmentId: 'att-1',
		})
		window.term?.input('late-ok', true)
		expect(sentFrames(socket).at(-1)).toMatchObject({ type: 'input', data: 'late-ok' })
	})

	test('URL and lastTargetId persist only after a matching attach-committed', async () => {
		const socket = await boot({ mode: 'explicit' })
		openWithTargets(socket, [target('default'), target('workbox')])
		window.term?.selectTarget?.('workbox')
		const attach = lastAttach(socket)
		send(socket, {
			type: 'attach-started',
			requestId: attach.requestId,
			targetId: 'workbox',
			attachmentId: 'att-w',
		})
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-w',
			data: 'snap',
			sessionId: 's',
			outputWatermark: 0,
		})
		expect(sentFrames(socket).at(-1)).toMatchObject({ type: 'snapshot-applied' })
		expect(localStorage.getItem('herdweb:lastTargetId:/')).toBeNull()
		expect(window.location.search).toBe('')
		window.term?.input('blocked', true)
		expect(sentFrames(socket).some((frame) => frame.type === 'input')).toBe(false)

		send(socket, {
			type: 'attach-committed',
			requestId: attach.requestId,
			targetId: 'workbox',
			attachmentId: 'att-w',
		})
		expect(localStorage.getItem('herdweb:lastTargetId:/')).toBe('workbox')
		expect(window.location.search).toBe('?target=workbox')
	})
})

describe('client render backlog (T4c)', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(0)
		localStorage.clear()
		harness.sockets.length = 0
		harness.terminals.length = 0
		let uuid = 0
		vi.stubGlobal('crypto', { randomUUID: () => `uuid-${uuid++}` })
		vi.stubGlobal('WebSocket', FakeSocket)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	const MIB = 1024 * 1024
	// '🙂' is 4 UTF-8 bytes in 2 UTF-16 units — locks byte (not string length) accounting.
	const halfMiB = (): string => '🙂'.repeat(MIB / 8)

	test('stuck xterm callbacks with bufferedAmount=0 fail loud at 1 MiB and close this socket', async () => {
		const socket = await boot()
		const term = harness.terminals.at(-1)
		if (!term) throw new Error('no terminal')
		openWithTargets(socket, [target('default')])
		const attachmentId = commitAttach(socket, 'default')
		term.holdCallbacks = true
		expect(socket.bufferedAmount).toBe(0)

		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('herdweb-connection-notice', onNotice)
		send(socket, { type: 'output', attachmentId, data: halfMiB(), seq: 1 })
		send(socket, { type: 'output', attachmentId, data: halfMiB(), seq: 2 })
		// Exactly 1 MiB pending is still accepted; one more byte trips the hard limit.
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		const writesBefore = term.writes.length
		send(socket, { type: 'output', attachmentId, data: 'x', seq: 3 })
		window.removeEventListener('herdweb-connection-notice', onNotice)

		expect(term.writes).toHaveLength(writesBefore)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(window.term?.getConnectionStatus().lastFailureReason).toBe('client-render-backlog')
		expect(notice).toContain('render')
	})

	test('late callbacks from a dead epoch release their own token once and never touch the new ledger', async () => {
		const socket = await boot()
		const term = harness.terminals.at(-1)
		if (!term) throw new Error('no terminal')
		openWithTargets(socket, [target('default')])
		const attachmentId = commitAttach(socket, 'default')
		term.holdCallbacks = true
		send(socket, { type: 'output', attachmentId, data: 'A'.repeat(1024), seq: 1 })
		const staleCallback = term.heldCallbacks.at(-1)
		if (!staleCallback) throw new Error('no held callback')

		// Reconnect: new epoch, fresh ledger. Old callback fires late (twice).
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		document.dispatchEvent(new Event('visibilitychange'))
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		const nextSocket = harness.sockets.at(-1)
		if (!nextSocket || nextSocket === socket) throw new Error('no new socket')
		term.holdCallbacks = false
		openWithTargets(nextSocket, [target('default')])
		const nextAttachment = commitAttach(nextSocket, 'default')

		term.holdCallbacks = true
		send(nextSocket, { type: 'output', attachmentId: nextAttachment, data: halfMiB(), seq: 1 })
		send(nextSocket, { type: 'output', attachmentId: nextAttachment, data: halfMiB(), seq: 2 })
		staleCallback()
		staleCallback()
		// The new ledger must still be exactly full: one more byte overflows.
		send(nextSocket, { type: 'output', attachmentId: nextAttachment, data: 'x', seq: 3 })
		expect(nextSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(window.term?.getConnectionStatus().lastFailureReason).toBe('client-render-backlog')
	})

	test('overflow during snapshot sync never sends snapshot-applied nor opens input', async () => {
		const socket = await boot()
		const term = harness.terminals.at(-1)
		if (!term) throw new Error('no terminal')
		term.holdCallbacks = true
		openWithTargets(socket, [target('default')])
		const attach = lastAttach(socket)
		send(socket, {
			type: 'attach-started',
			requestId: attach.requestId,
			targetId: 'default',
			attachmentId: 'att-big',
		})
		send(socket, { type: 'output', attachmentId: 'att-big', data: halfMiB(), seq: 1 })
		send(socket, { type: 'output', attachmentId: 'att-big', data: 'B'.repeat(1024), seq: 2 })
		send(socket, {
			type: 'snapshot',
			attachmentId: 'att-big',
			data: halfMiB(),
			sessionId: 's',
			outputWatermark: 0,
		})

		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(window.term?.getConnectionStatus().lastFailureReason).toBe('client-render-backlog')
		expect(sentFrames(socket).some((frame) => frame.type === 'snapshot-applied')).toBe(false)
		window.term?.input('blocked', true)
		expect(sentFrames(socket).some((frame) => frame.type === 'input')).toBe(false)
	})
})
