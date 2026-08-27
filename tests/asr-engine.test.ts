import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'
import { DoubaoEngine, type WebSocketLike } from '../src/asr/doubao/engine'
import { decodeFrame } from '../src/asr/doubao/protocol'
import { createMockVolcServer } from './fixtures/asr/mock-volc-server'

const ASR_FIXTURE_DIR = resolve(
	'tests/fixtures/asr/20260819T052830488Z-query-seedasr-duration-2b7d8bd5',
)
const LIVE_SMOKE_FIXTURE_DIR = resolve('tests/fixtures/asr/2026-08-19T1230Z-live-smoke')

function readAsrFixture(name: string, root = ASR_FIXTURE_DIR): Uint8Array {
	const hex = readFileSync(resolve(root, name), 'utf8').replace(/\s+/g, '')
	const bytes = new Uint8Array(hex.length / 2)
	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

class FakeCapture {
	private callback: ((samples: Int16Array) => void) | undefined
	started = false
	stopped = false

	async start(callback: (samples: Int16Array) => void): Promise<void> {
		this.callback = callback
		this.started = true
	}

	async stop(): Promise<void> {
		this.stopped = true
	}

	getPcmInFlightBytes(): number {
		return 0
	}

	push(samples: Int16Array): void {
		this.callback?.(samples)
	}
}

function websocketFactory(url: string): WebSocketLike {
	return new WebSocketAdapter(new WebSocket(url))
}

class WebSocketAdapter implements WebSocketLike {
	private readonly socket: WebSocket

	constructor(socket: WebSocket) {
		this.socket = socket
	}

	get readyState(): number {
		return this.socket.readyState
	}

	get bufferedAmount(): number {
		return this.socket.bufferedAmount
	}

	set onopen(handler: (() => void) | null) {
		this.socket.onopen = handler === null ? null : () => handler()
	}

	set onerror(handler: ((event: { readonly message?: string }) => void) | null) {
		this.socket.onerror = handler === null ? null : (event) => handler({ message: event.message })
	}

	set onclose(handler:
		| ((event: { readonly code: number; readonly reason: string }) => void)
		| null) {
		this.socket.onclose =
			handler === null ? null : (event) => handler({ code: event.code, reason: event.reason })
	}

	set onmessage(handler: ((event: { readonly data: unknown }) => void) | null) {
		this.socket.onmessage = handler === null ? null : (event) => handler({ data: event.data })
	}

	send(data: Uint8Array): void {
		this.socket.send(data)
	}

	close(): void {
		this.socket.close()
	}
}

class SlowSocket implements WebSocketLike {
	readonly url: string
	readonly readyState = 1
	readonly bufferedAmount = 64_001
	onopen: (() => void) | null = null
	onerror: ((event: { readonly message?: string }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null

	constructor(url: string) {
		this.url = url
		queueMicrotask(() => this.onopen?.())
	}

	send(_data: Uint8Array): void {}

	close(): void {}
}

class BrowserWebSocketProbe {
	static readonly instances: BrowserWebSocketProbe[] = []
	readonly url: string
	readonly readyState = 1
	readonly bufferedAmount = 0
	binaryType: BinaryType = 'blob'
	onopen: (() => void) | null = null
	onerror: ((event: { readonly type: string }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null

	constructor(url: string) {
		this.url = url
		BrowserWebSocketProbe.instances.push(this)
		queueMicrotask(() => this.onopen?.())
	}

	send(_data: Uint8Array): void {}

	close(): void {}

	triggerClose(): void {
		this.onclose?.({ code: 1000, reason: '' })
	}
}

class RuntimeErrorSocket extends SlowSocket {
	triggerError(): void {
		this.onerror?.({ message: 'runtime failure' })
	}
}

class EpochSocket implements WebSocketLike {
	readyState = 1
	readonly bufferedAmount = 0
	onopen: (() => void) | null = null
	onerror: ((event: { readonly message?: string }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null

	constructor(autoOpen = true) {
		if (autoOpen) queueMicrotask(() => this.onopen?.())
	}

	send(_data: Uint8Array): void {}

	close(): void {
		this.readyState = 3
	}

	triggerError(): void {
		this.onerror?.({ message: 'stale runtime failure' })
	}

	triggerMessage(data: unknown): void {
		this.onmessage?.({ data })
	}

	triggerClose(): void {
		this.onclose?.({ code: 1006, reason: 'closed' })
	}
}

class BlockingCapture extends FakeCapture {
	stopCalls = 0
	private releaseFirstStop: (() => void) | undefined

	override async stop(): Promise<void> {
		this.stopCalls++
		if (this.stopCalls === 1) {
			await new Promise<void>((resolve) => {
				this.releaseFirstStop = resolve
			})
		}
		this.stopped = true
	}

	releaseStop(): void {
		this.releaseFirstStop?.()
	}
}

class PortBacklogCapture extends FakeCapture {
	getPcmInFlightBytes(): number {
		return 64_001
	}
}

class FailingCapture {
	readonly error: unknown

	constructor(error: unknown) {
		this.error = error
	}

	async start(_callback: (samples: Int16Array) => void): Promise<void> {
		throw this.error
	}

	async stop(): Promise<void> {}

	getPcmInFlightBytes(): number {
		return 0
	}
}

class PendingCapture extends FakeCapture {
	startCalls = 0
	stopCalls = 0
	private releaseStart: (() => void) | undefined
	private pendingCallback: ((samples: Int16Array) => void) | undefined

	override async start(callback: (samples: Int16Array) => void): Promise<void> {
		this.startCalls++
		this.pendingCallback = callback
		await new Promise<void>((resolve) => {
			this.releaseStart = resolve
		})
		this.started = true
	}

	override async stop(): Promise<void> {
		this.stopCalls++
		this.stopped = true
	}

	release(): void {
		this.releaseStart?.()
	}

	pushPending(samples: Int16Array): void {
		this.pendingCallback?.(samples)
	}
}

class RejectingStopCapture extends FakeCapture {
	stopCalls = 0

	override async stop(): Promise<void> {
		this.stopCalls++
		throw new Error('capture stop failed')
	}
}

class FakeTrack {
	stopCalls = 0
	readyState: MediaStreamTrackState = 'live'
	onended: (() => void) | null = null
	onmute: (() => void) | null = null
	onunmute: (() => void) | null = null

	stop(): void {
		this.stopCalls++
		this.readyState = 'ended'
	}

	triggerEnded(): void {
		this.readyState = 'ended'
		this.onended?.()
	}

	triggerMute(): void {
		this.onmute?.()
	}

	triggerUnmute(): void {
		this.onunmute?.()
	}
}

class FakeStream {
	readonly track = new FakeTrack()

	getTracks(): FakeTrack[] {
		return [this.track]
	}
}

class FakePort {
	onmessage: ((event: { readonly data: { readonly type: string } }) => void) | null = null
	readonly messages: unknown[] = []
	closeCalls = 0
	private readonly ackFlush: boolean

	constructor(ackFlush = true) {
		this.ackFlush = ackFlush
	}

	postMessage(message: unknown): void {
		this.messages.push(message)
		if (typeof message === 'object' && message !== null && 'type' in message) {
			if (message.type === 'flush' && this.ackFlush) {
				queueMicrotask(() => this.onmessage?.({ data: { type: 'flush-ack' } }))
			}
		}
	}

	close(): void {
		this.closeCalls++
	}

	triggerMessage(data: {
		readonly type: string
		readonly samples?: Int16Array
		readonly posted?: number
	}): void {
		this.onmessage?.({ data })
	}
}

class FakeSource {
	disconnectCalls = 0

	connect(_node: unknown): void {}

	disconnect(): void {
		this.disconnectCalls++
	}
}

class FakeAudioNode {
	static readonly instances: FakeAudioNode[] = []
	static ackFlush = true
	readonly port: FakePort
	disconnectCalls = 0
	onprocessorerror: (() => void) | null = null

	constructor(_context: unknown, _name: string) {
		this.port = new FakePort(FakeAudioNode.ackFlush)
		FakeAudioNode.instances.push(this)
	}

	connect(_destination: unknown): void {}

	triggerProcessorError(): void {
		this.onprocessorerror?.()
	}

	disconnect(): void {
		this.disconnectCalls++
	}
}

class FakeAudioContext {
	static readonly instances: FakeAudioContext[] = []
	static initialState: AudioContextState = 'running'
	readonly sampleRate = 16_000
	state: AudioContextState = FakeAudioContext.initialState
	readonly destination = {}
	readonly audioWorklet = { addModule: async (_url: string) => {} }
	readonly sources: FakeSource[] = []
	closeCalls = 0
	suspendCalls = 0
	onstatechange: (() => void) | null = null

	constructor(_options: { readonly sampleRate: number }) {
		FakeAudioContext.instances.push(this)
	}

	resume(): Promise<void> {
		this.state = 'running'
		return Promise.resolve()
	}

	suspend(): Promise<void> {
		this.suspendCalls++
		this.state = 'suspended'
		this.onstatechange?.()
		return Promise.resolve()
	}

	triggerState(state: AudioContextState): void {
		this.state = state
		this.onstatechange?.()
	}

	createMediaStreamSource(_stream: FakeStream): FakeSource {
		const source = new FakeSource()
		this.sources.push(source)
		return source
	}

	async close(): Promise<void> {
		this.closeCalls++
		this.state = 'closed'
		this.onstatechange?.()
	}
}

class FinalSocket extends EpochSocket {
	override send(data: Uint8Array): void {
		const frame = decodeFrame(data)
		if (frame.kind === 'audio' && frame.flags === 3) {
			queueMicrotask(() => this.triggerMessage(serverResponse({ result: { text: 'done' } }, true)))
		}
	}
}

class CountingFinalSocket extends FinalSocket {
	readonly sentFrames: Uint8Array[] = []

	override send(data: Uint8Array): void {
		this.sentFrames.push(data)
		super.send(data)
	}
}

function namedError(name: string): Error {
	const error = new Error(name)
	error.name = name
	return error
}

function serverResponse(json: unknown, final = false): ArrayBuffer {
	const payload = new TextEncoder().encode(JSON.stringify(json))
	const payloadOffset = final ? 12 : 8
	const bytes = new Uint8Array(payloadOffset + payload.byteLength)
	bytes.set([0x11, final ? 0x93 : 0x90, 0x10, 0])
	const view = new DataView(bytes.buffer)
	if (final) view.setInt32(4, 1)
	view.setUint32(final ? 8 : 4, payload.byteLength)
	bytes.set(payload, payloadOffset)
	return bytes.buffer
}

function rawServerResponse(payload: string, final = false): ArrayBuffer {
	const encoded = new TextEncoder().encode(payload)
	const payloadOffset = final ? 12 : 8
	const bytes = new Uint8Array(payloadOffset + encoded.byteLength)
	bytes.set([0x11, final ? 0x93 : 0x90, 0x10, 0])
	const view = new DataView(bytes.buffer)
	if (final) view.setInt32(4, 1)
	view.setUint32(final ? 8 : 4, encoded.byteLength)
	bytes.set(encoded, payloadOffset)
	return bytes.buffer
}

function providerErrorFrame(): ArrayBuffer {
	const payload = new TextEncoder().encode('{"error":"provider"}')
	const bytes = new Uint8Array(12 + payload.byteLength)
	bytes.set([0x11, 0xf0, 0x10, 0])
	const view = new DataView(bytes.buffer)
	view.setUint32(4, 45000151)
	view.setUint32(8, payload.byteLength)
	bytes.set(payload, 12)
	return bytes.buffer
}

describe('DoubaoEngine', () => {
	test('sets browser websocket binaryType to arraybuffer', async () => {
		vi.stubGlobal('WebSocket', BrowserWebSocketProbe)
		BrowserWebSocketProbe.instances.length = 0
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			capture,
		})

		try {
			await engine.start()
			const socket = BrowserWebSocketProbe.instances[0]
			expect(socket?.binaryType).toBe('arraybuffer')
			socket?.triggerClose()
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('requires websocket support even when capture is injected', () => {
		vi.stubGlobal('WebSocket', undefined)
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				capture: new FakeCapture(),
			})
			expect(engine.isSupported()).toBe(false)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('streams injected PCM through real server response fixtures', async () => {
		const server = await createMockVolcServer({ partialEvery: 1 })
		const partialFixture = readAsrFixture('012-recv-server-partial.hex')
		const finalFixture = readAsrFixture('013-recv-server-final.hex')
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const partials: string[] = []
		const finals: string[] = []
		const errors: string[] = []
		engine.onPartial((text) => partials.push(text))
		engine.onFinal((text) => finals.push(text))
		engine.onError((error) => errors.push(error))

		await engine.start()
		capture.push(new Int16Array(1600))
		await new Promise((resolve) => setTimeout(resolve, 20))
		await engine.stop()

		expect(capture.started).toBe(true)
		expect(capture.stopped).toBe(true)
		expect(partials).toEqual([])
		expect(finals).toEqual([])
		expect(errors).toEqual([])
		expect(server.received.map((frame) => (frame[1] ?? 0) >> 4)).toEqual([1, 2, 2])
		expect(server.sent).toEqual([partialFixture, partialFixture, finalFixture])
		const endFrame = server.received[2]
		if (!endFrame) throw new Error('mock did not receive the end frame')
		const decodedEnd = decodeFrame(endFrame)
		expect(decodedEnd).toMatchObject({ kind: 'audio', flags: 3, sequence: -3 })
		await server.close()
	})

	test('maps a provider error frame to provider-error', async () => {
		const server = await createMockVolcServer({ errorCode: 45000151 })
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await engine.start()
		capture.push(new Int16Array(1600))
		await new Promise((resolve) => setTimeout(resolve, 10))
		await engine.stop()
		expect(errors).toContain('provider-error')
		await server.close()
	})

	test('rejects an unauthorised query before websocket open', async () => {
		const server = await createMockVolcServer()
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'wrong',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await expect(engine.start()).rejects.toThrow()
		expect(errors).toContain('connection-failed')
		await server.close()
	})

	test('reports network-too-slow above the two-second in-flight high water mark', async () => {
		const capture = new FakeCapture()
		const socket = new SlowSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await engine.start()
		await new Promise((resolve) => setTimeout(resolve, 120))
		expect(errors).toContain('network-too-slow')
		expect(capture.stopped).toBe(true)
	})

	test('reports network-too-slow when the worklet port has queued PCM', async () => {
		const capture = new PortBacklogCapture()
		const socket = new EpochSocket()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		await new Promise((resolve) => setTimeout(resolve, 120))

		expect(errors).toContain('network-too-slow')
		expect(capture.stopped).toBe(true)
	})

	test('keeps the runtime websocket error handler after opening', async () => {
		const capture = new FakeCapture()
		const socket = new RuntimeErrorSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))

		await engine.start()
		socket.triggerError()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(errors).toEqual(['connection-failed'])
		expect(capture.stopped).toBe(true)
	})

	test('serializes interleaved stop and provider failure across capture epochs', async () => {
		const capture = new BlockingCapture()
		const sockets: EpochSocket[] = []
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => {
				const socket = new EpochSocket()
				sockets.push(socket)
				return socket
			},
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		const firstSocket = sockets[0]
		const firstStop = engine.stop()
		await Promise.resolve()
		expect(capture.stopCalls).toBe(1)

		firstSocket?.triggerMessage(providerErrorFrame())
		expect(errors).toEqual(['provider-error'])
		expect(capture.stopCalls).toBe(1)
		capture.releaseStop()
		await firstStop

		await engine.start()
		const secondSocket = sockets[1]
		firstSocket?.triggerError()
		expect(errors).toEqual(['provider-error'])

		const secondStop = engine.stop()
		await Promise.resolve()
		secondSocket?.triggerMessage(serverResponse({ result: { text: 'done' } }, true))
		await secondStop
	})

	test.each([
		[new DOMException('unsupported', 'NotSupportedError'), 'audio-context'],
		[namedError('NotSupportedError'), 'audio-context'],
		[namedError('UnsupportedSampleRateError'), 'unsupported-sample-rate'],
		[namedError('WorkletLoadError'), 'worklet-load-failed'],
	] as const)('maps capture failure %s to %s', async (error, expected) => {
		const socket = new SlowSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture: new FailingCapture(error),
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await expect(engine.start()).rejects.toBe(error)
		expect(errors).toEqual([expected])
	})

	test('extracts only the known provider result structure', async () => {
		const socket = new SlowSocket('')
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const partials: string[] = []
		const finals: string[] = []
		engine.onPartial((text) => partials.push(text))
		engine.onFinal((text) => finals.push(text))

		await engine.start()
		socket.onmessage?.({
			data: serverResponse({
				result: {
					utterances: [{ text: 'hello' }, { nested: { text: 'must not recurse' } }],
				},
				deep: { result: { text: 'must not recurse' } },
			}),
		})
		const stopping = engine.stop()
		await new Promise((resolve) => setTimeout(resolve, 0))
		socket.onmessage?.({ data: serverResponse({ result: { text: 'done' } }, true) })
		await stopping

		expect(partials).toEqual(['hello'])
		expect(finals).toEqual(['done'])
	})

	test('forwards final sequence while keeping no-sequence responses compatible', async () => {
		const socket = new EpochSocket()
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const partials: string[] = []
		const finals: Array<{ readonly text: string; readonly sequence: number | undefined }> = []
		engine.onPartial((text) => partials.push(text))
		engine.onFinal((text, sequence) => finals.push({ text, sequence }))

		await engine.start()
		socket.triggerMessage(serverResponse({ result: { text: 'partial' } }))
		const stop = engine.stop()
		await Promise.resolve()
		socket.triggerMessage(serverResponse({ result: { text: 'final' } }, true))
		await stop

		expect(partials).toEqual(['partial'])
		expect(finals).toEqual([{ text: 'final', sequence: 1 }])
	})

	test('forwards a live sequenced partial response without protocol error', async () => {
		const socket = new EpochSocket()
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const partials: string[] = []
		const errors: string[] = []
		engine.onPartial((text) => partials.push(text))
		engine.onError((error) => errors.push(error))

		await engine.start()
		socket.triggerMessage(readAsrFixture('recv-002-mt9f1.hex', LIVE_SMOKE_FIXTURE_DIR).buffer)
		expect(partials).toEqual(['The.'])
		expect(errors).toEqual([])

		const stop = engine.stop()
		await Promise.resolve()
		socket.triggerMessage(serverResponse({ result: { text: 'done' } }, true))
		await stop
	})

	test('cancels pending capture start and rejects concurrent start without double opening', async () => {
		const capture = new PendingCapture()
		const sockets: EpochSocket[] = []
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => {
				const socket = new EpochSocket()
				sockets.push(socket)
				return socket
			},
			capture,
		})

		const firstStart = engine.start()
		await vi.waitFor(() => expect(capture.startCalls).toBe(1))
		await expect(engine.start()).rejects.toThrow('busy')
		const firstStop = engine.stop()
		expect(engine.stop()).toBe(firstStop)
		capture.release()
		await Promise.all([firstStart, firstStop])

		expect(capture.stopCalls).toBe(1)
		expect(sockets).toHaveLength(1)
		const secondStart = engine.start()
		await vi.waitFor(() => expect(capture.startCalls).toBe(2))
		capture.release()
		await secondStart
		expect(sockets).toHaveLength(2)
		sockets[1]?.triggerClose()
		await engine.stop()
	})

	test('invalidates a pending capture when the provider fails before recording', async () => {
		const capture = new PendingCapture()
		const socket = new EpochSocket()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		const start = engine.start()
		await vi.waitFor(() => expect(capture.startCalls).toBe(1))
		socket.triggerMessage(providerErrorFrame())
		expect(errors).toEqual(['provider-error'])
		capture.release()
		await start
		await engine.stop()
		expect(capture.stopCalls).toBe(1)
	})

	test('fails immediately when an opened websocket closes while capture is pending', async () => {
		const capture = new PendingCapture()
		const socket = new EpochSocket()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		const start = engine.start()
		await vi.waitFor(() => expect(capture.startCalls).toBe(1))
		socket.triggerClose()

		expect(errors).toEqual(['connection-failed'])
		expect(capture.stopCalls).toBe(1)
		capture.release()
		await start
		await engine.stop()
		expect(capture.stopCalls).toBe(1)
	})

	test('reports websocket close during stopping once and preserves its stop promise', async () => {
		const capture = new BlockingCapture()
		const socket = new EpochSocket()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		const stop = engine.stop()
		await Promise.resolve()
		socket.triggerClose()
		expect(errors).toEqual(['socket-closed'])
		expect(engine.stop()).toBe(stop)
		capture.releaseStop()
		await stop
	})

	test('reports malformed JSON during stopping once and settles the shared stop', async () => {
		const capture = new BlockingCapture()
		const socket = new EpochSocket()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		const stop = engine.stop()
		await vi.waitFor(() => expect(capture.stopCalls).toBe(1))
		await expect(engine.start()).rejects.toThrow('busy')
		socket.triggerMessage(rawServerResponse('{'))

		expect(errors).toEqual(['protocol-error'])
		expect(engine.stop()).toBe(stop)
		capture.releaseStop()
		await stop

		expect(capture.stopped).toBe(true)
		expect(socket.readyState).toBe(3)
	})

	test('reports handshake close and reaches idle without starting capture', async () => {
		const socket = new EpochSocket(false)
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		const start = engine.start()
		socket.triggerClose()
		await expect(start).rejects.toThrow()
		await engine.stop()

		expect(errors).toEqual(['connection-failed'])
		expect(capture.started).toBe(false)
	})

	test('cancels a websocket handshake when stop wins before open', async () => {
		const socket = new EpochSocket(false)
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})

		const start = engine.start()
		const stop = engine.stop()
		await stop
		await start
		expect(capture.started).toBe(false)
	})

	test('rejects start while a failure is still cleaning up', async () => {
		const capture = new BlockingCapture()
		const socket = new RuntimeErrorSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		socket.triggerError()
		expect(errors).toEqual(['connection-failed'])
		await expect(engine.start()).rejects.toThrow('busy')
		capture.releaseStop()
		await engine.stop()
	})

	test('turns malformed JSON into one protocol error while ignoring valid empty results', async () => {
		const socket = new EpochSocket()
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		const partials: string[] = []
		engine.onError((code) => errors.push(code))
		engine.onPartial((text) => partials.push(text))

		await engine.start()
		socket.triggerMessage(serverResponse({ result: { status: 'empty' } }))
		expect(errors).toEqual([])
		expect(partials).toEqual([])
		socket.triggerMessage(rawServerResponse('{'))
		expect(errors).toEqual(['protocol-error'])
		await engine.stop()
	})

	test('capture stop rejection reports once, settles, and permits a new start', async () => {
		const capture = new RejectingStopCapture()
		const sockets: EpochSocket[] = []
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => {
				const socket = new EpochSocket()
				sockets.push(socket)
				return socket
			},
			capture,
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await engine.start()
		const stop = engine.stop()
		expect(engine.stop()).toBe(stop)
		await stop
		expect(errors).toEqual(['connection-failed'])
		expect(capture.stopCalls).toBe(1)

		await engine.start()
		expect(sockets).toHaveLength(2)
		const secondStop = engine.stop()
		await secondStop
		expect(errors).toEqual(['connection-failed', 'connection-failed'])
	})

	test('cleans real BrowserPcmCapture resources through the flush-ack port seam', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		const socket = new FinalSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			await engine.start()
			await engine.stop()

			const context = FakeAudioContext.instances[0]
			const node = FakeAudioNode.instances[0]
			const source = context?.sources[0]
			expect(node?.port.messages).toContainEqual({ type: 'flush' })
			expect(node?.port.closeCalls).toBe(1)
			expect(node?.disconnectCalls).toBe(1)
			expect(source?.disconnectCalls).toBe(1)
			expect(stream.track.stopCalls).toBe(1)
			expect(context?.closeCalls).toBe(1)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('fails on an ended audio track and cleans the browser capture', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		const socket = new EpochSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))

			await engine.start()
			stream.track.triggerEnded()

			expect(errors).toEqual(['audio-interrupted'])
			await engine.stop()
			expect(stream.track.stopCalls).toBe(1)
			expect(FakeAudioContext.instances[0]?.closeCalls).toBe(1)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('does not report a transient mute that recovers before the deadline', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		const socket = new FinalSocket()
		vi.useFakeTimers()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))

			await engine.start()
			stream.track.triggerMute()
			stream.track.triggerUnmute()
			await vi.advanceTimersByTimeAsync(5_000)

			expect(errors).toEqual([])
			const stop = engine.stop()
			await Promise.resolve()
			socket.triggerMessage(serverResponse({ result: { text: 'done' } }, true))
			await stop
		} finally {
			vi.useRealTimers()
			vi.unstubAllGlobals()
		}
	})

	test('fails when mute remains for five seconds', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		const socket = new EpochSocket()
		vi.useFakeTimers()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))

			await engine.start()
			stream.track.triggerMute()
			await vi.advanceTimersByTimeAsync(4_999)
			expect(errors).toEqual([])
			await vi.advanceTimersByTimeAsync(1)
			expect(errors).toEqual(['audio-interrupted'])
			await engine.stop()
		} finally {
			vi.useRealTimers()
			vi.unstubAllGlobals()
		}
	})

	test('fails on an interrupted audio context but ignores normal resume and active stop', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		FakeAudioContext.initialState = 'suspended'
		const stream = new FakeStream()
		const socket = new FinalSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))

			await engine.start()
			expect(errors).toEqual([])
			const context = FakeAudioContext.instances[0]
			context?.triggerState('interrupted')
			expect(errors).toEqual(['audio-interrupted'])
			await engine.stop()

			FakeAudioContext.initialState = 'running'
			const secondStream = new FakeStream()
			const secondSocket = new FinalSocket()
			vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => secondStream } })
			const secondEngine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => secondSocket,
			})
			const secondErrors: string[] = []
			secondEngine.onError((code) => secondErrors.push(code))
			await secondEngine.start()
			const secondStop = secondEngine.stop()
			await Promise.resolve()
			secondSocket.triggerMessage(serverResponse({ result: { text: 'done' } }, true))
			await secondStop
			expect(secondErrors).toEqual([])
		} finally {
			FakeAudioContext.initialState = 'running'
			vi.unstubAllGlobals()
		}
	})

	test.each([
		['AudioWorklet processorerror', (node: FakeAudioNode) => node.triggerProcessorError()],
		[
			'AudioWorklet control error',
			(node: FakeAudioNode) => node.port.triggerMessage({ type: 'error' }),
		],
	] as const)('reports %s as an audio-context failure', async (_name, trigger) => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		const socket = new EpochSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))

			await engine.start()
			const node = FakeAudioNode.instances[0]
			if (!node) throw new Error('AudioWorklet node was not created')
			trigger(node)

			expect(errors).toEqual(['audio-context'])
			await engine.stop()
			expect(node.port.closeCalls).toBe(1)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('fails the BrowserPcmCapture stop contract when flush ack never arrives', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		FakeAudioNode.ackFlush = false
		vi.useFakeTimers()
		const stream = new FakeStream()
		const socket = new EpochSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const errors: string[] = []
			engine.onError((code) => errors.push(code))
			await engine.start()
			const stop = engine.stop()
			await vi.advanceTimersByTimeAsync(3_000)
			await stop
			expect(errors).toEqual(['connection-failed'])
		} finally {
			FakeAudioNode.ackFlush = true
			vi.useRealTimers()
			vi.unstubAllGlobals()
		}
	})

	test('stops a late BrowserPcmCapture permission result without creating audio resources', async () => {
		FakeAudioContext.instances.length = 0
		FakeAudioNode.instances.length = 0
		const stream = new FakeStream()
		let release: ((value: FakeStream) => void) | undefined
		let calls = 0
		const permission = new Promise<FakeStream>((resolve) => {
			release = resolve
		})
		const socket = new EpochSocket()
		vi.stubGlobal('AudioContext', FakeAudioContext)
		vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
		vi.stubGlobal('navigator', {
			mediaDevices: {
				getUserMedia: () => {
					calls++
					return permission
				},
			},
		})
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => socket,
			})
			const start = engine.start()
			await vi.waitFor(() => expect(calls).toBe(1))
			const stop = engine.stop()
			await stop
			release?.(stream)
			await start

			expect(stream.track.stopCalls).toBe(1)
			expect(FakeAudioContext.instances).toHaveLength(0)
			expect(FakeAudioNode.instances).toHaveLength(0)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	describe('keep-alive BrowserPcmCapture', () => {
		afterEach(() => {
			FakeAudioNode.ackFlush = true
			FakeAudioContext.initialState = 'running'
			vi.useRealTimers()
			vi.unstubAllGlobals()
		})

		function stubGetUserMedia(getStream: () => FakeStream) {
			FakeAudioContext.instances.length = 0
			FakeAudioNode.instances.length = 0
			const getUserMedia = vi.fn(async () => getStream())
			vi.stubGlobal('AudioContext', FakeAudioContext)
			vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
			vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
			return getUserMedia
		}

		function createKeepAliveEngine(websocketFactory: () => WebSocketLike): DoubaoEngine {
			return new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				keepAlive: true,
				websocketFactory,
			})
		}

		test('reuses a live capture across start-stop-start without ending the track', async () => {
			const stream = new FakeStream()
			const getUserMedia = stubGetUserMedia(() => stream)
			const errors: string[] = []
			const engine = createKeepAliveEngine(() => new CountingFinalSocket())
			engine.onError((code) => errors.push(code))

			await engine.start()
			await engine.stop()

			expect(getUserMedia).toHaveBeenCalledTimes(1)
			expect(stream.track.stopCalls).toBe(0)
			expect(FakeAudioContext.instances[0]?.closeCalls).toBe(0)
			expect(FakeAudioContext.instances[0]?.suspendCalls).toBe(1)
			expect(errors).toEqual([])

			await engine.start()
			expect(getUserMedia).toHaveBeenCalledTimes(1)
			expect(FakeAudioContext.instances).toHaveLength(1)
			await engine.stop()
			expect(stream.track.stopCalls).toBe(0)
			expect(errors).toEqual([])
			await engine.dispose()
		})

		test('does not recapture or emit PCM after an idle gap', async () => {
			const stream = new FakeStream()
			const sockets: CountingFinalSocket[] = []
			const getUserMedia = stubGetUserMedia(() => stream)
			const engine = createKeepAliveEngine(() => {
				const socket = new CountingFinalSocket()
				sockets.push(socket)
				return socket
			})

			await engine.start()
			const node = FakeAudioNode.instances[0]
			const firstSocket = sockets[0]
			if (!firstSocket) throw new Error('keep-alive engine did not open a socket')
			await engine.stop()
			const sentAfterStop = firstSocket.sentFrames.length
			node?.port.triggerMessage({
				type: 'pcm',
				samples: new Int16Array(1600),
				posted: 1,
			})
			expect(firstSocket.sentFrames).toHaveLength(sentAfterStop)

			await engine.start()
			expect(getUserMedia).toHaveBeenCalledTimes(1)
			expect(stream.track.stopCalls).toBe(0)
			await engine.stop()
			await engine.dispose()
		})

		test('rebuilds capture with getUserMedia after the kept track ends', async () => {
			const live = new FakeStream()
			const rebuilt = new FakeStream()
			let current = live
			const getUserMedia = stubGetUserMedia(() => current)
			const engine = createKeepAliveEngine(() => new CountingFinalSocket())

			await engine.start()
			await engine.stop()
			live.track.readyState = 'ended'
			current = rebuilt
			await engine.start()

			expect(getUserMedia).toHaveBeenCalledTimes(2)
			expect(FakeAudioContext.instances).toHaveLength(2)
			expect(rebuilt.track.stopCalls).toBe(0)
			await engine.stop()
			await engine.dispose()
		})

		test('releases the kept track and audio context on dispose', async () => {
			const stream = new FakeStream()
			stubGetUserMedia(() => stream)
			const engine = createKeepAliveEngine(() => new CountingFinalSocket())

			await engine.start()
			await engine.stop()
			const context = FakeAudioContext.instances[0]
			expect(stream.track.stopCalls).toBe(0)
			expect(context?.closeCalls).toBe(0)

			await engine.dispose()
			expect(stream.track.stopCalls).toBe(1)
			expect(context?.closeCalls).toBe(1)
		})

		test('recaptures and stops tracks on every session when keep-alive is off', async () => {
			const streams = [new FakeStream(), new FakeStream()]
			let gumCalls = 0
			FakeAudioContext.instances.length = 0
			FakeAudioNode.instances.length = 0
			vi.stubGlobal('AudioContext', FakeAudioContext)
			vi.stubGlobal('AudioWorkletNode', FakeAudioNode)
			vi.stubGlobal('navigator', {
				mediaDevices: {
					getUserMedia: async () => {
						const stream = streams[gumCalls]
						gumCalls++
						if (!stream) throw new Error('unexpected getUserMedia')
						return stream
					},
				},
			})
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				websocketFactory: () => new CountingFinalSocket(),
			})

			await engine.start()
			await engine.stop()
			expect(streams[0]?.track.stopCalls).toBe(1)
			expect(FakeAudioContext.instances[0]?.closeCalls).toBe(1)

			await engine.start()
			await engine.stop()
			expect(gumCalls).toBe(2)
			expect(streams[1]?.track.stopCalls).toBe(1)
			expect(FakeAudioContext.instances[1]?.closeCalls).toBe(1)
		})
	})
})
