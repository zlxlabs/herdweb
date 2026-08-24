import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ConnectionStatus } from '../src/types'

const harness = vi.hoisted(() => ({
	sockets: [] as FakeSocket[],
	terminal: undefined as FakeTerminal | undefined,
}))

class FakeTerminal {
	readonly options = { fontSize: 14 }
	readonly unicode = { activeVersion: '' }
	readonly writes: string[] = []
	cols = 80
	rows = 24

	constructor() {
		harness.terminal = this
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
		callback?.()
	}
}

class FakeSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSED = 3
	readonly sent: string[] = []
	readonly received: string[] = []
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
		this.received.push(data)
		this.dispatchEvent(new MessageEvent('message', { data }))
	}
}

function currentAttachment(socket: FakeSocket): string | undefined {
	for (const payload of [...socket.received].reverse()) {
		const message = JSON.parse(payload) as Record<string, unknown>
		if (message.type === 'attach-started' && typeof message.attachmentId === 'string') {
			return message.attachmentId
		}
	}
	return undefined
}

const scopedTypes = new Set([
	'snapshot',
	'output',
	'exit',
	'error',
	'input-accepted',
	'input-rejected',
])

function receive(socket: FakeSocket, message: Record<string, unknown>): void {
	if (message.type === 'pong' && typeof message.id === 'string') {
		socket.receive(JSON.stringify({ type: 'pong', nonce: message.id }))
		return
	}
	const body = { ...message }
	if (typeof body.attachmentId !== 'string' && scopedTypes.has(String(body.type))) {
		body.attachmentId = currentAttachment(socket)
	}
	socket.receive(JSON.stringify(body))
	if (body.type !== 'snapshot') return
	const applied = JSON.parse(socket.sent.at(-1) ?? 'null') as Record<string, unknown>
	if (applied.type !== 'snapshot-applied') return
	socket.receive(
		JSON.stringify({
			type: 'attach-committed',
			requestId: applied.requestId,
			targetId: 'default',
			attachmentId: applied.attachmentId,
		}),
	)
}

function currentSocket(): FakeSocket {
	const socket = harness.sockets[harness.sockets.length - 1]
	if (!socket) throw new Error('test harness has no socket')
	return socket
}

type Started = { requestId: string; attachmentId: string; targetId: string }

function startAttachment(
	socket: FakeSocket,
	attachmentId = `attachment-${socket.received.length}`,
): Started {
	const attach = JSON.parse(socket.sent.at(-1) as string) as { requestId: string; targetId: string }
	const started = { requestId: attach.requestId, targetId: attach.targetId, attachmentId }
	receive(socket, { type: 'attach-started', ...started })
	return started
}

function openWithTargets(
	socket: FakeSocket,
	processState: 'process-running' | 'process-exited',
): void {
	socket.open()
	receive(socket, { type: 'server-ready', protocol: 2 })
	receive(socket, {
		type: 'targets',
		targets: [
			{ id: 'default', name: 'Default', processState, capabilities: { imageDrop: 'disabled' } },
		],
	})
}

function openWithAttach(socket: FakeSocket): Started {
	openWithTargets(socket, 'process-running')
	return startAttachment(socket)
}

function expectSessionOverlay(display: 'flex' | 'none', text?: string): void {
	const overlay = document.querySelector<HTMLDivElement>('#herdweb-session-status')
	expect(overlay?.style.display).toBe(display)
	if (text) expect(overlay?.textContent).toContain(text)
}

function expectEnded(): void {
	expect(getStatus().state).toBe('disconnected')
	expectSessionOverlay('flex', 'Session ended')
}

function expectNoAttachment(socket: FakeSocket): void {
	expect(socket.sent.some((payload) => JSON.parse(payload).type === 'attach-target')).toBe(false)
}

function getStatus(): ConnectionStatus {
	const status = harness.terminal && window.term?.getConnectionStatus()
	if (!status) throw new Error('test harness has no connection status')
	return status
}

