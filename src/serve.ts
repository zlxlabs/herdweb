import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { serve as honoServe } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { type Context, Hono } from 'hono'
import type { WSContext } from 'hono/ws'
import type WebSocket from 'ws'
import { bundleClientAssets, bundleSwAsset, bundleWorkletAsset, renderClientHtml } from '../build'
import { bareDocumentRoute, documentRoute, joinBasePath } from './base-path'
import { createLifecycleGate } from './lifecycle-gate'
import { buildRestartEvent, buildSessionEndEvent, shouldAnnounceRestart } from './notify/health'
import { ensureVapidKeys } from './notify/push'
import { registerNotifyRoutes } from './notify/routes'
import { createNotifyService, notifyDrain } from './notify/service'
import { type SilenceDetector, createSilenceDetector } from './notify/silence'
import { readLastSessionStore, resolveNotifyStateDir, updateLastSessionEntry } from './notify/state'
import { manifestToJson } from './pwa/manifest'
import type {
	SessionClient,
	SessionInputMessage,
	SessionServerMessage,
	SharedTerminalSession,
} from './session'
import {
	type AttachError,
	MAX_CLIENT_MESSAGE_BYTES,
	type ServerMessage,
	X_HERDWEB_ATTACHMENT_ID_HEADER,
	parseClientMessage,
	serialiseServerMessage,
} from './session-protocol'
import { TargetRegistry } from './target-registry'
import type { HerdwebConfig, TargetImageDrop } from './types'
import { type SpawnedProcess, spawnProcess } from './util/node-compat'
import { WsAttachmentBinding } from './ws-attachment-binding'

const DEFAULT_PORT = 7681
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_COMMAND = ['herdr', '--session', 'default']
const MAX_OUTBOUND_BUFFERED_BYTES = 1 * 1024 * 1024

function isValidPort(value: string): boolean {
	return /^[0-9]+$/.test(value) && Number(value) > 0 && Number(value) <= 65_535
}

function formatAuthority(host: string, port: number): string {
	if (host.includes(':') && !host.startsWith('[')) {
		return `[${host}]:${port}`
	}
	return `${host}:${port}`
}

