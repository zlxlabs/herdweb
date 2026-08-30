import { PCM_CHUNK_BYTES, PCM_SAMPLE_RATE, int16ToPcmBytes } from '../pcm'
import type {
	AsrEngine,
	AsrErrorCode,
	AsrErrorHandler,
	AsrFinalHandler,
	AsrTextHandler,
	AsrUnsubscribe,
} from '../types'
import { createFullRequest, decodeFrame, encodeAudioFrame, encodeEndFrame } from './protocol'

const DEFAULT_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DEFAULT_WORKLET_URL = 'asr-worklet.js'
const WORKLET_PROCESSOR_NAME = 'herdweb-pcm-processor'
const OPEN = 1
const CLOSING = 2
const CLOSED = 3
const BACKPRESSURE_INTERVAL_MS = 100
const BACKPRESSURE_LIMIT_BYTES = PCM_SAMPLE_RATE * 2 * 2
const FINAL_TIMEOUT_MS = 3_000
const CAPTURE_FLUSH_TIMEOUT_MS = 3_000
/** Keep-alive holds the mic this long after stop(); not a user config. */
const KEEP_ALIVE_IDLE_MS = 60_000

export interface WebSocketLike {
	readonly readyState: number
	readonly bufferedAmount: number
	onopen: (() => void) | null
	onerror: ((event: { readonly message?: string }) => void) | null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
	onmessage: ((event: { readonly data: unknown }) => void) | null
	send(data: Uint8Array): void
	close(): void
}

type WebSocketFactory = (url: string) => WebSocketLike

interface PcmCapture {
	start(onSamples: (samples: Int16Array) => void, onError: AsrErrorHandler): Promise<void>
	stop(): Promise<void>
	getPcmInFlightBytes(): number
}

interface DoubaoEngineOptions {
	readonly apiKey: string
	readonly resourceId: string
	readonly uid?: string
	readonly endpoint?: string
	readonly workletUrl?: string
	readonly websocketFactory?: WebSocketFactory
	readonly capture?: PcmCapture
	/** When true, stop() pauses capture without ending tracks or closing AudioContext. */
	readonly keepAlive?: boolean
}

function unsubscribe<T>(handlers: Set<T>, handler: T): AsrUnsubscribe {
	handlers.add(handler)
	return () => handlers.delete(handler)
}

function errorCode(error: unknown): AsrErrorCode {
	if (error instanceof DOMException && error.name === 'NotAllowedError') {
		return 'permission-denied'
	}
	if (error instanceof Error && error.name === 'NotSupportedError') {
		return 'audio-context'
	}
	if (error instanceof Error && error.name === 'UnsupportedSampleRateError') {
		return 'unsupported-sample-rate'
	}
	if (error instanceof Error && error.name === 'WorkletLoadError') {
		return 'worklet-load-failed'
	}
	if (error instanceof Error && error.name === 'AudioInterruptedError') {
		return 'audio-interrupted'
	}
	return 'connection-failed'
}

function getText(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	if (!('result' in value) || typeof value.result !== 'object' || value.result === null) {
		return undefined
	}
	const result = value.result
	if ('text' in result && typeof result.text === 'string') return result.text
	if (!('utterances' in result) || !Array.isArray(result.utterances)) return undefined
	const texts: string[] = []
	for (const utterance of result.utterances) {
		if (typeof utterance === 'object' && utterance !== null && 'text' in utterance) {
			if (typeof utterance.text === 'string') texts.push(utterance.text)
		}
	}
	return texts.length > 0 ? texts.join('') : undefined
}

class BrowserWebSocketAdapter implements WebSocketLike {
	private readonly socket: WebSocket

