import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import '../styles/base.css'
import { joinBasePath } from './base-path'
import { createImageDropController } from './controls/image-drop-controller'
import { createHookRegistry, init } from './index'
import { parseServerMessage, serialiseClientMessage } from './session-protocol'
import type { ClientMessage } from './session-protocol'
import type {
	ConnectionFailureReason,
	ConnectionState,
	ConnectionStatus,
	HerdwebConfig,
	InputActionResult,
	XTerminal,
} from './types'
import { el } from './util/dom'
import { onTap } from './util/tap'

declare const __herdwebConfig: HerdwebConfig
declare const __herdwebVersion: string | undefined
declare const __herdwebBasePath: string | undefined

function createSocketUrl(): string {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const socketPath = joinBasePath(__herdwebBasePath ?? '/', '/ws')
	return `${protocol}//${window.location.host}${socketPath}`
}

function attachOptionalAddons(term: Terminal): FitAddon {
	const fitAddon = new FitAddon()
	term.loadAddon(fitAddon)
	term.loadAddon(new WebLinksAddon())

	const unicodeAddon = new Unicode11Addon()
	term.loadAddon(unicodeAddon)
	term.unicode.activeVersion = '11'

	return fitAddon
}

const SNAPSHOT_DEADLINE_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_DEADLINE_MS = 15_000
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
const PRE_SYNC_FAILURES_BEFORE_AUTH_HINT = 3
const MAX_PRE_SNAPSHOT_OUTPUT_BYTES = 1024 * 1024
const BUFFERED_AMOUNT_SETTLE_MS = 100
// Heartbeats refresh this proof every 10s; 25s leaves margin while remaining ahead of the 15s deadline.
const FRESHNESS_WINDOW_MS = 25_000
const utf8Encoder = new TextEncoder()

function createTermBridge(
	term: Terminal,
	send: (message: ClientMessage) => void,
	isConnected: () => boolean,
	onConnectionChange: (handler: (connected: boolean) => void) => { dispose(): void },
	getConnectionStatus: () => ConnectionStatus,
	onConnectionStatusChange: (handler: (status: ConnectionStatus) => void) => { dispose(): void },
	requestReconnect: () => void,
	getSessionId: () => string | null,
	sendInputAction: (id: string, data: string) => boolean,
	onInputActionResult: (handler: (result: InputActionResult) => void) => { dispose(): void },
): XTerminal {
	const options: XTerminal['options'] = {
		get fontSize() {
			return typeof term.options.fontSize === 'number' ? term.options.fontSize : 14
		},
		set fontSize(value: number) {
			term.options.fontSize = value
		},
		get theme() {
			return term.options.theme
		},
		set theme(value: Partial<HerdwebConfig['theme']> | undefined) {
			term.options.theme = value
		},
		get fontFamily() {
			return term.options.fontFamily
		},
		set fontFamily(value: string | undefined) {
			term.options.fontFamily = value
		},
	}

	return {
		get cols() {
			return term.cols
		},
		get rows() {
			return term.rows
		},
		get buffer() {
			return {
				active: {
					cursorX: term.buffer.active.cursorX,
					cursorY: term.buffer.active.cursorY,
				},
			}
		},
		get options() {
			return options
		},
		input(data: string) {
			send({ type: 'input', data })
		},
		focus() {
			term.focus()
		},
		blur() {
			term.blur()
		},
		setKeyboardSuppressed(suppressed: boolean) {
			const textarea = term.textarea
			if (!textarea) {
				throw new Error('herdweb: terminal textarea unavailable (terminal not open)')
			}
			if (suppressed) {
				// Spike 增量0 探针⑤: blur first — flipping the attribute alone does
				// not dismiss an already-open soft keyboard.
				textarea.blur()
				textarea.setAttribute('inputmode', 'none')
			} else {
				textarea.removeAttribute('inputmode')
			}
		},
		onFocusChange(handler: (focused: boolean) => void) {
			const textarea = term.textarea
			if (!textarea) {
				throw new Error('herdweb: terminal textarea unavailable (terminal not open)')
			}
			const onFocus = (): void => handler(true)
			const onBlur = (): void => handler(false)
			textarea.addEventListener('focus', onFocus)
			textarea.addEventListener('blur', onBlur)
			return {
				dispose() {
					textarea.removeEventListener('focus', onFocus)
					textarea.removeEventListener('blur', onBlur)
				},
			}
		},
		onData(handler: (data: string) => void) {
			return term.onData(handler)
		},
		isConnected,
		onConnectionChange,
		getConnectionStatus,
		onConnectionStatusChange,
		requestReconnect,
		getSessionId,
		sendInputAction,
		onInputActionResult,
	}
}