function setVisibility(state: 'hidden' | 'visible'): void {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

function pagehideEvent(persisted: boolean): Event {
	const event = new Event('pagehide')
	Object.defineProperty(event, 'persisted', { configurable: true, value: persisted })
	return event
}

function pageshowEvent(persisted: boolean): Event {
	const event = new Event('pageshow')
	Object.defineProperty(event, 'persisted', { configurable: true, value: persisted })
	return event
}

async function freshAttempt(): Promise<FakeSocket> {
	setVisibility('hidden')
	document.dispatchEvent(new Event('visibilitychange'))
	setVisibility('visible')
	document.dispatchEvent(new Event('visibilitychange'))
	await vi.advanceTimersByTimeAsync(0)
	return currentSocket()
}

async function freshSynced(snapshot = 'snapshot'): Promise<FakeSocket> {
	const socket = await freshAttempt()
	const started = openWithAttach(socket)
	receive(socket, {
		type: 'snapshot',
		attachmentId: started.attachmentId,
		data: snapshot,
		sessionId: `session-${started.attachmentId}`,
		outputWatermark: 0,
	})
	return socket
}

async function freshPreSyncAttempt(): Promise<FakeSocket> {
	await freshSynced()
	return freshAttempt()
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit(): void {}
	},
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../src/index', () => ({
	createHookRegistry: () => ({}),
	init: vi.fn(),
}))