	constructor(socket: WebSocket) {
		this.socket = socket
		this.socket.binaryType = 'arraybuffer'
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
		this.socket.onerror = handler === null ? null : (event) => handler({ message: event.type })
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

function browserWebSocketFactory(url: string): WebSocketLike {
	return new BrowserWebSocketAdapter(new WebSocket(url))
}

class BrowserPcmCapture implements PcmCapture {
	private readonly workletUrl: string
	private readonly keepAlive: boolean
	private context: AudioContext | undefined
	private stream: MediaStream | undefined
	private source: MediaStreamAudioSourceNode | undefined
	private node: AudioWorkletNode | undefined
	private onSamples: ((samples: Int16Array) => void) | undefined
	private flushWaiter: { readonly epoch: number; readonly resolve: () => void } | undefined
	private epoch = 0
	private stopPromise: Promise<void> | undefined
	private workletPosted = 0
	private workletReceived = 0
	private readonly muteTimers = new Map<MediaStreamTrack, ReturnType<typeof setTimeout>>()
	private idleTimer: ReturnType<typeof setTimeout> | undefined
	private idleGeneration = 0
	private readonly onPageHide = (): void => {
		void this.release()
	}

	constructor(workletUrl: string, keepAlive = false) {
		this.workletUrl = workletUrl
		this.keepAlive = keepAlive
		if (keepAlive) globalThis.addEventListener('pagehide', this.onPageHide)
	}

	async start(onSamples: (samples: Int16Array) => void, onError: AsrErrorHandler): Promise<void> {
		this.clearIdleTimer()
		this.idleGeneration++
		const previousStop = this.stopPromise
		if (previousStop) {
			await previousStop
			if (this.stopPromise === previousStop) this.stopPromise = undefined
		}
		const epoch = ++this.epoch
		this.workletPosted = 0
		this.workletReceived = 0
		if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.AudioContext) {
			throw new Error('AudioWorklet capture is not supported')
		}
		if (this.keepAlive && this.canReuseHeldCapture(this.stream, this.context)) {
			await this.restartHeldCapture(epoch, onSamples, onError)
			return
		}
		if (this.stream || this.context) await this.releaseHeldResources()
		const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true })
		if (epoch !== this.epoch) {
			await this.disposeStartResources(stream, undefined, undefined, undefined)
			return
		}
		let context: AudioContext | undefined
		let source: MediaStreamAudioSourceNode | undefined
		let node: AudioWorkletNode | undefined
		try {
			context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE })
			if (epoch !== this.epoch) {
				await this.disposeStartResources(stream, context, source, node)
				return
			}
			if (context.sampleRate !== PCM_SAMPLE_RATE) {
				const error = new Error(`AudioContext sample rate is ${context.sampleRate}`)
				error.name = 'UnsupportedSampleRateError'
				throw error
			}
			if (context.state === 'suspended') await context.resume()
			if (epoch !== this.epoch) {
				await this.disposeStartResources(stream, context, source, node)
				return
			}
			try {
				await context.audioWorklet.addModule(this.workletUrl)
			} catch (error) {
				const failure = new Error('AudioWorklet module failed to load', { cause: error })
				failure.name = 'WorkletLoadError'
				throw failure
			}
			if (epoch !== this.epoch) {
				await this.disposeStartResources(stream, context, source, node)
				return
			}
			node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME)
			this.bindWorkletNode(node, epoch, onError)
			source = context.createMediaStreamSource(stream)
			source.connect(node)
			node.connect(context.destination)
			if (epoch !== this.epoch) {
				await this.disposeStartResources(stream, context, source, node)
				return
			}
			this.installCaptureSignals(stream, context, epoch, onError)
			node.port.postMessage({ type: 'start' })
			this.onSamples = onSamples
			this.context = context
			this.stream = stream
			this.source = source
			this.node = node
		} catch (error) {
			this.clearCaptureSignals(stream, context)
			this.teardownGraph(source, node)
			for (const track of stream.getTracks()) track.stop()
			if (context && context.state !== 'closed') await context.close()
			throw error
		}
	}

	private async restartHeldCapture(
		epoch: number,
		onSamples: (samples: Int16Array) => void,
		onError: AsrErrorHandler,
	): Promise<void> {
		const stream = this.stream
		const context = this.context
		if (!stream || !context) return
		let source: MediaStreamAudioSourceNode | undefined
		let node: AudioWorkletNode | undefined
		try {
			const state: string = context.state
			if (state !== 'running') await context.resume()
			if (epoch !== this.epoch) return
			if (context.state !== 'running') {
				const error = new Error('AudioContext did not resume')
				error.name = 'AudioInterruptedError'
				throw error
			}
			try {
				await context.audioWorklet.addModule(this.workletUrl)
			} catch (error) {
				const failure = new Error('AudioWorklet module failed to load', { cause: error })
				failure.name = 'WorkletLoadError'
				throw failure
			}
			if (epoch !== this.epoch) return
			node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME)
			this.bindWorkletNode(node, epoch, onError)
			source = context.createMediaStreamSource(stream)
			source.connect(node)
			node.connect(context.destination)
			if (epoch !== this.epoch) {
				this.teardownGraph(source, node)
				return
			}
			this.installCaptureSignals(stream, context, epoch, onError)
			node.port.postMessage({ type: 'start' })
			this.onSamples = onSamples
			this.source = source
			this.node = node
		} catch (error) {
			this.clearCaptureSignals(stream, context)
			this.teardownGraph(source, node)
			await this.releaseHeldResources()
			throw error
		}
	}

	private bindWorkletNode(node: AudioWorkletNode, epoch: number, onError: AsrErrorHandler): void {
		node.port.onmessage = (
			event: MessageEvent<
				| { type: 'pcm'; samples: Int16Array; posted: number }
				| { type: 'flush-ack' }
				| { type: 'error'; error: string }
			>,
		) => {
			if (event.data.type === 'flush-ack') {
				const waiter = this.flushWaiter
				if (waiter?.epoch === epoch) {
					this.flushWaiter = undefined
					waiter.resolve()
				}
				return
			}
			if (event.data.type === 'error') {
				if (epoch === this.epoch) onError('audio-context')
				return
			}
			if (epoch !== this.epoch) return
			this.workletPosted = Math.max(this.workletPosted, event.data.posted)
			this.workletReceived++
			this.onSamples?.(event.data.samples)
		}
		node.onprocessorerror = () => {
			if (epoch === this.epoch) onError('audio-context')
		}
	}

	private hasPausableCapture(
		stream: MediaStream | undefined,
		context: AudioContext | undefined,
	): boolean {
		if (!stream || !context || context.state === 'closed') return false
		return stream.getTracks().some((track) => track.readyState === 'live')
	}

	private canReuseHeldCapture(
		stream: MediaStream | undefined,
		context: AudioContext | undefined,
	): boolean {
		if (!stream || !context || context.state === 'closed') return false
		const tracks = stream.getTracks()
		return tracks.length > 0 && tracks.every((track) => track.readyState === 'live')
	}

	private teardownGraph(
		source: MediaStreamAudioSourceNode | undefined,
		node: AudioWorkletNode | undefined,
	): void {
		if (node) node.onprocessorerror = null
		source?.disconnect()
		node?.port.close()
		node?.disconnect()
	}

	private async releaseHeldResources(): Promise<void> {
		const stream = this.stream
		const context = this.context
		const source = this.source
		const node = this.node
		this.stream = undefined
		this.context = undefined
		this.source = undefined
		this.node = undefined
		this.onSamples = undefined
		if (stream) await this.disposeStartResources(stream, context, source, node)
		else if (context && context.state !== 'closed') await context.close()
	}

	private async disposeStartResources(
		stream: MediaStream,
		context: AudioContext | undefined,
		source: MediaStreamAudioSourceNode | undefined,
		node: AudioWorkletNode | undefined,
	): Promise<void> {
		this.clearCaptureSignals(stream, context)
		this.teardownGraph(source, node)
		for (const track of stream.getTracks()) track.stop()
		if (context && context.state !== 'closed') await context.close()
	}

	private installCaptureSignals(
		stream: MediaStream,
		context: AudioContext,
		epoch: number,
		onError: AsrErrorHandler,
	): void {
		const reportInterruption = (): void => {
			if (epoch === this.epoch) onError('audio-interrupted')
		}
		for (const track of stream.getTracks()) {
			track.onended = reportInterruption
			track.onmute = () => {
				this.clearMuteTimer(track)
				this.muteTimers.set(track, setTimeout(reportInterruption, 5_000))
			}
			track.onunmute = () => this.clearMuteTimer(track)
			if (track.muted) this.muteTimers.set(track, setTimeout(reportInterruption, 5_000))
		}
		context.onstatechange = () => {
			const state: string = context.state
			if (state === 'interrupted' || state === 'suspended') reportInterruption()
		}
	}

	private clearMuteTimer(track: MediaStreamTrack): void {
		const timer = this.muteTimers.get(track)
		if (timer) clearTimeout(timer)
		this.muteTimers.delete(track)
	}

	private clearCaptureSignals(stream: MediaStream, context: AudioContext | undefined): void {
		for (const track of stream.getTracks()) {
			track.onended = null
			track.onmute = null
			track.onunmute = null
			this.clearMuteTimer(track)
		}
		if (context) context.onstatechange = null
	}

	getPcmInFlightBytes(): number {
		return Math.max(0, this.workletPosted - this.workletReceived) * PCM_CHUNK_BYTES
	}

	async stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise
		const epoch = this.epoch
		this.epoch++
		const source = this.source
		const stream = this.stream
		const node = this.node
		const context = this.context
		const pause = this.keepAlive && this.hasPausableCapture(stream, context)
		this.source = undefined
		this.node = undefined
		this.onSamples = undefined
		if (!pause) {
			this.stream = undefined
			this.context = undefined
		}
		if (stream) this.clearCaptureSignals(stream, context)
		if (node) node.onprocessorerror = null
		source?.disconnect()
		if (!pause) {
			for (const track of stream?.getTracks() ?? []) track.stop()
		}
		const promise = this.stopCurrentEpoch(epoch, node, context, pause)
		this.stopPromise = promise
		void promise.then(
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
				if (pause) this.scheduleIdleRelease()
			},
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
				if (pause) this.scheduleIdleRelease()
			},
		)
		return promise
	}

	/**
	 * Release held capture resources without unhooking pagehide.
	 * The capture can start again; pagehide still fully releases a later session.
	 */
	async releaseCaptureResources(): Promise<void> {
		this.clearIdleTimer()
		const generation = ++this.idleGeneration
		const previousStop = this.stopPromise
		if (previousStop) {
			await previousStop
			if (this.stopPromise === previousStop) this.stopPromise = undefined
		}
		this.clearIdleTimer()
		if (generation !== this.idleGeneration) return
		this.epoch++
		await this.releaseHeldResources()
	}

	async release(): Promise<void> {
		if (this.keepAlive) globalThis.removeEventListener('pagehide', this.onPageHide)
		await this.releaseCaptureResources()
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === undefined) return
		clearTimeout(this.idleTimer)
		this.idleTimer = undefined
	}

	private scheduleIdleRelease(): void {
		if (!this.keepAlive) return
		this.clearIdleTimer()
		const generation = this.idleGeneration
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined
			void this.releaseCaptureResourcesFromIdle(generation)
		}, KEEP_ALIVE_IDLE_MS)
	}

	private async releaseCaptureResourcesFromIdle(generation: number): Promise<void> {
		if (generation !== this.idleGeneration) return
		await this.releaseCaptureResources()
	}

	private async stopCurrentEpoch(
		epoch: number,
		node: AudioWorkletNode | undefined,
		context: AudioContext | undefined,
		pause: boolean,
	): Promise<void> {
		try {
			if (node) {
				await new Promise<void>((resolve, reject) => {
					let timer: ReturnType<typeof setTimeout>
					const settle = (): void => {
						clearTimeout(timer)
						if (this.flushWaiter?.epoch === epoch) this.flushWaiter = undefined
						resolve()
					}
					timer = setTimeout(() => {
						if (this.flushWaiter?.epoch === epoch) this.flushWaiter = undefined
						reject(new Error('AudioWorklet flush acknowledgement timed out'))
					}, CAPTURE_FLUSH_TIMEOUT_MS)
					this.flushWaiter = { epoch, resolve: settle }
					try {
						node.port.postMessage({ type: 'flush' })
					} catch (error) {
						clearTimeout(timer)
						this.flushWaiter = undefined
						reject(error)
					}
				})
			}
		} finally {
			if (this.flushWaiter?.epoch === epoch) this.flushWaiter = undefined
			node?.port.close()
			node?.disconnect()
			if (context && pause && context.state !== 'closed' && context.state !== 'suspended') {
				await context.suspend()
			} else if (context && !pause && context.state !== 'closed') {
				await context.close()
			}
		}
	}
}