interface SessionStatusOverlay {
	readonly element: HTMLDivElement
	readonly message: HTMLDivElement
	readonly button: HTMLButtonElement
}

function clearTimer(timer: number | undefined): void {
	if (timer !== undefined) window.clearTimeout(timer)
}

function createSessionStatusOverlay(onReload: () => void): SessionStatusOverlay {
	const overlay = el('div', {
		id: 'herdweb-session-status',
		style: [
			'display:none',
			'position:fixed',
			'inset:0',
			'z-index:10000',
			'background:rgba(30,30,46,0.92)',
			'color:#cdd6f4',
			'font-family:sans-serif',
			'justify-content:center',
			'align-items:center',
			'flex-direction:column',
			'gap:16px',
		].join(';'),
	})

	const message = el('div', {
		style: 'font-size:1.4rem;font-weight:600',
	})
	const button = el('button', {
		style: [
			'padding:10px 28px',
			'font-size:1rem',
			'border:none',
			'border-radius:8px',
			'background:#cba6f7',
			'color:#1e1e2e',
			'cursor:pointer',
			'font-weight:600',
		].join(';'),
	})
	button.type = 'button'
	button.textContent = 'Reload'
	onTap(button, (event: Event) => {
		event.stopPropagation()
		onReload()
	})

	overlay.appendChild(message)
	overlay.appendChild(button)
	return { element: overlay, message, button }
}