export function parseHostHeader(hostHeader: string | undefined): string | null {
	if (hostHeader === undefined) {
		return null
	}

	const trimmed = hostHeader.trim()
	if (
		trimmed.length === 0 ||
		/[/?#@\s]/.test(trimmed) ||
		trimmed.startsWith(':') ||
		trimmed.endsWith(':')
	) {
		return null
	}

	if (trimmed.startsWith('[')) {
		const closingBracket = trimmed.indexOf(']')
		if (closingBracket <= 1) {
			return null
		}

		const suffix = trimmed.slice(closingBracket + 1)
		if (suffix.length === 0) {
			return trimmed
		}

		if (!suffix.startsWith(':') || !isValidPort(suffix.slice(1))) {
			return null
		}

		return trimmed
	}

	const colonCount = [...trimmed].filter((character) => character === ':').length
	if (colonCount > 1) {
		return null
	}

	if (colonCount === 0) {
		return trimmed
	}

	const lastColon = trimmed.lastIndexOf(':')
	const hostname = trimmed.slice(0, lastColon)
	const port = trimmed.slice(lastColon + 1)
	if (hostname.length === 0 || !isValidPort(port)) {
		return null
	}

	return trimmed
}

function stripPort(authority: string): string {
	if (authority.startsWith('[')) {
		const closingBracket = authority.indexOf(']')
		return closingBracket === -1 ? authority : authority.slice(0, closingBracket + 1)
	}

	const lastColon = authority.lastIndexOf(':')
	return lastColon === -1 ? authority : authority.slice(0, lastColon)
}

export function resolveRequestAuthority(
	hostHeader: string | undefined,
	fallbackHost: string,
	fallbackPort: number,
): string {
	return parseHostHeader(hostHeader) ?? formatAuthority(fallbackHost, fallbackPort)
}

function waitForServerListening(
	server: ReturnType<typeof honoServe>,
	port: number,
	host: string,
): Promise<void> {
	if (server.listening) {
		return Promise.resolve()
	}

	return new Promise<void>((resolveListening, reject) => {
		const onListening = () => {
			cleanup()
			resolveListening()
		}
		const onError = (error: Error) => {
			cleanup()
			if ('code' in error && error.code === 'EADDRINUSE') {
				reject(new Error(`herdweb serve failed: port ${port} is already in use on ${host}`))
				return
			}
			reject(error)
		}
		const cleanup = () => {
			server.off('listening', onListening)
			server.off('error', onError)
		}

		server.once('listening', onListening)
		server.once('error', onError)
	})
}

function findIconsDir(): string {
	let dir = import.meta.dirname
	for (let i = 0; i < 5; i++) {
		const candidate = resolve(dir, 'src/pwa/icons')
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	return resolve(import.meta.dirname, 'pwa/icons')
}

const ICONS_DIR = findIconsDir()

/** Build security headers with CSP connect-src scoped to the browser-visible authority.
 * Safari doesn't match ws:/wss: against CSP 'self' (WebKit bug 201591), so we
 * emit explicit ws:// and wss:// origins for the request host instead of bare ws:/wss:. */
export function buildSecurityHeaders(
	hostHeader: string | undefined,
	fallbackHost: string,
	fallbackPort: number,
	scriptNonce: string,
	asrEnabled = false,
) {
	const authority = resolveRequestAuthority(hostHeader, fallbackHost, fallbackPort)
	const connectSrc = asrEnabled
		? `'self' ws://${authority} wss://${authority} wss://openspeech.bytedance.com`
		: `'self' ws://${authority} wss://${authority}`
	return {
		'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${scriptNonce}'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src ${connectSrc}; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
		'x-frame-options': 'DENY',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cross-origin-resource-policy': 'same-origin',
		'permissions-policy': asrEnabled
			? 'camera=(), microphone=(self), geolocation=()'
			: 'camera=(), microphone=(), geolocation=()',
	} as const
}

export function isLoopbackHost(host: string): boolean {
	return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

export function isAllowedOrigin(
	originHeader: string | undefined,
	hostHeader: string | undefined,
): boolean {
	if (originHeader === undefined) {
		const authority = parseHostHeader(hostHeader)
		const hostname = authority ? stripPort(authority).replace(/^\[|\]$/g, '') : ''
		return isLoopbackHost(hostname)
	}
	const authority = parseHostHeader(hostHeader)
	if (authority === null) {
		return false
	}

	try {
		return new URL(originHeader).host === authority
	} catch {
		return false
	}
}

export function withSecurityHeaders(
	response: Response,
	securityHeaders: Record<string, string>,
): Response {
	const headers = new Headers(response.headers)

	for (const [name, value] of Object.entries(securityHeaders)) {
		headers.set(name, value)
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

function closeForProtocolViolation(raw: WebSocket, message: string): void {
	if (raw.readyState < 2) raw.close(1008, message)
}

// This is the binding's wire boundary: real sockets cannot hold a deterministic bufferedAmount threshold for tests.
export function createSessionClient(raw: WebSocket): {
	send(message: ServerMessage): void
	close(): void
} {
	return {
		send(message) {
			if (raw.readyState !== 1) return
			const payload = serialiseServerMessage(message)
			if (raw.bufferedAmount + Buffer.byteLength(payload, 'utf8') > MAX_OUTBOUND_BUFFERED_BYTES) {
				raw.close(1013, 'slow-client')
				return
			}
			try {
				raw.send(payload)
			} catch {
				// The browser may disconnect while PTY output is still being fanned out.
			}
		},
		close() {
			if (raw.readyState < 2) raw.close()
		},
	}
}

/** Read a PNG icon, returns undefined if not found */
function readIcon(filename: string): Uint8Array | undefined {
	try {
		return readFileSync(resolve(ICONS_DIR, filename))
	} catch {
		return undefined
	}
}

/** Spawn caffeinate to prevent system sleep while herdweb is running (macOS only).
 * Uses -s (system sleep on AC) and -w <pid> so the assertion drops when the PTY exits. */
export function spawnCaffeinate(pid: number): SpawnedProcess | null {
	try {
		const proc = spawnProcess(['caffeinate', '-s', '-w', String(pid)], {
			stdout: 'ignore',
			stderr: 'ignore',
		})
		proc.exited.catch(() => {
			console.warn('herdweb: --no-sleep requires caffeinate (macOS only), ignoring')
		})
		console.log(`herdweb: sleep prevention active (caffeinate -s -w ${pid})`)
		return proc
	} catch {
		console.warn('herdweb: --no-sleep requires caffeinate (macOS only), ignoring')
		return null
	}
}

function createScriptNonce(): string {
	return randomBytes(16).toString('hex')
}

function routeVariants(basePath: string, path: string): readonly string[] {
	if (basePath === '/') {
		return [path]
	}

	return Array.from(new Set([path, joinBasePath(basePath, path)]))
}

const IMAGE_DROP_MAX_BYTES = 10 * 1024 * 1024

type ImageDropFormat = 'png' | 'jpeg' | 'webp' | 'gif'
const HEIC_MAJOR_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'])

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false
	return [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0))
}

/** Sniff the image drop format from magic bytes only; client Content-Type and file names are untrusted. */
function detectImageDropFormat(bytes: Uint8Array): ImageDropFormat | 'heic' | null {
	if (asciiAt(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png'
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
	if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'webp'
	if (asciiAt(bytes, 0, 'GIF8')) return 'gif'
	const brand = asciiAt(bytes, 4, 'ftyp') ? String.fromCharCode(...bytes.subarray(8, 12)) : ''
	if (HEIC_MAJOR_BRANDS.has(brand)) return 'heic'
	return null
}

/** Buffer a raw image drop body, returning null the moment it exceeds the 10 MiB limit. */
async function readImageDropBody(
	stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array | null> {
	if (stream === null) return new Uint8Array(0)
	const chunks: Uint8Array[] = []
	let total = 0
	const reader = stream.getReader()
	for (;;) {
		const { done, value } = await reader.read()
		if (done || value === undefined) break
		total += value.byteLength
		if (total > IMAGE_DROP_MAX_BYTES) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	const merged = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		merged.set(chunk, offset)
		offset += chunk.byteLength
	}
	return merged
}

/** Write an image drop to a fresh 0600 temp file; on failure removes only this call's own partial file. */
export async function writeImageDrop(bytes: Uint8Array, format: ImageDropFormat): Promise<string> {
	const path = join(tmpdir(), `herdweb-drop-${randomUUID()}.${format === 'jpeg' ? 'jpg' : format}`)
	const handle = await open(path, 'wx', 0o600)
	try {
		await handle.writeFile(bytes)
	} catch (error) {
		// The original write error must reach the caller; a secondary close
		// failure is swallowed so the partial-file cleanup below always runs.
		await handle.close().catch(() => {})
		await rm(path, { force: true })
		throw error
	}
	await handle.close()
	return path
}

/** Handle a raw image drop POST: origin check, exact 10 MiB limit, magic-byte sniff, 0600 temp file. */
export async function handleImageDropRequest(
	c: Context,
	securityHeadersForRequest: (hostHeader: string | undefined) => Record<string, string>,
	binding: WsAttachmentBinding,
	targetImageDrop: (targetId: string) => TargetImageDrop | undefined,
	write: typeof writeImageDrop = writeImageDrop,
): Promise<Response> {
	const securityHeaders = securityHeadersForRequest(c.req.header('host'))
	const deny = (message: string, status: 400 | 403 | 413 | 415): Response =>
		withSecurityHeaders(c.text(message, status), securityHeaders)
	if (!isAllowedOrigin(c.req.header('origin'), c.req.header('host'))) {
		return deny('Forbidden', 403)
	}
	const guard = (): Response | undefined => {
		const header = c.req.header(X_HERDWEB_ATTACHMENT_ID_HEADER)
		if (!header) return deny('image drop requires x-herdweb-attachment-id header', 400)
		const capability = binding.getImageDropBinding(header)
		if (!capability) return deny('image drop attachment invalid or stale', 403)
		if (targetImageDrop(capability.targetId) !== 'local-path')
			return deny('image drop disabled for this target', 403)
	}
	let rejection = guard()
	if (rejection) return rejection
	const declaredLength = Number(c.req.header('content-length') ?? 0)
	const body =
		declaredLength > IMAGE_DROP_MAX_BYTES ? null : await readImageDropBody(c.req.raw.body)
	if (body === null) return deny('image drop too large: 10 MiB maximum', 413)
	if (body.byteLength === 0) return deny('image drop is empty: POST the raw image file bytes', 400)
	rejection = guard()
	if (rejection) return rejection
	const format = detectImageDropFormat(body)
	if (format === 'heic') {
		return deny(
			'HEIC photos are not supported: convert the photo to JPEG or PNG in the iPhone Photos app first',
			415,
		)
	}
	if (format === null) {
		return deny('unrecognized image drop format: send PNG, JPEG, WebP, or GIF', 415)
	}

	const path = await write(body, format)
	rejection = guard()
	if (rejection) {
		await rm(path, { force: true })
		return rejection
	}
	const response = c.json({ path, format, size: body.byteLength })
	response.headers.set('cache-control', 'no-store')
	return withSecurityHeaders(response, securityHeaders)
}

/** Mount the image drop POST route on every base-path variant. */
function registerImageDropRoutes(
	app: Hono,
	basePath: string,
	securityHeadersForRequest: (hostHeader: string | undefined) => Record<string, string>,
	binding: WsAttachmentBinding,
	targetImageDrop: (targetId: string) => TargetImageDrop | undefined,
): void {
	for (const route of routeVariants(basePath, '/api/image-drop')) {
		app.post(route, (c) =>
			handleImageDropRequest(c, securityHeadersForRequest, binding, targetImageDrop),
		)
	}
}

/** Log the executable without leaking full argv, which may contain secrets or tokens. */
export function describeCommandForLogs(command: readonly string[]): string {
	const [file, ...args] = command
	if (!file) {
		return 'command'
	}
	if (args.length === 0) {
		return file
	}
	return `${file} (${args.length} arg${args.length === 1 ? '' : 's'})`
}

function mountNotifyStack(
	app: Hono,
	config: HerdwebConfig,
	port: number,
	basePath: string,
	swJs: string,
	securityHeadersForRequest: (hostHeader: string | undefined) => Record<string, string>,
): ReturnType<typeof createNotifyService> {
	const stateDir = resolveNotifyStateDir(port)
	ensureVapidKeys(stateDir, config.notify.vapid)
	console.log('herdweb: notify state directory ready (VAPID keys loaded or generated)')
	const notifyService = createNotifyService({
		stateDir,
		historyLimit: config.notify.history.limit,
		targetMode: config.targetMode,
		targetIds: config.targets.map((target) => target.id),
		vapidOverride: config.notify.vapid,
		channels: config.notify.channels,
	})
	registerNotifyRoutes(app, {
		basePath,
		notifyService,
		stateDir,
		targetMode: config.targetMode,
		targetIds: config.targets.map((target) => target.id),
		token: config.notify.token,
		vapidOverride: config.notify.vapid,
		securityHeadersForRequest,
		routeVariants,
		withSecurityHeaders,
		isAllowedOrigin,
	})
	for (const route of routeVariants(basePath, '/sw.js')) {
		app.get(route, (c) =>
			withSecurityHeaders(
				new Response(swJs, {
					headers: {
						'content-type': 'application/javascript',
						'cache-control': 'no-cache',
						'Service-Worker-Allowed': basePath === '/' ? '/' : basePath,
					},
				}),
				securityHeadersForRequest(c.req.header('host')),
			),
		)
	}
	return notifyService
}

export { extractSessionKey } from './notify/health'

type ConnectionState = {
	readonly id: string
	readonly transport: ReturnType<typeof createSessionClient>
	readonly attachments: Map<string, { session: SharedTerminalSession; client: SessionClient }>
}

function rejectAttach(
	connection: ConnectionState,
	requestId: string,
	targetId: string,
	reason: AttachError,
): void {
	connection.transport.send({ type: 'attach-rejected', requestId, targetId, reason })
}

/** Start herdweb serve: build client assets, spawn the PTY, and serve HTTP + WS */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: serve bootstraps HTTP, WS, notify, and PTY lifecycle
export async function serve(
	config: HerdwebConfig,
	port: number = DEFAULT_PORT,
	command: readonly string[] = DEFAULT_COMMAND,
	noSleep = false,
	host: string = DEFAULT_HOST,
	version = 'unknown',
	basePath = '/',
): Promise<void> {
	const { SharedTerminalSession } = await import('./session')

	console.log('herdweb: building client...')
	const scriptNonce = createScriptNonce()
	const { js, css } = await bundleClientAssets(config, version, basePath)
	const swJs = await bundleSwAsset()
	const worklet = config.asr.enabled ? await bundleWorkletAsset() : undefined
	const html = renderClientHtml(js, css, config, scriptNonce, basePath)
	console.log('herdweb: client ready')

	let caffeinateProc: SpawnedProcess | null = null
	const targetConfigs = [
		...(config.targetMode === 'single'
			? config.targets.map((target) =>
					target.id === config.defaultTargetId ? { ...target, command } : target,
				)
			: config.targets),
	].sort((left, right) =>
		left.id === config.defaultTargetId ? -1 : right.id === config.defaultTargetId ? 1 : 0,
	)
	const lifecycle = createLifecycleGate()
	const notifyStateDir = resolveNotifyStateDir(port)
	const previousSessions = readLastSessionStore(notifyStateDir)
	// biome-ignore lint/style/useConst: assigned after HTTP routes, captured by attach lifecycle
	let notifyService: ReturnType<typeof createNotifyService>

	const manifestJson = config.pwa.enabled ? manifestToJson(config.name, config.pwa, basePath) : null
	const icon180 = readIcon('icon-180.png')
	const icon192 = readIcon('icon-192.png')
	const icon512 = readIcon('icon-512.png')

	const connections = new WeakMap<WebSocket, ConnectionState>()
	const connectionsById = new Map<string, ConnectionState>()
	const sessionLifecycles = new Map<string, Promise<void>>()
	let firstExitError: unknown
	const silenceDetectors = new Map<string, SilenceDetector>()
	const binding = new WsAttachmentBinding({
		onTimeout(attachment) {
			connectionsById
				.get(attachment.clientId)
				?.transport.send({ type: 'snapshot-failed', ...attachment, reason: 'timeout' })
		},
		onInvalidate(attachment) {
			const connection = connectionsById.get(attachment.clientId)
			const record = connection?.attachments.get(attachment.attachmentId)
			if (!connection || !record) return
			record.session.removeClient(record.client)
			connection.attachments.delete(attachment.attachmentId)
		},
	})
	const registry = new TargetRegistry(
		targetConfigs,
		(targetCommand) => new SharedTerminalSession(targetCommand),
		(target, createdSession) => {
			if (target.processState === 'process-exited') binding.invalidateTarget(target.id)
			for (const connection of connectionsById.values()) {
				connection.transport.send({ type: 'target-status', target })
			}
			if (target.processState !== 'process-running' || !createdSession) return
			if (sessionLifecycles.has(createdSession.id)) return
			// oxlint-disable-next-line typescript/consistent-type-assertions -- factory returns SharedTerminalSession
			const session = createdSession as SharedTerminalSession
			if (shouldAnnounceRestart(previousSessions[target.id], session.id, Date.now())) {
				notifyService.dispatchEvent(
					buildRestartEvent({
						sessionKey: target.id,
						targetMode: config.targetMode,
						targetId: target.id,
						startTime: session.startTime,
						ts: Date.now(),
					}),
				)
			}
			const detector = createSilenceDetector({
				sessionKey: target.id,
				targetMode: config.targetMode,
				targetId: target.id,
				config: config.notify.silence,
				bytesInWindow: (windowMs) => session.bytesInWindow(windowMs),
				lastOutputAt: () => session.lastOutputAt(),
				dispatch: (event) => notifyService.dispatchEvent(event),
				lastEventAt: (targetId, sessionKey) => notifyService.lastEventAt(targetId, sessionKey),
			})
			silenceDetectors.set(session.id, detector)
			sessionLifecycles.set(
				session.id,
				session.onExit
					.then((exit) => {
						detector.dispose()
						silenceDetectors.delete(session.id)
						const ts = Date.now()
						notifyService.dispatchEvent(
							buildSessionEndEvent({
								sessionKey: target.id,
								targetMode: config.targetMode,
								targetId: target.id,
								startTime: session.startTime,
								exitCode: exit.exitCode,
								signal: exit.signal,
								ts,
							}),
						)
						updateLastSessionEntry(notifyStateDir, target.id, {
							sessionId: session.id,
							exitedAt: ts,
							exitCode: exit.exitCode,
							signal: exit.signal,
						})
					})
					.catch((error: unknown) => {
						console.error('herdweb: target exit fact write failed', error)
						firstExitError ??= error
					}),
			)
		},
	)

	function securityHeadersForRequest(hostHeader: string | undefined): Record<string, string> {
		return buildSecurityHeaders(hostHeader, host, port, scriptNonce, config.asr.enabled)
	}

	function documentHeadersForRequest(hostHeader: string | undefined): Record<string, string> {
		return {
			...securityHeadersForRequest(hostHeader),
			'cache-control': 'private, no-store',
		}
	}

	const app = new Hono()
	app.use('*', async (c, next) => {
		const lease = lifecycle.tryAcquire()
		const securityHeaders = securityHeadersForRequest(c.req.header('host'))
		if (lease === null) {
			return withSecurityHeaders(c.text('Service shutting down', 503), securityHeaders)
		}
		try {
			return await next()
		} finally {
			lease.release()
		}
	})
	const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app })
	wss.options.maxPayload = MAX_CLIENT_MESSAGE_BYTES

	const websocketRoutes = routeVariants(basePath, '/ws')
	for (const route of websocketRoutes) {
		app.use(route, async (c, next) => {
			const securityHeaders = securityHeadersForRequest(c.req.header('host'))
			if (!isAllowedOrigin(c.req.header('origin'), c.req.header('host'))) {
				return withSecurityHeaders(c.text('Forbidden', 403), securityHeaders)
			}
			await next()
		})

		app.get(
			route,
			upgradeWebSocket(() => ({
				async onOpen(_event: Event, ws: WSContext<WebSocket>) {
					const raw = ws.raw
					if (!raw) return
					const lease = lifecycle.tryAcquire()
					if (lease === null) {
						raw.close(1012, 'server shutting down')
						return
					}
					try {
						const connection: ConnectionState = {
							id: randomUUID(),
							transport: createSessionClient(raw),
							attachments: new Map(),
						}
						connections.set(raw, connection)
						connectionsById.set(connection.id, connection)
						connection.transport.send({ type: 'server-ready', protocol: 2 })
						connection.transport.send({ type: 'targets', targets: registry.getSummaries() })
					} finally {
						lease.release()
					}
				},
				// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: attach handshake owns the socket
				async onMessage(event: MessageEvent, ws: WSContext<WebSocket>) {
					const raw = ws.raw
					if (!raw) return
					const lease = lifecycle.tryAcquire()
					if (lease === null) {
						raw.close(1012, 'server shutting down')
						return
					}
					const connection = connections.get(raw)
					if (!connection) {
						raw.close(1008, 'connection not registered')
						lease.release()
						return
					}
					try {
						if (typeof event.data !== 'string') {
							closeForProtocolViolation(raw, 'text websocket messages only')
							return
						}
						const message = parseClientMessage(event.data)
						if (!message) {
							closeForProtocolViolation(raw, 'invalid client message')
							return
						}
						if (message.type === 'ping') {
							connection.transport.send({ type: 'pong', nonce: message.nonce })
							return
						}
						if (message.type === 'attach-target') {
							if (!registry.getSummaries().some((candidate) => candidate.id === message.targetId)) {
								rejectAttach(connection, message.requestId, message.targetId, 'unknown-target')
								return
							}
							const started = binding.beginAttach(
								connection.id,
								message.requestId,
								message.targetId,
							)
							if (!started.ok) {
								rejectAttach(connection, message.requestId, message.targetId, 'protocol-violation')
								return
							}
							const capability = started.capability
							connection.transport.send({
								type: 'attach-started',
								requestId: capability.requestId,
								targetId: capability.targetId,
								attachmentId: capability.attachmentId,
							})
							let session: SharedTerminalSession
							try {
								// oxlint-disable-next-line typescript/consistent-type-assertions -- factory returns SharedTerminalSession
								session = (await registry.getOrStart(message.targetId)) as SharedTerminalSession
							} catch {
								if (!binding.isCurrentAttempt(connection.id, capability)) return
								binding.cancelAttach(connection.id, capability)
								const failed = registry
									.getSummaries()
									.find((candidate) => candidate.id === message.targetId)
								rejectAttach(
									connection,
									message.requestId,
									message.targetId,
									failed?.failure === 'target-process-exited'
										? 'target-process-exited'
										: 'target-start-failed',
								)
								return
							}
							if (!binding.isCurrentAttempt(connection.id, capability)) return
							let snapshotSent = false
							const scoped: SessionClient = {
								send(sessionMessage: SessionServerMessage) {
									if (binding.getCapability(connection.id, capability.attachmentId) === null) return
									// oxlint-disable-next-line typescript/consistent-type-assertions -- session frames gain attachmentId at the wire boundary
									connection.transport.send({
										...sessionMessage,
										attachmentId: capability.attachmentId,
									} as ServerMessage)
									if (
										sessionMessage.type === 'snapshot' &&
										binding.snapshotSent(connection.id, capability).ok
									) {
										snapshotSent = true
									}
								},
								close() {
									session.removeClient(scoped)
									binding.invalidateAttachment(connection.id, capability.attachmentId)
								},
							}
							connection.attachments.set(capability.attachmentId, { session, client: scoped })
							session.handleClientMessage(scoped, {
								type: 'resize',
								cols: message.cols,
								rows: message.rows,
							})
							await session.addClient(scoped)
							if (!snapshotSent && binding.isCurrentAttempt(connection.id, capability)) {
								binding.cancelAttach(connection.id, capability)
							}
							return
						}
						if (message.type === 'snapshot-applied') {
							const capability = binding.getCapability(connection.id, message.attachmentId)
							if (!capability || capability.requestId !== message.requestId) {
								closeForProtocolViolation(raw, 'unknown attachment')
								return
							}
							if (!binding.snapshotApplied(connection.id, capability).ok) {
								closeForProtocolViolation(raw, 'snapshot is not current')
								return
							}
							connection.transport.send({
								type: 'attach-committed',
								requestId: capability.requestId,
								targetId: capability.targetId,
								attachmentId: capability.attachmentId,
							})
							return
						}
						if (message.type === 'restart-target') {
							const summary = registry
								.getSummaries()
								.find((candidate) => candidate.id === message.targetId)
							if (!summary) {
								rejectAttach(connection, message.requestId, message.targetId, 'unknown-target')
								return
							}
							if (summary.processState !== 'process-exited') {
								rejectAttach(connection, message.requestId, message.targetId, 'protocol-violation')
								return
							}
							binding.invalidateTarget(message.targetId)
							let session: SharedTerminalSession
							try {
								// oxlint-disable-next-line typescript/consistent-type-assertions -- factory returns SharedTerminalSession
								session = (await registry.restart(message.targetId)) as SharedTerminalSession
							} catch {
								rejectAttach(connection, message.requestId, message.targetId, 'target-start-failed')
								return
							}
							for (const peer of connectionsById.values()) {
								peer.transport.send({
									type: 'target-restarted',
									targetId: message.targetId,
									sessionId: session.id,
								})
							}
							return
						}
						if (
							message.type !== 'input' &&
							message.type !== 'resize' &&
							message.type !== 'input-action'
						)
							return
						const capability = binding.getCapability(connection.id, message.attachmentId)
						if (!capability) {
							closeForProtocolViolation(raw, 'unknown attachment')
							return
						}
						const record = connection.attachments.get(message.attachmentId)
						if (!record || !capability.committed || !binding.acceptsInput(connection.id)) {
							connection.transport.send({
								type: 'error',
								attachmentId: message.attachmentId,
								message: 'attachment is not committed',
							})
							return
						}
						const sessionMessage: SessionInputMessage =
							message.type === 'input'
								? { type: 'input', data: message.data }
								: message.type === 'resize'
									? { type: 'resize', cols: message.cols, rows: message.rows }
									: { type: 'input-action', id: message.id, data: message.data }
						record.session.handleClientMessage(record.client, sessionMessage)
					} finally {
						lease.release()
					}
				},
				onClose(_event: CloseEvent, ws: WSContext<WebSocket>) {
					const raw = ws.raw
					if (!raw) return
					const connection = connections.get(raw)
					if (!connection) return
					binding.disconnect(connection.id)
					connectionsById.delete(connection.id)
					connections.delete(raw)
				},
			})),
		)
	}

	app.get('/', (c) =>
		withSecurityHeaders(c.html(html), documentHeadersForRequest(c.req.header('host'))),
	)

	const canonicalDocumentRoute = documentRoute(basePath)
	if (canonicalDocumentRoute !== '/') {
		app.get(canonicalDocumentRoute, (c) =>
			withSecurityHeaders(c.html(html), documentHeadersForRequest(c.req.header('host'))),
		)

		const bareRoute = bareDocumentRoute(basePath)
		if (bareRoute) {
			app.get(bareRoute, (c) => {
				const securityHeaders = securityHeadersForRequest(c.req.header('host'))
				return withSecurityHeaders(c.redirect(canonicalDocumentRoute, 308), securityHeaders)
			})
		}
	}

	if (manifestJson !== null) {
		for (const route of routeVariants(basePath, '/manifest.json')) {
			app.get(route, (c) => {
				/* oxlint-disable typescript/consistent-type-assertions -- JSON.parse returns unknown, safe for manifest */
				return withSecurityHeaders(
					c.json(JSON.parse(manifestJson) as Record<string, unknown>),
					securityHeadersForRequest(c.req.header('host')),
				)
				/* oxlint-enable typescript/consistent-type-assertions */
			})
		}
	}

	if (worklet !== undefined) {
		for (const route of routeVariants(basePath, '/asr-worklet.js')) {
			app.get(route, (c) =>
				withSecurityHeaders(
					new Response(worklet, {
						headers: {
							'content-type': 'text/javascript',
							'cache-control': 'no-cache',
						},
					}),
					securityHeadersForRequest(c.req.header('host')),
				),
			)
		}
	}

	if (icon180) {
		for (const route of routeVariants(basePath, '/apple-touch-icon.png')) {
			app.get(route, (c) =>
				withSecurityHeaders(
					new Response(Uint8Array.from(icon180), {
						headers: { 'content-type': 'image/png' },
					}),
					securityHeadersForRequest(c.req.header('host')),
				),
			)
		}
	}

	if (icon192) {
		for (const route of routeVariants(basePath, '/icon-192.png')) {
			app.get(route, (c) =>
				withSecurityHeaders(
					new Response(Uint8Array.from(icon192), {
						headers: { 'content-type': 'image/png' },
					}),
					securityHeadersForRequest(c.req.header('host')),
				),
			)
		}
	}

	if (icon512) {
		for (const route of routeVariants(basePath, '/icon-512.png')) {
			app.get(route, (c) =>
				withSecurityHeaders(
					new Response(Uint8Array.from(icon512), {
						headers: { 'content-type': 'image/png' },
					}),
					securityHeadersForRequest(c.req.header('host')),
				),
			)
		}
	}

	registerImageDropRoutes(
		app,
		basePath,
		securityHeadersForRequest,
		binding,
		(targetId) => targetConfigs.find((target) => target.id === targetId)?.imageDrop,
	)

	notifyService = mountNotifyStack(app, config, port, basePath, swJs, securityHeadersForRequest)
	const server = honoServe({ fetch: app.fetch, port, hostname: host })
	injectWebSocket(server)
	await waitForServerListening(server, port, host)
	caffeinateProc = noSleep ? spawnCaffeinate(process.pid) : null

	console.log(`herdweb: serving on http://${isLoopbackHost(host) ? 'localhost' : host}:${port}`)
	if (!isLoopbackHost(host)) {
		console.warn(`herdweb: warning: --host ${host} exposes terminal control beyond localhost`)
	}

	const cleanup = async (): Promise<void> => {
		console.log('\nherdweb: shutting down...')
		lifecycle.close()
		registry.close()
		for (const detector of silenceDetectors.values()) detector.dispose()
		const listenerClosed = new Promise<void>((resolveClosed, rejectClosed) => {
			server.close((error) => (error ? rejectClosed(error) : resolveClosed()))
		})
		for (const connection of connectionsById.values()) {
			binding.disconnect(connection.id)
			connection.transport.close()
		}
		await Promise.all([listenerClosed, lifecycle.waitForZero()])
		await registry.dispose()
		await Promise.all(sessionLifecycles.values())
		try {
			await notifyDrain(notifyService)
		} catch (error: unknown) {
			if (firstExitError !== undefined) throw firstExitError
			throw error
		} finally {
			notifyService.dispose()
			caffeinateProc?.kill()
		}
		if (firstExitError !== undefined) throw firstExitError
	}

	let shutdownPromise: Promise<void> | undefined
	let resolveShutdown!: () => void
	let rejectShutdown!: (error: unknown) => void
	const shutdownFinished = new Promise<void>((resolveFinished, rejectFinished) => {
		resolveShutdown = resolveFinished
		rejectShutdown = rejectFinished
	})
	const onSignal = (): void => {
		shutdownPromise ??= cleanup()
		void shutdownPromise.then(resolveShutdown, rejectShutdown)
	}
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)
	try {
		await shutdownFinished
	} finally {
		process.off('SIGINT', onSignal)
		process.off('SIGTERM', onSignal)
	}
}