/**
 * Engine lifecycle migration table (the implementation below is the sole state writer):
 *
 * idle + start -> starting: increment epoch, wait prior capture cleanup, open WS/capture.
 * starting + WS error/close -> failing: report connection-failed once, cancel handshake,
 *   stop capture, then idle; capture has not started yet.
 * starting + capture pending + stop -> stopping: invalidate epoch, stop capture, cleanup -> idle.
 * starting + capture pending + late resource -> discarded: stop tracks/close context/node,
 *   and never publish the stale resource.
 * starting + provider/protocol failure -> failing: report once, invalidate epoch, cleanup -> idle.
 * recording + stop -> stopping: stop monitor/capture, flush queued PCM, send tail, await final/3s,
 *   cleanup -> idle. keep-alive capture pauses (no track.stop / context.close) and the next
 *   start reuses a live stream within KEEP_ALIVE_IDLE_MS; idle timeout, releaseCapture(),
 *   dispose()/pagehide, and ended tracks fully release. Idle/hidden release does not unhook
 *   pagehide; dispose() does.
 * recording + WS/provider/protocol/backpressure failure -> failing: report once, stop/close, idle.
 * stopping + provider/WS/protocol/stop failure -> stopping: report once, resolve final waiter,
 *   keep the shared stop promise, then cleanup -> idle.
 * stopping + stop -> same promise; stopping/failing + start -> reject (no second session).
 * any + second start while capture pending -> reject; malformed JSON -> protocol-error;
 * legal JSON without text -> ignore. Epoch-mismatched callbacks cannot touch current state.
 */