function main(config: HerdwebConfig, version: string | undefined): void {
	const container = document.getElementById('terminal')
	if (!(container instanceof HTMLElement)) {
		throw new Error('herdweb: missing #terminal container')
	}

	const term = new Terminal({
		allowProposedApi: true,
		fontFamily: config.font.family,
		fontSize: config.font.mobileSizeDefault,
		scrollback: 5000,
		theme: config.theme,
	})
	const fitAddon = attachOptionalAddons(term)
	term.open(container)
	document.documentElement.style.background = config.theme.background
	document.body.style.background = config.theme.background
	fitAddon.fit()

	let socket: WebSocket | null = null
	let currentEpoch = 0
	let reconnectTimer: number | undefined
	let snapshotDeadlineTimer: number | undefined
	let heartbeatDeadlineTimer: number | undefined
	let heartbeatNextTimer: number | undefined
	let bufferedAmountCheckTimer: number | undefined
	let heartbeatPingId: string | null = null
	let immediateAttemptQueued = false
	let pageHidden = document.visibilityState === 'hidden'
	const connectionListeners = new Set<(connected: boolean) => void>()
	const connectionStatusListeners = new Set<(status: ConnectionStatus) => void>()
	const inputActionResultListeners = new Set<(result: InputActionResult) => void>()
	let lastConnectedState: boolean | undefined
	let connectionStatus: ConnectionStatus = {
		state: 'disconnected',
		consecutivePreSyncFailures: 0,
		lastFailureReason: null,
	}
	let snapshotLoaded = false
	let snapshotApplying = false
	let sessionId: string | null = null
	let lastProvenFreshAt = 0
	const pendingOutput = new Map<number, string>()
	let pendingOutputBytes = 0
	let pendingResize: { cols: number; rows: number } | null = null
	let notSentNoticeShown = false
	let exitReceived = false
	let statusOverlay: SessionStatusOverlay | null = null

	function send(message: ClientMessage): void {
		if (connectionStatus.state === 'synced' && socket?.readyState === WebSocket.OPEN) {
			if (message.type === 'input' && Date.now() - lastProvenFreshAt > FRESHNESS_WINDOW_MS) {
				failConnection(currentEpoch, 'heartbeat-timeout')
			} else {
				const activeSocket = socket
				const wasBuffered = message.type === 'input' && activeSocket.bufferedAmount > 0
				activeSocket.send(serialiseClientMessage(message))
				if (message.type === 'input' && (wasBuffered || activeSocket.bufferedAmount > 0)) {
					scheduleBufferedAmountCheck(currentEpoch, activeSocket)
				} else if (message.type === 'input') {
					clearTimer(bufferedAmountCheckTimer)
					bufferedAmountCheckTimer = undefined
				}
				return
			}
		}
		if (message.type === 'resize') {
			pendingResize = { cols: message.cols, rows: message.rows }
			return
		}
		if (!notSentNoticeShown) {
			notSentNoticeShown = true
			window.dispatchEvent(
				new CustomEvent('herdweb-connection-notice', {
					detail: 'Not sent — still syncing.',
				}),
			)
		}
	}

	function sendInputAction(id: string, data: string): boolean {
		if (connectionStatus.state !== 'synced' || socket?.readyState !== WebSocket.OPEN) {
			if (!notSentNoticeShown) {
				notSentNoticeShown = true
				window.dispatchEvent(
					new CustomEvent('herdweb-connection-notice', {
						detail: 'Not sent — still syncing.',
					}),
				)
			}
			return false
		}
		if (Date.now() - lastProvenFreshAt > FRESHNESS_WINDOW_MS) {
			failConnection(currentEpoch, 'heartbeat-timeout')
			return false
		}

		const activeSocket = socket
		const wasBuffered = activeSocket.bufferedAmount > 0
		activeSocket.send(serialiseClientMessage({ type: 'input-action', id, data }))
		if (wasBuffered || activeSocket.bufferedAmount > 0) {
			scheduleBufferedAmountCheck(currentEpoch, activeSocket)
		}
		return true
	}

	function syncSize(): void {
		fitAddon.fit()
		send({ type: 'resize', cols: term.cols, rows: term.rows })
	}

	function showSessionStatus(message: string): void {
		if (config.reconnect.enabled) {
			return
		}

		statusOverlay ??= createSessionStatusOverlay(() => {
			location.reload()
		})
		statusOverlay.message.textContent = message
		if (!statusOverlay.element.isConnected) {
			document.body.appendChild(statusOverlay.element)
		}
		statusOverlay.element.style.display = 'flex'
		statusOverlay.button.focus()
	}

	function isConnected(): boolean {
		return connectionStatus.state === 'synced'
	}

	function onConnectionChange(handler: (connected: boolean) => void): { dispose(): void } {
		connectionListeners.add(handler)
		const connected = isConnected()
		lastConnectedState = connected
		handler(connected)
		return {
			dispose() {
				connectionListeners.delete(handler)
			},
		}
	}

	function getConnectionStatus(): ConnectionStatus {
		return connectionStatus
	}

	function onConnectionStatusChange(handler: (status: ConnectionStatus) => void): {
		dispose(): void
	} {
		connectionStatusListeners.add(handler)
		handler(connectionStatus)
		return {
			dispose() {
				connectionStatusListeners.delete(handler)
			},
		}
	}

	function getSessionId(): string | null {
		return sessionId
	}

	function onInputActionResult(handler: (result: InputActionResult) => void): {
		dispose(): void
	} {
		inputActionResultListeners.add(handler)
		return {
			dispose() {
				inputActionResultListeners.delete(handler)
			},
		}
	}

	function notifyConnectionChange(): void {
		const connected = isConnected()
		if (connected === lastConnectedState) return
		lastConnectedState = connected
		for (const listener of connectionListeners) listener(connected)
	}

	function setConnectionStatus(
		state: ConnectionState,
		failureReason = connectionStatus.lastFailureReason,
	): void {
		const next: ConnectionStatus = {
			state,
			consecutivePreSyncFailures: connectionStatus.consecutivePreSyncFailures,
			lastFailureReason: failureReason,
		}
		if (
			next.state === connectionStatus.state &&
			next.consecutivePreSyncFailures === connectionStatus.consecutivePreSyncFailures &&
			next.lastFailureReason === connectionStatus.lastFailureReason
		) {
			return
		}
		connectionStatus = next
		for (const listener of connectionStatusListeners) listener(connectionStatus)
		notifyConnectionChange()
	}

	function stopHeartbeat(): void {
		clearTimer(heartbeatDeadlineTimer)
		clearTimer(heartbeatNextTimer)
		heartbeatDeadlineTimer = undefined
		heartbeatNextTimer = undefined
		heartbeatPingId = null
	}

	function clearConnectionTimers(): void {
		clearTimer(reconnectTimer)
		clearTimer(snapshotDeadlineTimer)
		clearTimer(bufferedAmountCheckTimer)
		reconnectTimer = undefined
		snapshotDeadlineTimer = undefined
		bufferedAmountCheckTimer = undefined
	}

	function checkBufferedAmount(myEpoch: number, activeSocket: WebSocket): void {
		bufferedAmountCheckTimer = undefined
		if (
			myEpoch !== currentEpoch ||
			connectionStatus.state !== 'synced' ||
			socket !== activeSocket ||
			activeSocket.readyState !== WebSocket.OPEN
		) {
			return
		}
		if (activeSocket.bufferedAmount > 0) failConnection(myEpoch, 'socket-error')
	}

	function scheduleBufferedAmountCheck(myEpoch: number, activeSocket: WebSocket): void {
		clearTimer(bufferedAmountCheckTimer)
		bufferedAmountCheckTimer = window.setTimeout(() => {
			checkBufferedAmount(myEpoch, activeSocket)
		}, BUFFERED_AMOUNT_SETTLE_MS)
	}

	function clearPendingOutput(): void {
		pendingOutput.clear()
		pendingOutputBytes = 0
	}

	function recordPreSyncFailure(reason: ConnectionFailureReason): void {
		connectionStatus = {
			state: 'disconnected',
			consecutivePreSyncFailures: connectionStatus.consecutivePreSyncFailures + 1,
			lastFailureReason: reason,
		}
		if (connectionStatus.consecutivePreSyncFailures >= PRE_SYNC_FAILURES_BEFORE_AUTH_HINT) {
			window.dispatchEvent(
				new CustomEvent('herdweb-connection-notice', {
					detail:
						reason === 'protocol-error'
							? 'Connection failed — refresh, and check the server version.'
							: 'Connection failed — you may need to re-authenticate.',
				}),
			)
		}
		for (const listener of connectionStatusListeners) listener(connectionStatus)
		notifyConnectionChange()
	}

	function scheduleReconnect(): void {
		if (pageHidden || reconnectTimer !== undefined) return
		const backoffIndex = Math.min(
			Math.max(connectionStatus.consecutivePreSyncFailures - 1, 0),
			RECONNECT_BACKOFF_MS.length - 1,
		)
		setConnectionStatus('reconnecting')
		reconnectTimer = window.setTimeout(() => {
			reconnectTimer = undefined
			connect()
		}, RECONNECT_BACKOFF_MS[backoffIndex] ?? RECONNECT_BACKOFF_MS[0])
	}

	function invalidateConnection(): void {
		currentEpoch += 1
		clearConnectionTimers()
		stopHeartbeat()
		snapshotLoaded = false
		snapshotApplying = false
		sessionId = null
		clearPendingOutput()
	}

	function failConnection(myEpoch: number, reason: ConnectionFailureReason, notice?: string): void {
		if (myEpoch !== currentEpoch) return
		const sessionEnded = exitReceived
		const failedSocket = socket
		invalidateConnection()
		socket = null
		if (notice) {
			window.dispatchEvent(new CustomEvent('herdweb-connection-notice', { detail: notice }))
		}
		if (connectionStatus.state !== 'synced' || reason === 'protocol-error') {
			recordPreSyncFailure(reason)
		} else {
			setConnectionStatus('disconnected', reason)
		}
		if (sessionEnded) {
			const sessionEndedNotice = 'Session ended — restart herdweb to start a new one.'
			window.dispatchEvent(
				new CustomEvent('herdweb-connection-notice', { detail: sessionEndedNotice }),
			)
			showSessionStatus(sessionEndedNotice)
		}
		failedSocket?.close()
		if (!sessionEnded) scheduleReconnect()
	}

	function sendHeartbeat(myEpoch: number): void {
		if (
			myEpoch !== currentEpoch ||
			connectionStatus.state !== 'synced' ||
			!socket ||
			socket.readyState !== WebSocket.OPEN
		) {
			return
		}
		const id = crypto.randomUUID()
		heartbeatPingId = id
		socket.send(serialiseClientMessage({ type: 'ping', id }))
		heartbeatDeadlineTimer = window.setTimeout(() => {
			if (heartbeatPingId === id) failConnection(myEpoch, 'heartbeat-timeout')
		}, HEARTBEAT_DEADLINE_MS)
	}

	function startHeartbeat(myEpoch: number): void {
		stopHeartbeat()
		sendHeartbeat(myEpoch)
	}

	function applySnapshot(
		myEpoch: number,
		data: string,
		snapshotSessionId: string,
		outputWatermark: number,
	): void {
		if (myEpoch !== currentEpoch || snapshotLoaded || snapshotApplying) return
		snapshotApplying = true
		term.reset()
		term.write(data, () => {
			if (myEpoch !== currentEpoch || !snapshotApplying) return
			clearTimer(snapshotDeadlineTimer)
			snapshotDeadlineTimer = undefined
			snapshotApplying = false
			snapshotLoaded = true
			sessionId = snapshotSessionId
			connectionStatus = {
				state: 'synced',
				consecutivePreSyncFailures: 0,
				lastFailureReason: null,
			}
			notSentNoticeShown = false
			lastProvenFreshAt = Date.now()
			for (const listener of connectionStatusListeners) listener(connectionStatus)
			notifyConnectionChange()

			const buffered = [...pendingOutput.entries()]
			clearPendingOutput()
			for (const [, output] of buffered
				.filter(([seq]) => seq > outputWatermark)
				// oxlint-disable-next-line unicorn/no-array-sort -- buffered is a fresh local array
				.sort(([left], [right]) => left - right)) {
				term.write(output)
			}
			startHeartbeat(myEpoch)
			if (pendingResize && socket?.readyState === WebSocket.OPEN) {
				const resize = pendingResize
				pendingResize = null
				socket.send(serialiseClientMessage({ type: 'resize', ...resize }))
			}
		})
	}

	function handleOutput(myEpoch: number, seq: number, data: string): void {
		if (snapshotLoaded) {
			term.write(data)
			return
		}
		const previous = pendingOutput.get(seq)
		if (previous !== undefined) {
			pendingOutputBytes -= utf8Encoder.encode(previous).byteLength
		}
		pendingOutput.set(seq, data)
		pendingOutputBytes += utf8Encoder.encode(data).byteLength
		if (pendingOutputBytes > MAX_PRE_SNAPSHOT_OUTPUT_BYTES) {
			failConnection(myEpoch, 'output-overflow', 'Output too fast — resyncing.')
		}
	}

	function handlePong(myEpoch: number, id: string): void {
		if (heartbeatPingId !== id) return
		clearTimer(heartbeatDeadlineTimer)
		heartbeatDeadlineTimer = undefined
		heartbeatPingId = null
		lastProvenFreshAt = Date.now()
		heartbeatNextTimer = window.setTimeout(() => {
			heartbeatNextTimer = undefined
			sendHeartbeat(myEpoch)
		}, HEARTBEAT_INTERVAL_MS)
	}

	function handleServerMessage(myEpoch: number, event: MessageEvent): void {
		if (myEpoch !== currentEpoch) return
		if (typeof event.data !== 'string') {
			failConnection(myEpoch, 'protocol-error')
			return
		}
		const message = parseServerMessage(event.data)
		if (!message) {
			failConnection(myEpoch, 'protocol-error')
			return
		}

		switch (message.type) {
			case 'snapshot':
				applySnapshot(myEpoch, message.data, message.sessionId, message.outputWatermark)
				return
			case 'output':
				handleOutput(myEpoch, message.seq, message.data)
				return
			case 'exit':
				exitReceived = true
				return
			case 'error':
				console.error(`herdweb: ${message.message}`)
				return
			case 'pong':
				handlePong(myEpoch, message.id)
				return
			case 'input-accepted':
				for (const handler of inputActionResultListeners) {
					handler({ id: message.id, accepted: true, reason: null })
				}
				return
			case 'input-rejected':
				for (const handler of inputActionResultListeners) {
					handler({
						id: message.id,
						accepted: false,
						reason: message.reason,
					})
				}
				return
		}
	}

	function queueImmediateConnect(force = false): void {
		if (pageHidden || immediateAttemptQueued) return
		// A CONNECTING socket has not produced a snapshot yet, so it is not stale.
		// Let it finish instead of closing it before the handshake completes.
		if (socket?.readyState === WebSocket.CONNECTING) return
		if (!force && (connectionStatus.state === 'synced' || connectionStatus.state === 'syncing'))
			return
		immediateAttemptQueued = true
		queueMicrotask(() => {
			immediateAttemptQueued = false
			if (pageHidden) return
			clearTimer(reconnectTimer)
			reconnectTimer = undefined
			connect()
		})
	}

	function requestReconnect(): void {
		queueImmediateConnect(true)
	}

	function suspendConnection(): void {
		setConnectionStatus('disconnected')
		invalidateConnection()
		const hiddenSocket = socket
		socket = null
		hiddenSocket?.close()
	}

	function connect(): void {
		if (pageHidden) return
		currentEpoch += 1
		const myEpoch = currentEpoch
		clearConnectionTimers()
		stopHeartbeat()
		const previousSocket = socket
		socket = null
		previousSocket?.close()
		snapshotLoaded = false
		snapshotApplying = false
		sessionId = null
		clearPendingOutput()
		exitReceived = false
		setConnectionStatus('reconnecting')

		const nextSocket = new WebSocket(createSocketUrl())
		socket = nextSocket
		window.__herdwebSockets = [nextSocket]

		nextSocket.addEventListener('open', () => {
			if (myEpoch !== currentEpoch) return
			setConnectionStatus('syncing')
			clearTimer(snapshotDeadlineTimer)
			snapshotDeadlineTimer = window.setTimeout(() => {
				failConnection(myEpoch, 'snapshot-timeout')
			}, SNAPSHOT_DEADLINE_MS)
			syncSize()
		})
		nextSocket.addEventListener('close', () => {
			if (myEpoch !== currentEpoch) return
			failConnection(myEpoch, 'socket-closed')
		})
		nextSocket.addEventListener('error', () => {
			if (myEpoch !== currentEpoch) return
			failConnection(myEpoch, 'socket-error')
		})
		nextSocket.addEventListener('message', (event) => handleServerMessage(myEpoch, event))
	}

	const termBridge = createTermBridge(
		term,
		send,
		isConnected,
		onConnectionChange,
		getConnectionStatus,
		onConnectionStatusChange,
		requestReconnect,
		getSessionId,
		sendInputAction,
		onInputActionResult,
	)
	// xterm handles real keyboard/touch input locally; forward it to the shared PTY.
	term.onData((data) => {
		send({ type: 'input', data })
	})
	window.term = termBridge
	window.__herdwebResize = syncSize

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden') {
			pageHidden = true
			suspendConnection()
			return
		}
		pageHidden = false
		queueImmediateConnect(true)
	}

	function onPageHide(): void {
		pageHidden = true
		suspendConnection()
	}

	function onPageShow(event: Event): void {
		pageHidden = false
		const persisted = 'persisted' in event && event.persisted === true
		// 首次加载也会派发 pageshow(persisted=false)，此时不该重连。
		// 判据用新鲜度证明而不是 connectionStatus.state：后者是「没收到坏消息」的
		// 缺席证据（I3 明令禁止），而 lastProvenFreshAt 只由当前 epoch 的 snapshot
		// 应用成功与 ID 匹配的 pong 写入，是在场证据。
		// WebKit 可能在 snapshot 应用前派发 pageshow（socket 已 OPEN 但 lastProvenFreshAt
		// 仍为 0）；此时用 !snapshotLoaded 作为握手仍在进行中的在场证据。
		if (!persisted) {
			if (socket?.readyState === WebSocket.CONNECTING) return
			if (
				socket?.readyState === WebSocket.OPEN &&
				(!snapshotLoaded || Date.now() - lastProvenFreshAt <= FRESHNESS_WINDOW_MS)
			)
				return
		}
		queueImmediateConnect(true)
	}

	function onOnline(): void {
		queueImmediateConnect()
	}

	function onOffline(): void {
		suspendConnection()
	}

	function dispose(): void {
		suspendConnection()
		document.removeEventListener('visibilitychange', onVisibilityChange)
		document.removeEventListener('freeze', onPageHide)
		document.removeEventListener('resume', onPageShow)
		window.removeEventListener('pagehide', onPageHide)
		window.removeEventListener('pageshow', onPageShow)
		window.removeEventListener('online', onOnline)
		window.removeEventListener('offline', onOffline)
		window.removeEventListener('beforeunload', dispose)
	}
	// Keep explicit teardown available without coupling it to a cancelable navigation event.
	void dispose

	document.addEventListener('visibilitychange', onVisibilityChange)
	document.addEventListener('freeze', onPageHide)
	document.addEventListener('resume', onPageShow)
	window.addEventListener('pagehide', onPageHide)
	window.addEventListener('pageshow', onPageShow)
	window.addEventListener('online', onOnline)
	window.addEventListener('offline', onOffline)

	connect()

	// Viewport-driven resizes flow through the height manager (src/viewport/height.ts),
	// which debounces them into a single resizeTerm → __herdwebResize → syncSize call.

	const hooks = createHookRegistry()
	// Image drop: synced/fresh gating reuses the term bridge — isConnected() is the
	// synced state and sendInputAction() enforces heartbeat freshness internally.
	const imageDrop = createImageDropController({
		term: termBridge,
		basePath: __herdwebBasePath ?? '/',
	})
	document.body.appendChild(imageDrop.element)

	const basePath = __herdwebBasePath ?? '/'
	void registerServiceWorker(basePath)

	init(config, hooks, version, { openImageDrop: imageDrop.open, basePath })
}

async function registerServiceWorker(basePath: string): Promise<void> {
	if (!('serviceWorker' in navigator)) return
	try {
		const swPath = joinBasePath(basePath, '/sw.js')
		await navigator.serviceWorker.register(swPath, {
			scope: basePath === '/' ? '/' : `${basePath}/`,
		})
	} catch (error) {
		console.error('herdweb: service worker registration failed', error)
	}
}

main(__herdwebConfig, typeof __herdwebVersion === 'undefined' ? undefined : __herdwebVersion)