describe('client connection state machine', () => {
	let socket: FakeSocket

	beforeAll(async () => {
		vi.useFakeTimers()
		document.body.innerHTML = '<div id="terminal"></div>'
		Object.defineProperty(globalThis, '__herdwebConfig', {
			configurable: true,
			value: {
				name: 'test',
				theme: { background: '#000' },
				font: { family: 'monospace', mobileSizeDefault: 13 },
				reconnect: { enabled: false },
			},
		})
		Object.defineProperty(globalThis, '__herdwebBasePath', { configurable: true, value: '/' })
		vi.stubGlobal('WebSocket', FakeSocket)
		vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `ping-${harness.sockets.length}`) })
		await import('../src/client-entry')
		socket = harness.sockets[0] as FakeSocket
	})

	beforeEach(() => {
		vi.setSystemTime(0)
	})

	afterEach(async () => {
		// exitReceived lives in the module under test, so an ended test must be
		// recovered through the real restart path to avoid leaking into the next test.
		const overlay = document.querySelector<HTMLDivElement>('#herdweb-session-status')
		if (overlay?.style.display !== 'flex') return
		if (currentSocket().readyState !== FakeSocket.OPEN) {
			window.term?.requestReconnect()
			await vi.advanceTimersByTimeAsync(0)
			openWithTargets(currentSocket(), 'process-exited')
		}
		const socket = currentSocket()
		receive(socket, { type: 'target-restarted', targetId: 'default', sessionId: 'cleanup' })
		startAttachment(socket)
		receive(socket, {
			type: 'snapshot',
			data: 'cleanup',
			sessionId: 'cleanup',
			outputWatermark: 0,
		})
	})

	afterAll(async () => {
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test('initial load keeps its sole CONNECTING socket when pageshow arrives', async () => {
		expect(harness.sockets).toHaveLength(1)
		const initialSocket = currentSocket()
		window.dispatchEvent(pageshowEvent(false))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(1)
		expect(currentSocket()).toBe(initialSocket)
		expect(initialSocket.readyState).toBe(FakeSocket.CONNECTING)
	})

	test('drops input while syncing, then emits ping before the coalesced resize after snapshot', () => {
		const terminal = harness.terminal as FakeTerminal
		window.term?.input('dangerous-command\r', true)
		expect(socket.sent).toEqual([])

		openWithAttach(socket)
		expect(window.term?.isConnected()).toBe(false)
		terminal.cols = 90
		terminal.rows = 30
		window.__herdwebResize?.()
		startAttachment(socket, 'latest-attachment')
		terminal.cols = 100
		terminal.rows = 40
		window.__herdwebResize?.()

		const started = startAttachment(socket, 'latest-attachment')
		receive(socket, { type: 'output', data: 'five', seq: 5 })
		receive(socket, { type: 'output', data: 'four', seq: 4 })
		receive(socket, {
			type: 'snapshot',
			attachmentId: started.attachmentId,
			data: 'snapshot',
			sessionId: 'session-1',
			outputWatermark: 3,
		})

		expect(window.term?.isConnected()).toBe(true)
		expect(socket.sent.map((payload) => JSON.parse(payload)).at(-1)).toMatchObject({ type: 'ping' })
		expect(terminal.writes).toEqual(['<reset>', 'snapshot', 'four', 'five'])
	})

	test('a fresh connection to an exited target stays ended without attaching', async () => {
		const socket = await freshAttempt()
		openWithTargets(socket, 'process-exited')
		expectEnded()
		expectNoAttachment(socket)
	})

	test('snapshot freshness permits immediate ordinary input', async () => {
		const socket = await freshSynced()
		const sentBefore = socket.sent.length
		window.term?.input('fresh-input', true)
		expect(socket.sent).toHaveLength(sentBefore + 1)
		expect(JSON.parse(socket.sent[sentBefore] as string)).toEqual({
			type: 'input',
			attachmentId: expect.any(String),
			data: 'fresh-input',
		})
	})

	test('matching pong refreshes an otherwise stale freshness proof', async () => {
		const socket = await freshSynced()
		const firstPing = JSON.parse(socket.sent.at(-1) as string) as { nonce: string }
		vi.setSystemTime(24_000)
		receive(socket, { type: 'pong', nonce: firstPing.nonce })
		vi.setSystemTime(26_000)

		const sentBefore = socket.sent.length
		window.term?.input('pong-refreshed', true)
		expect(socket.sent).toHaveLength(sentBefore + 1)
		expect(JSON.parse(socket.sent[sentBefore] as string)).toEqual({
			type: 'input',
			attachmentId: expect.any(String),
			data: 'pong-refreshed',
		})
	})

	test('a recent pong prevents a false freshness failure at 24 seconds', async () => {
		const socket = await freshSynced()
		const firstPing = JSON.parse(socket.sent.at(-1) as string) as { nonce: string }
		vi.setSystemTime(10_000)
		receive(socket, { type: 'pong', nonce: firstPing.nonce })
		vi.setSystemTime(24_000)

		const sentBefore = socket.sent.length
		window.term?.input('within-freshness-window', true)
		expect(socket.sent).toHaveLength(sentBefore + 1)
	})

	test('a mismatched pong cannot refresh stale input freshness', async () => {
		const socket = await freshSynced()
		vi.setSystemTime(26_000)
		receive(socket, { type: 'pong', id: 'wrong-pong-id' })
		const sentBefore = socket.sent.length
		window.term?.input('wrong-pong-input', true)

		expect(socket.sent).toHaveLength(sentBefore)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('heartbeat-timeout')
	})

	test.each([
		[26_000, 'stale-after-26-seconds'],
		[1_800_000, 'stale-after-30-minutes'],
	] as const)('stale freshness drops input and starts reconnecting (%i ms)', async (age, data) => {
		const socket = await freshSynced()
		const sentBefore = socket.sent.length
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('herdweb-connection-notice', onNotice)
		vi.setSystemTime(age)
		window.term?.input(data, true)
		window.removeEventListener('herdweb-connection-notice', onNotice)

		expect(socket.sent).toHaveLength(sentBefore)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
		expect(getStatus().lastFailureReason).toBe('heartbeat-timeout')
		expect(notice).toBe('Not sent — still syncing.')
	})

	test('a fresh snapshot restores input after freshness-triggered reconnect', async () => {
		await freshSynced()
		vi.setSystemTime(26_000)
		window.term?.input('stale-input', true)
		await vi.advanceTimersByTimeAsync(1_000)

		const nextSocket = currentSocket()
		openWithAttach(nextSocket)
		receive(nextSocket, {
			type: 'snapshot',
			data: 'fresh-again',
			sessionId: 'fresh-again-session',
			outputWatermark: 0,
		})
		const sentBefore = nextSocket.sent.length
		window.term?.input('recovered-input', true)
		expect(nextSocket.sent).toHaveLength(sentBefore + 1)
		expect(JSON.parse(nextSocket.sent[sentBefore] as string)).toEqual({
			type: 'input',
			attachmentId: expect.any(String),
			data: 'recovered-input',
		})
	})

	test('stale freshness does not gate resize', async () => {
		const socket = await freshSynced()
		const terminal = harness.terminal as FakeTerminal
		vi.setSystemTime(26_000)
		terminal.cols = 111
		terminal.rows = 37
		window.__herdwebResize?.()

		const frames = socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
		expect(frames.at(-1)).toMatchObject({
			type: 'resize',
			attachmentId: expect.any(String),
			cols: 111,
			rows: 37,
		})
		expect(getStatus().state).toBe('synced')
	})

	test('matching heartbeats keep five minutes of normal input fresh', async () => {
		const socket = await freshSynced()
		for (let index = 0; index < 30; index += 1) {
			const pings = socket.sent
				.map((payload) => JSON.parse(payload) as Record<string, unknown>)
				.filter((frame) => frame.type === 'ping')
			const ping = pings[pings.length - 1]
			if (typeof ping?.nonce !== 'string') throw new Error('test harness did not observe a ping')
			receive(socket, { type: 'pong', nonce: ping.nonce })
			await vi.advanceTimersByTimeAsync(10_000)
		}

		const sentBefore = socket.sent.length
		window.term?.input('five-minute-input', true)
		expect(socket.sent).toHaveLength(sentBefore + 1)
		expect(JSON.parse(socket.sent[sentBefore] as string)).toEqual({
			type: 'input',
			attachmentId: expect.any(String),
			data: 'five-minute-input',
		})
	})

	test('only a matching pong schedules the next single ping', async () => {
		const activeSocket = await freshSynced()
		activeSocket.receive(JSON.stringify({ type: 'pong', nonce: 'late-or-wrong' }))
		await vi.advanceTimersByTimeAsync(10_000)
		const currentPing = activeSocket.sent
			.map((payload) => JSON.parse(payload) as { type: string; nonce?: string })
			.filter((frame) => frame.type === 'ping')
			.at(-1)
		if (!currentPing?.nonce) throw new Error('test harness did not observe the current ping')
		activeSocket.receive(JSON.stringify({ type: 'pong', nonce: currentPing.nonce }))
		await vi.advanceTimersByTimeAsync(9_999)
		expect(activeSocket.sent.filter((payload) => JSON.parse(payload).type === 'ping')).toHaveLength(
			1,
		)
		await vi.advanceTimersByTimeAsync(1)
		expect(activeSocket.sent.filter((payload) => JSON.parse(payload).type === 'ping')).toHaveLength(
			2,
		)
	})

	test.each([
		['hidden', 'visibilitychange', false],
		['pagehide', 'pagehide', false],
		['pagehide-persisted', 'pagehide', true],
	] as const)('%s suspends a synced socket and clears timers', async (_name, event, persisted) => {
		const oldSocket = await freshSynced()
		const socketCount = harness.sockets.length
		if (event === 'visibilitychange') {
			setVisibility('hidden')
			document.dispatchEvent(new Event('visibilitychange'))
		} else {
			window.dispatchEvent(pagehideEvent(persisted))
		}

		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('disconnected')
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('visible replaces an OPEN socket and isolates its later events', async () => {
		const oldSocket = await freshSynced()
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socketCount = harness.sockets.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)

		const newSocket = currentSocket()
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(newSocket).not.toBe(oldSocket)
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
		openWithAttach(oldSocket)
		receive(oldSocket, {
			type: 'snapshot',
			data: 'stale',
			sessionId: 'stale-session',
			outputWatermark: 0,
		})
		receive(oldSocket, { type: 'output', data: 'stale-output', seq: 1 })
		expect(terminal.writes).toHaveLength(writesBefore)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('pageshow creates a new epoch for an OPEN synced socket', async () => {
		const oldSocket = await freshSynced()
		const socketCount = harness.sockets.length
		window.dispatchEvent(pageshowEvent(true))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(currentSocket()).not.toBe(oldSocket)
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('non-persisted pageshow preserves a fresh synced socket', async () => {
		const freshSocket = await freshSynced()
		const socketCount = harness.sockets.length
		window.dispatchEvent(pageshowEvent(false))
		await Promise.resolve()

		expect(harness.sockets).toHaveLength(socketCount)
		expect(currentSocket()).toBe(freshSocket)
		expect(getStatus().state).toBe('synced')
	})

	test.each([
		['no lifecycle event while timers are frozen', 25_001],
		['synced status cannot hide stale proof', 30_000],
	] as const)('non-persisted pageshow reconnects after %s', async (_name, now) => {
		const staleSocket = await freshSynced()
		const socketCount = harness.sockets.length
		vi.setSystemTime(now)
		expect(getStatus().state).toBe('synced')
		window.dispatchEvent(pageshowEvent(false))
		await Promise.resolve()

		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(currentSocket()).not.toBe(staleSocket)
		expect(staleSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('visible replaces an OPEN socket that is still syncing', async () => {
		const oldSocket = await freshAttempt()
		openWithAttach(oldSocket)
		const socketCount = harness.sockets.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(currentSocket()).not.toBe(oldSocket)
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
	})

	test.each(['pageshow', 'online'] as const)(
		'%s during a CONNECTING handshake leaves the socket in place',
		async (event) => {
			const connectingSocket = await freshAttempt()
			const socketCount = harness.sockets.length
			window.dispatchEvent(new Event(event))
			await vi.advanceTimersByTimeAsync(0)

			expect(harness.sockets).toHaveLength(socketCount)
			expect(currentSocket()).toBe(connectingSocket)
			expect(connectingSocket.readyState).toBe(FakeSocket.CONNECTING)
		},
	)

	test('non-persisted pageshow during OPEN syncing handshake preserves sole socket', async () => {
		const syncingSocket = await freshAttempt()
		openWithAttach(syncingSocket)
		expect(getStatus().state).toBe('syncing')
		// lastProvenFreshAt stays 0 until snapshot; with real clocks that fails the
		// freshness-only guard and WebKit would spawn a second socket on pageshow.
		vi.setSystemTime(30_000)
		const socketCount = harness.sockets.length
		window.dispatchEvent(pageshowEvent(false))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(socketCount)
		expect(currentSocket()).toBe(syncingSocket)
	})

	test('visibility, online, and pageshow in one turn create one socket', async () => {
		await freshSynced()
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		const socketCount = harness.sockets.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		window.dispatchEvent(new Event('online'))
		window.dispatchEvent(new Event('pageshow'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('online while visible retries a disconnected page immediately', async () => {
		await freshSynced()
		currentSocket().close()
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('online while synced does not create a replacement socket', async () => {
		const syncedSocket = await freshSynced()
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(socketCount)
		expect(currentSocket()).toBe(syncedSocket)
	})

	test('online while hidden does not create a socket', async () => {
		await freshSynced()
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test.each([
		['online', 'online'],
		['offline→online', 'offline-online'],
		['hidden→visible', 'visibility'],
		['pagehide→pageshow', 'page'],
	] as const)('ended target survives %s', async (_, event) => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		const socketCount = harness.sockets.length
		if (event === 'visibility') {
			setVisibility('hidden')
			document.dispatchEvent(new Event('visibilitychange'))
			setVisibility('visible')
			document.dispatchEvent(new Event('visibilitychange'))
		} else if (event === 'page') {
			window.dispatchEvent(pagehideEvent(false))
			window.dispatchEvent(pageshowEvent(true))
		} else {
			for (const type of event.split('-')) window.dispatchEvent(new Event(type))
		}
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		const nextSocket = currentSocket()
		openWithTargets(nextSocket, 'process-exited')
		expectEnded()
		expectNoAttachment(nextSocket)
	})

	test('a CONNECTING socket failure follows the existing backoff path', async () => {
		const connectingSocket = await freshAttempt()
		const socketCount = harness.sockets.length
		connectingSocket.dispatchEvent(new Event('error'))

		expect(connectingSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
		await vi.advanceTimersByTimeAsync(999)
		expect(harness.sockets).toHaveLength(socketCount)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test.each(['snapshot', 'output'] as const)('old epoch %s is discarded', async (kind) => {
		const oldSocket = await freshSynced()
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		if (kind === 'snapshot') {
			receive(oldSocket, {
				type: 'snapshot',
				data: 'old snapshot',
				sessionId: 'old-session',
				outputWatermark: 0,
			})
		} else {
			receive(oldSocket, { type: 'output', data: 'old output', seq: 1 })
		}
		expect(terminal.writes).toHaveLength(writesBefore)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('old epoch pong does not renew the current heartbeat deadline', async () => {
		const oldSocket = await freshSynced()
		const oldPing = oldSocket.sent
			.map((payload) => JSON.parse(payload) as { type: string; nonce?: string })
			.find((frame) => frame.type === 'ping')
		if (!oldPing?.nonce) throw new Error('test harness did not observe the old ping')
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		const newSocket = currentSocket()
		openWithAttach(newSocket)
		receive(newSocket, {
			type: 'snapshot',
			data: 'new snapshot',
			sessionId: 'new-session',
			outputWatermark: 0,
		})
		oldSocket.receive(JSON.stringify({ type: 'pong', nonce: oldPing.nonce }))
		await vi.advanceTimersByTimeAsync(14_999)
		expect(newSocket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(newSocket.readyState).toBe(FakeSocket.CLOSED)
	})

	test('old epoch close and error do not count or schedule a failure', async () => {
		const oldSocket = await freshSynced()
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		const socketCount = harness.sockets.length
		oldSocket.dispatchEvent(new Event('error'))
		oldSocket.dispatchEvent(new Event('close'))
		await vi.advanceTimersByTimeAsync(0)
		expect(getStatus().consecutivePreSyncFailures).toBe(0)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('old epoch open is ignored and cannot enter syncing', async () => {
		const oldSocket = await freshAttempt()
		openWithAttach(oldSocket)
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		openWithAttach(oldSocket)
		expect(getStatus().state).toBe('reconnecting')
	})

	test.each([
		[1, 1_000],
		[2, 2_000],
		[3, 4_000],
		[4, 8_000],
		[5, 15_000],
		[6, 15_000],
	] as const)('failure #%i schedules the next attempt after %ims', async (failureNumber, delay) => {
		await freshSynced()
		await freshAttempt()
		const backoffs = [1_000, 2_000, 4_000, 8_000, 15_000]
		for (let index = 0; index < failureNumber; index += 1) {
			const countBeforeFailure = harness.sockets.length
			currentSocket().close()
			expect(getStatus().consecutivePreSyncFailures).toBe(index + 1)
			if (index < failureNumber - 1) {
				await vi.advanceTimersByTimeAsync(backoffs[index] as number)
				expect(harness.sockets).toHaveLength(countBeforeFailure + 1)
			}
		}
		const countBeforeDelay = harness.sockets.length
		await vi.advanceTimersByTimeAsync(delay - 1)
		expect(harness.sockets).toHaveLength(countBeforeDelay)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(countBeforeDelay + 1)
	})

	test('an open socket without a snapshot times out as one pre-sync failure', async () => {
		const socket = await freshPreSyncAttempt()
		openWithAttach(socket)
		await vi.advanceTimersByTimeAsync(9_999)
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
		expect(getStatus().lastFailureReason).toBe('snapshot-timeout')
	})

	test('a snapshot clears failures and restores the one-second backoff', async () => {
		await freshSynced()
		currentSocket().close()
		await vi.advanceTimersByTimeAsync(1_000)
		const socket = currentSocket()
		openWithAttach(socket)
		receive(socket, {
			type: 'snapshot',
			data: 'recovered',
			sessionId: 'recovered-session',
			outputWatermark: 0,
		})
		expect(getStatus()).toEqual({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const countBeforeFailure = harness.sockets.length
		socket.close()
		await vi.advanceTimersByTimeAsync(999)
		expect(harness.sockets).toHaveLength(countBeforeFailure)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(countBeforeFailure + 1)
	})

	test('hidden clears a pending reconnect timer until visible', async () => {
		await freshSynced()
		currentSocket().close()
		const socketCount = harness.sockets.length
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(15_000)
		expect(harness.sockets).toHaveLength(socketCount)
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('manual retry is immediate and preserves the failure count', async () => {
		await freshSynced()
		await freshAttempt()
		currentSocket().close()
		const socketCount = harness.sockets.length
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test.each([
		[3, ['four', 'five']],
		[5, []],
	] as const)('snapshot watermark %i filters buffered seq values', async (watermark, expected) => {
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socket = await freshAttempt()
		openWithAttach(socket)
		for (let seq = 1; seq <= 5; seq += 1) {
			receive(socket, {
				type: 'output',
				data: ['one', 'two', 'three', 'four', 'five'][seq - 1],
				seq,
			})
		}
		receive(socket, {
			type: 'snapshot',
			data: 'watermarked',
			sessionId: `watermark-${watermark}`,
			outputWatermark: watermark,
		})
		expect(terminal.writes.slice(writesBefore)).toEqual(['<reset>', 'watermarked', ...expected])
	})

	test('buffered output arriving out of order is applied by seq', async () => {
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socket = await freshAttempt()
		openWithAttach(socket)
		receive(socket, { type: 'output', data: 'five', seq: 5 })
		receive(socket, { type: 'output', data: 'four', seq: 4 })
		receive(socket, {
			type: 'snapshot',
			data: 'ordered',
			sessionId: 'ordered-session',
			outputWatermark: 0,
		})
		expect(terminal.writes.slice(writesBefore)).toEqual(['<reset>', 'ordered', 'four', 'five'])
	})

	test('pre-snapshot output over one MiB closes the socket and retries', async () => {
		const socket = await freshPreSyncAttempt()
		openWithAttach(socket)
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('herdweb-connection-notice', onNotice)
		receive(socket, { type: 'output', data: '🙂'.repeat(262_145), seq: 1 })
		window.removeEventListener('herdweb-connection-notice', onNotice)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('output-overflow')
		expect(notice).toBe('Output too fast — resyncing.')
		const socketCount = harness.sockets.length
		await vi.advanceTimersByTimeAsync(999)
		expect(harness.sockets).toHaveLength(socketCount)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('malformed server frames are protocol errors rather than silent drops', async () => {
		const socket = await freshPreSyncAttempt()
		openWithAttach(socket)
		socket.receive('{not-json')
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('protocol-error')
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
	})

	test('exit immediately ends the target without closing the control socket', async () => {
		const socket = await freshSynced()
		const socketCount = harness.sockets.length
		const pingCount = socket.sent.filter((payload) => JSON.parse(payload).type === 'ping').length
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('herdweb-connection-notice', onNotice)
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		expect(getStatus().state).toBe('disconnected')
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		expect(
			document.querySelector<HTMLDivElement>('#herdweb-session-status')?.textContent,
		).toContain('Session ended')
		window.term?.input('must-not-be-sent', true)
		await vi.advanceTimersByTimeAsync(20_000)
		window.removeEventListener('herdweb-connection-notice', onNotice)
		expect(notice).toBe('Session ended — restart herdweb to start a new one.')
		expect(harness.sockets).toHaveLength(socketCount)
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		expect(socket.sent.filter((payload) => JSON.parse(payload).type === 'ping')).toHaveLength(
			pingCount,
		)
	})

	test('retrying an ended session stays ended for an exited target', async () => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		const socketCount = harness.sockets.length
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		const retrySocket = currentSocket()
		openWithTargets(retrySocket, 'process-exited')
		expectEnded()
		expectNoAttachment(retrySocket)
		retrySocket.close()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(getStatus().state).toBe('disconnected')
	})

	test('target-process-exited attach rejection keeps the ended state', async () => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		socket.close()
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		const retrySocket = currentSocket()
		openWithTargets(retrySocket, 'process-exited')
		receive(retrySocket, { type: 'target-restarted', targetId: 'default', sessionId: 'restarted' })
		const started = startAttachment(retrySocket, 'rejected-attachment')
		receive(retrySocket, {
			type: 'attach-rejected',
			requestId: started.requestId,
			targetId: started.targetId,
			reason: 'target-process-exited',
		})
		expectEnded()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(currentSocket()).toBe(retrySocket)
	})

	test('target-restarted reuses the open control socket after exit', async () => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		receive(socket, { type: 'target-restarted', targetId: 'default', sessionId: 'new-session' })
		expect(currentSocket()).toBe(socket)
		const started = startAttachment(socket)
		expect(getStatus().state).toBe('syncing')
		expectSessionOverlay('flex', 'Session ended')
		const sentBefore = socket.sent.length
		window.term?.input('blocked-before-commit', true)
		expect(window.term?.sendInputAction('blocked-action', 'blocked')).toBe(false)
		expect(socket.sent).toHaveLength(sentBefore)
		receive(socket, {
			type: 'snapshot',
			attachmentId: started.attachmentId,
			data: 'restarted session',
			sessionId: 'new-session',
			outputWatermark: 0,
		})
		expect(getStatus().state).toBe('synced')
		expectSessionOverlay('none')
		window.term?.input('live-after-commit', true)
		expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({
			type: 'input',
			attachmentId: started.attachmentId,
			data: 'live-after-commit',
		})
	})

	test('a fresh epoch emits only the final resize after syncing', async () => {
		await freshSynced()
		const socket = await freshAttempt()
		const terminal = harness.terminal as FakeTerminal
		terminal.cols = 120
		terminal.rows = 45
		window.__herdwebResize?.()
		terminal.cols = 140
		terminal.rows = 50
		window.__herdwebResize?.()
		window.term?.input('must-not-be-replayed', true)
		expect(socket.sent).toEqual([])

		openWithAttach(socket)
		receive(socket, {
			type: 'snapshot',
			data: 'fresh',
			sessionId: 'fresh-session',
			outputWatermark: 0,
		})
		const frames = socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
		expect(frames.filter((frame) => frame.type === 'attach-target').at(-1)).toMatchObject({
			type: 'attach-target',
			cols: 140,
			rows: 50,
		})
		expect(frames.some((frame) => frame.type === 'ping' && typeof frame.nonce === 'string')).toBe(
			true,
		)
		expect(frames.some((frame) => frame.type === 'resize')).toBe(false)
	})

	test('freeze suspends a synced socket through the pagehide path', async () => {
		const oldSocket = await freshSynced()
		const socketCount = harness.sockets.length
		document.dispatchEvent(new Event('freeze'))
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('disconnected')
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('resume starts a new epoch and requires a new snapshot', async () => {
		const terminal = harness.terminal as FakeTerminal
		const oldSocket = await freshSynced()
		const writesBefore = terminal.writes.length
		document.dispatchEvent(new Event('freeze'))
		receive(oldSocket, { type: 'output', data: 'frozen-old-output', seq: 1 })
		document.dispatchEvent(new Event('resume'))
		await vi.advanceTimersByTimeAsync(0)

		const newSocket = currentSocket()
		expect(newSocket).not.toBe(oldSocket)
		expect(getStatus().state).toBe('reconnecting')
		expect(terminal.writes).toHaveLength(writesBefore)
		openWithAttach(newSocket)
		receive(newSocket, {
			type: 'snapshot',
			data: 'fresh-after-resume',
			sessionId: 'resume-session',
			outputWatermark: 1,
		})
		expect(getStatus().state).toBe('synced')
		expect(terminal.writes.slice(writesBefore)).toContain('fresh-after-resume')
	})

	test('resume merged with visible and pageshow creates one socket', async () => {
		await freshSynced()
		document.dispatchEvent(new Event('freeze'))
		const socketCount = harness.sockets.length
		document.dispatchEvent(new Event('resume'))
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		window.dispatchEvent(new Event('pageshow'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('offline immediately invalidates synced and closes its socket', async () => {
		const oldSocket = await freshSynced()
		window.dispatchEvent(new Event('offline'))
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('disconnected')
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('offline input emits no frame and reports the existing discard notice', async () => {
		const socket = await freshSynced()
		const sentBefore = socket.sent.length
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('herdweb-connection-notice', onNotice)
		window.dispatchEvent(new Event('offline'))
		window.term?.input('offline-must-drop', true)
		window.removeEventListener('herdweb-connection-notice', onNotice)
		expect(socket.sent).toHaveLength(sentBefore)
		expect(notice).toBe('Not sent — still syncing.')
	})

	test('offline resize coalesces and sends once after the next snapshot', async () => {
		const socket = await freshSynced()
		const sentBefore = socket.sent.length
		const terminal = harness.terminal as FakeTerminal
		window.dispatchEvent(new Event('offline'))
		terminal.cols = 101
		terminal.rows = 31
		window.__herdwebResize?.()
		terminal.cols = 120
		terminal.rows = 40
		window.__herdwebResize?.()
		expect(socket.sent).toHaveLength(sentBefore)

		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(0)
		const nextSocket = currentSocket()
		openWithAttach(nextSocket)
		receive(nextSocket, {
			type: 'snapshot',
			data: 'online-snapshot',
			sessionId: 'online-session',
			outputWatermark: 0,
		})
		const frames = nextSocket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
		expect(frames.filter((frame) => frame.type === 'attach-target').at(-1)).toMatchObject({
			type: 'attach-target',
			cols: 120,
			rows: 40,
		})
		expect(frames.some((frame) => frame.type === 'ping')).toBe(true)
		expect(frames.some((frame) => frame.type === 'resize')).toBe(false)
	})

	test('buffered input detects a persistently stuck OPEN socket after settling', async () => {
		const socket = await freshSynced()
		socket.bufferedAmount = 1
		const sentBefore = socket.sent.length
		window.term?.input('transient-buffer', true)
		expect(socket.sent).toHaveLength(sentBefore + 1)
		socket.bufferedAmount = 1
		window.term?.input('buffered-must-drop', true)
		expect(socket.sent).toHaveLength(sentBefore + 2)
		await vi.advanceTimersByTimeAsync(100)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
		expect(getStatus().lastFailureReason).toBe('socket-error')
	})

	test('normal input with a transient buffer remains sendable', async () => {
		const socket = await freshSynced()
		socket.bufferedAmount = 1
		window.term?.input('one', true)
		socket.bufferedAmount = 0
		window.term?.input('two', true)
		const frames = socket.sent
			.map((payload) => JSON.parse(payload) as Record<string, unknown>)
			.filter((frame) => frame.type === 'input')
		expect(frames).toEqual([
			{ type: 'input', attachmentId: expect.any(String), data: 'one' },
			{ type: 'input', attachmentId: expect.any(String), data: 'two' },
		])
	})

	test('a network black hole still falls back to the existing heartbeat deadline', async () => {
		const socket = await freshSynced()
		await vi.advanceTimersByTimeAsync(14_999)
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('heartbeat-timeout')
	})

	test('a buffered reachability probe cannot affect the resumed epoch', async () => {
		const oldSocket = await freshSynced()
		oldSocket.bufferedAmount = 1
		window.term?.input('old-epoch-buffer', true)
		document.dispatchEvent(new Event('freeze'))
		document.dispatchEvent(new Event('resume'))
		await vi.advanceTimersByTimeAsync(0)
		const newSocket = currentSocket()
		openWithAttach(newSocket)
		receive(newSocket, {
			type: 'snapshot',
			data: 'resumed',
			sessionId: 'resumed-session',
			outputWatermark: 0,
		})
		await vi.advanceTimersByTimeAsync(100)
		expect(newSocket.readyState).toBe(FakeSocket.OPEN)
		expect(getStatus().state).toBe('synced')
	})

	test('beforeunload does not dispose lifecycle listeners', async () => {
		const oldSocket = await freshSynced()
		window.dispatchEvent(new Event('beforeunload'))
		expect(oldSocket.readyState).toBe(FakeSocket.OPEN)

		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('disconnected')

		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		expect(currentSocket()).not.toBe(oldSocket)
	})
})