type EngineState = 'idle' | 'starting' | 'recording' | 'stopping' | 'failing'

/** Browser-direct Doubao SAUC engine. The optional capture/websocket seams are test-only injection points. */
export class DoubaoEngine implements AsrEngine {
	private readonly options: DoubaoEngineOptions
	private readonly partialHandlers = new Set<AsrTextHandler>()
	private readonly finalHandlers = new Set<AsrFinalHandler>()
	private readonly errorHandlers = new Set<AsrErrorHandler>()
	private readonly websocketFactory: WebSocketFactory
	private readonly capture: PcmCapture
	private readonly ownedCapture: BrowserPcmCapture | undefined
	private socket: WebSocketLike | undefined
	private state: EngineState = 'idle'
	private epoch = 0
	private captureStopPromise: Promise<void> | undefined
	private stopPromise: Promise<void> | undefined
	private audioFrameCount = 0
	private queuedAudio: Uint8Array[] = []
	private queuedBytes = 0
	private backpressureTimer: ReturnType<typeof setInterval> | undefined
	private finalTimer: ReturnType<typeof setTimeout> | undefined
	private finalWaiter: (() => void) | undefined
	private finalReceived = false
	private failedDuringStop = false
	private reportedError = false
	private handshakeReject: ((reason: Error) => void) | undefined

	constructor(options: DoubaoEngineOptions) {
		this.options = options
		this.websocketFactory = options.websocketFactory ?? browserWebSocketFactory
		if (options.capture) {
			this.capture = options.capture
			this.ownedCapture = undefined
		} else {
			const owned = new BrowserPcmCapture(
				options.workletUrl ?? DEFAULT_WORKLET_URL,
				options.keepAlive === true,
			)
			this.ownedCapture = owned
			this.capture = owned
		}
	}

	/**
	 * Release keep-alive held capture without disposing the engine.
	 * pagehide stays registered so a later start() can still fully tear down.
	 */
	async releaseCapture(): Promise<void> {
		await this.ownedCapture?.releaseCaptureResources()
	}

	/** Release keep-alive capture resources. Idle stop() is a no-op; this always tears down. */
	async dispose(): Promise<void> {
		await this.stop()
		await this.ownedCapture?.release()
	}

	isSupported(): boolean {
		const captureSupported =
			this.options.capture !== undefined ||
			(Boolean(globalThis.AudioContext) &&
				Boolean(globalThis.AudioWorkletNode) &&
				Boolean(globalThis.navigator?.mediaDevices?.getUserMedia))
		const websocketSupported =
			this.options.websocketFactory !== undefined || Boolean(globalThis.WebSocket)
		return captureSupported && websocketSupported
	}

	onPartial(handler: AsrTextHandler): AsrUnsubscribe {
		return unsubscribe(this.partialHandlers, handler)
	}

	onFinal(handler: AsrFinalHandler): AsrUnsubscribe {
		return unsubscribe(this.finalHandlers, handler)
	}

	onError(handler: AsrErrorHandler): AsrUnsubscribe {
		return unsubscribe(this.errorHandlers, handler)
	}

	async start(): Promise<void> {
		if (this.state !== 'idle') throw new Error('ASR engine is busy')
		const epoch = ++this.epoch
		this.transition(['idle'], 'starting', 'start')
		this.reportedError = false
		this.failedDuringStop = false
		this.finalReceived = false
		this.audioFrameCount = 0
		this.queuedAudio = []
		this.queuedBytes = 0
		const previousStop = this.captureStopPromise
		if (previousStop) {
			await previousStop
			if (!this.isCurrent(epoch, 'starting')) return
		}
		if (!this.isCurrent(epoch, 'starting')) return
		if (!this.isSupported()) {
			this.fail('unsupported', epoch)
			throw new Error('ASR is not supported in this browser')
		}
		try {
			await this.openSocket(epoch)
			if (!this.isCurrent(epoch, 'starting')) return
			await this.capture.start(
				(samples) => {
					if (epoch === this.epoch) this.sendPcm(samples)
				},
				(code) => {
					if (epoch === this.epoch) this.fail(code, epoch)
				},
			)
			if (!this.isCurrent(epoch, 'starting')) return
			this.transition(['starting'], 'recording', 'capture-ready')
			this.startBackpressureMonitor(epoch)
		} catch (error) {
			if (epoch !== this.epoch && !this.reportedError) return
			this.fail(errorCode(error), epoch)
			throw error
		}
	}

	stop(): Promise<void> {
		if (this.state === 'idle') return Promise.resolve()
		if (this.state === 'stopping' || this.state === 'failing') {
			return this.stopPromise ?? Promise.resolve()
		}
		const epoch = this.epoch
		const recording = this.state === 'recording'
		this.transition([this.state], 'stopping', recording ? 'stop' : 'cancel-start')
		this.stopBackpressureMonitor()
		this.finalReceived = false
		if (!recording) this.epoch++
		return this.trackStopPromise(this.finishStop(epoch, recording))
	}

	/** Test seam for a captured worklet chunk; browser capture calls the same path. */
	ingestPcm(samples: Int16Array): void {
		this.sendPcm(samples)
	}

	private async openSocket(epoch: number): Promise<void> {
		const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT
		const params = new URLSearchParams({
			api_key: this.options.apiKey,
			api_resource_id: this.options.resourceId,
		})
		const socket = this.websocketFactory(`${endpoint}?${params.toString()}`)
		this.socket = socket
		let opened = false
		let rejectHandshake: ((reason: Error) => void) | undefined
		socket.onmessage = (event) => {
			if (epoch === this.epoch) this.handleMessage(event.data, epoch)
		}
		const runtimeError = (_event: { readonly message?: string }): void => {
			if (epoch !== this.epoch) return
			if (this.state === 'starting' || this.state === 'recording' || this.state === 'stopping') {
				this.fail('connection-failed', epoch)
			}
		}
		socket.onclose = () => {
			if (epoch !== this.epoch) {
				if (!opened) rejectHandshake?.(new Error('ASR websocket handshake cancelled'))
				return
			}
			if (!opened) {
				this.fail('connection-failed', epoch)
				rejectHandshake?.(new Error('ASR websocket closed during handshake'))
				return
			}
			if (this.state === 'starting') {
				this.fail('connection-failed', epoch)
			} else if (this.state === 'recording') {
				this.fail('socket-closed', epoch)
			} else if (this.state === 'stopping' && !this.finalReceived) {
				this.fail('socket-closed', epoch)
			} else {
				this.resolveFinalWaiter()
			}
		}
		socket.onerror = runtimeError
		await new Promise<void>((resolve, reject) => {
			rejectHandshake = reject
			this.handshakeReject = reject
			socket.onopen = () => {
				if (epoch !== this.epoch) {
					resolve()
					return
				}
				if (socket.readyState !== OPEN) {
					reject(new Error('ASR websocket did not open'))
					return
				}
				opened = true
				socket.send(createFullRequest({ uid: this.options.uid }))
				resolve()
			}
			socket.onerror = (event) => {
				runtimeError(event)
				reject(new Error('ASR websocket connection failed'))
			}
		}).finally(() => {
			rejectHandshake = undefined
			this.handshakeReject = undefined
		})
		socket.onerror = runtimeError
	}

	private handleMessage(data: unknown, epoch: number): void {
		if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
			this.fail('protocol-error', epoch)
			return
		}
		const bytes =
			data instanceof ArrayBuffer
				? data
				: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		try {
			const frame = decodeFrame(bytes)
			if (frame.kind === 'error') {
				this.fail('provider-error', epoch)
				return
			}
			if (frame.kind !== 'server-response') {
				this.fail('protocol-error', epoch)
				return
			}
			if (frame.flags === 3 && this.state === 'stopping') {
				this.finalReceived = true
				this.resolveFinalWaiter()
			}
			const text = getText(frame.json)
			if (text === undefined) return
			if (frame.flags === 3) {
				for (const handler of this.finalHandlers) handler(text, frame.sequence)
			} else {
				for (const handler of this.partialHandlers) handler(text)
			}
		} catch {
			this.fail('protocol-error', epoch)
		}
	}

	private sendPcm(samples: Int16Array): void {
		if (this.state !== 'recording' && this.state !== 'stopping') return
		const bytes = encodeAudioFrame(int16ToPcmBytes(samples))
		this.audioFrameCount++
		if (!this.socket || this.socket.readyState !== OPEN) {
			this.queuedAudio.push(bytes)
			this.queuedBytes += bytes.byteLength
			return
		}
		this.socket.send(bytes)
	}

	private flushQueue(): void {
		if (!this.socket || this.socket.readyState !== OPEN) return
		for (const frame of this.queuedAudio) this.socket.send(frame)
		this.queuedAudio = []
		this.queuedBytes = 0
	}

	private startBackpressureMonitor(epoch: number): void {
		this.backpressureTimer = setInterval(() => {
			if (epoch !== this.epoch) return
			const socketBytes = this.socket?.bufferedAmount ?? 0
			const workletBytes = this.capture.getPcmInFlightBytes()
			if (this.queuedBytes + workletBytes + socketBytes > BACKPRESSURE_LIMIT_BYTES) {
				this.fail('network-too-slow', epoch)
			}
			if (this.socket?.readyState === CLOSING || this.socket?.readyState === CLOSED) {
				this.fail('socket-closed', epoch)
			}
		}, BACKPRESSURE_INTERVAL_MS)
	}

	private stopBackpressureMonitor(): void {
		if (this.backpressureTimer) clearInterval(this.backpressureTimer)
		this.backpressureTimer = undefined
	}

	private waitForFinal(): Promise<void> {
		return new Promise((resolve) => {
			this.finalWaiter = resolve
			this.finalTimer = setTimeout(() => this.resolveFinalWaiter(), FINAL_TIMEOUT_MS)
		})
	}

	private resolveFinalWaiter(): void {
		const waiter = this.finalWaiter
		this.finalWaiter = undefined
		if (this.finalTimer) clearTimeout(this.finalTimer)
		this.finalTimer = undefined
		waiter?.()
	}

	private requestCaptureStop(): Promise<void> {
		if (this.captureStopPromise) return this.captureStopPromise
		const promise = this.capture.stop()
		this.captureStopPromise = promise
		void promise.then(
			() => {
				if (this.captureStopPromise === promise) this.captureStopPromise = undefined
			},
			() => {
				if (this.captureStopPromise === promise) this.captureStopPromise = undefined
			},
		)
		return promise
	}

	private finishStop(epoch: number, recording: boolean): Promise<void> {
		return (async () => {
			try {
				await this.requestCaptureStop()
				if (this.failedDuringStop) return
				if (!recording) {
					this.cleanupSession()
					return
				}
				this.flushQueue()
				if (!this.socket || this.socket.readyState !== OPEN) {
					this.reportStopError('socket-closed', epoch)
					return
				}
				this.socket.send(encodeEndFrame(-(this.audioFrameCount + 2)))
				await this.waitForFinal()
			} catch (error) {
				this.reportStopError(errorCode(error), epoch)
			} finally {
				if (this.state === 'stopping') this.cleanupSession()
			}
		})()
	}

	private finishFailure(): Promise<void> {
		return (async () => {
			try {
				await this.requestCaptureStop()
			} catch {
				// The initiating failure already produced the single error callback.
			} finally {
				if (this.state === 'failing') this.cleanupSession()
			}
		})()
	}

	private trackStopPromise(promise: Promise<void>): Promise<void> {
		this.stopPromise = promise
		void promise.then(
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
			},
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
			},
		)
		return promise
	}

	private fail(code: AsrErrorCode, epoch: number): void {
		if (epoch !== this.epoch || this.state === 'idle') return
		if (this.state === 'stopping') {
			this.reportStopError(code, epoch)
			return
		}
		if (this.state !== 'starting' && this.state !== 'recording') return
		this.transition([this.state], 'failing', `fail:${code}`)
		this.epoch++
		this.stopBackpressureMonitor()
		this.resolveFinalWaiter()
		this.trackStopPromise(this.finishFailure())
		this.reportError(code)
		this.detachAndCloseSocket()
	}

	private reportStopError(code: AsrErrorCode, epoch: number): void {
		if (this.failedDuringStop || (epoch !== this.epoch && this.state !== 'stopping')) return
		this.failedDuringStop = true
		this.epoch++
		this.stopBackpressureMonitor()
		this.resolveFinalWaiter()
		this.reportError(code)
		this.detachAndCloseSocket()
	}

	private reportError(code: AsrErrorCode): void {
		if (this.reportedError) return
		this.reportedError = true
		for (const handler of this.errorHandlers) handler(code)
	}

	private detachAndCloseSocket(): void {
		const handshakeReject = this.handshakeReject
		this.handshakeReject = undefined
		handshakeReject?.(new Error('ASR websocket lifecycle cancelled'))
		const socket = this.socket
		this.socket = undefined
		if (!socket) return
		socket.onopen = null
		socket.onmessage = null
		socket.onerror = null
		socket.onclose = null
		socket.close()
	}

	private cleanupSession(): void {
		this.stopBackpressureMonitor()
		this.resolveFinalWaiter()
		this.detachAndCloseSocket()
		this.queuedAudio = []
		this.queuedBytes = 0
		this.finalReceived = false
		this.failedDuringStop = false
		this.epoch++
		this.transition(['stopping', 'failing'], 'idle', 'cleanup')
	}

	private isCurrent(epoch: number, state: EngineState): boolean {
		return epoch === this.epoch && this.state === state
	}

	private transition(from: readonly EngineState[], to: EngineState, event: string): void {
		if (!from.includes(this.state)) {
			throw new Error(`Invalid ASR lifecycle transition ${this.state} -> ${to} (${event})`)
		}
		this.state = to
	}
}
