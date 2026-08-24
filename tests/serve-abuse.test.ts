import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { handleImageDropRequest, writeImageDrop } from '../src/serve'
import {
	MAX_CLIENT_MESSAGE_BYTES,
	X_HERDWEB_ATTACHMENT_ID_HEADER,
	parseServerMessage,
} from '../src/session-protocol'
import { sleep, spawnProcess } from '../src/util/node-compat'
import { WsAttachmentBinding } from '../src/ws-attachment-binding'

const repoRoot = join(import.meta.dirname, '..')
const runningProcesses: ReturnType<typeof spawnProcess>[] = []
const queuedMessages = new WeakMap<WebSocket, string[]>()

afterEach(async () => {
	while (runningProcesses.length > 0) {
		const proc = runningProcesses.pop()
		if (!proc) continue
		proc.kill('SIGINT')
		await proc.exited.catch(() => 1)
	}
})

async function reservePort(): Promise<number> {
	const server = createServer()

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})

	const address = server.address()
	if (!address || typeof address === 'string') {
		server.close()
		throw new Error('failed to reserve test port')
	}

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error)
				return
			}
			resolve()
		})
	})

	return address.port
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url)
			if (response.ok) {
				return
			}
		} catch {
			// server not ready yet
		}

		await sleep(100)
	}

	throw new Error(`timed out waiting for ${url}`)
}

function startServe(
	port: number,
	command = ['bash', '--norc', '--noprofile'],
	env?: NodeJS.ProcessEnv,
	args: string[] = [],
): ReturnType<typeof spawnProcess> {
	const proc = spawnProcess(
		['tsx', join(repoRoot, 'cli.ts'), 'serve', '--port', String(port), ...args, '--', ...command],
		{
			cwd: repoRoot,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, ...env },
		},
	)
	runningProcesses.push(proc)
	return proc
}

function rawPayload(data: WebSocket.RawData): string {
	return typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : ''
}

function takeQueued(ws: WebSocket, match: (payload: string) => boolean): string | undefined {
	const queue = queuedMessages.get(ws)
	const index = queue?.findIndex(match) ?? -1
	if (!queue || index < 0) return
	return queue.splice(index, 1)[0]
}

function waitForRawMessage(ws: WebSocket, timeoutMs = 10_000): Promise<string> {
	const queued = takeQueued(ws, () => true)
	if (queued !== undefined) return Promise.resolve(queued)
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('timed out waiting for websocket message'))
		}, timeoutMs)
		const onMessage = (data: WebSocket.RawData) => {
			const payload = rawPayload(data)
			takeQueued(ws, (item) => item === payload)
			cleanup()
			resolve(payload)
		}
		const onClose = () => {
			cleanup()
			reject(new Error('websocket closed before a message arrived'))
		}
		const cleanup = () => {
			clearTimeout(timer)
			ws.off('message', onMessage)
			ws.off('close', onClose)
		}
		ws.on('message', onMessage)
		ws.on('close', onClose)
	})
}

async function stopServe(proc: ReturnType<typeof spawnProcess>): Promise<void> {
	const index = runningProcesses.indexOf(proc)
	if (index !== -1) {
		runningProcesses.splice(index, 1)
	}
	proc.kill('SIGINT')
	await proc.exited
}

function openSocket(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			origin: `http://127.0.0.1:${port}`,
		})
		const queue: string[] = []
		queuedMessages.set(ws, queue)
		ws.on('message', (data) => queue.push(rawPayload(data)))

		const onError = (error: Error) => {
			cleanup()
			reject(error)
		}
		const onOpen = () => {
			cleanup()
			resolve(ws)
		}
		const cleanup = () => {
			ws.off('error', onError)
			ws.off('open', onOpen)
		}

		ws.on('error', onError)
		ws.on('open', onOpen)
	})
}

function waitForJsonMessage(
	ws: WebSocket,
	timeoutMs = 10_000,
	predicate: (message: ReturnType<typeof parseServerMessage>) => boolean = () => true,
): Promise<ReturnType<typeof parseServerMessage>> {
	const queued = takeQueued(ws, (payload) => {
		const parsed = parseServerMessage(payload)
		return parsed !== null && predicate(parsed)
	})
	if (queued !== undefined) return Promise.resolve(parseServerMessage(queued))
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('timed out waiting for websocket message'))
		}, timeoutMs)

		const onMessage = (data: WebSocket.RawData) => {
			const payload = rawPayload(data)
			const parsed = parseServerMessage(payload)
			if (parsed === null || !predicate(parsed)) return
			takeQueued(ws, (item) => item === payload)
			cleanup()
			resolve(parsed)
		}

		const onClose = () => {
			cleanup()
			reject(new Error('websocket closed before a message arrived'))
		}

		const cleanup = () => {
			clearTimeout(timer)
			ws.off('message', onMessage)
			ws.off('close', onClose)
		}

		ws.on('message', onMessage)
		ws.on('close', onClose)
	})
}

const isType = (type: string) => (message: ReturnType<typeof parseServerMessage>) =>
	message?.type === type

function sendJson(ws: WebSocket, message: Record<string, unknown>): void {
	ws.send(JSON.stringify(message))
}

async function commitAttachment(port: number, targetId?: string): Promise<string> {
	const ws = await openSocket(port)
	await waitForJsonMessage(ws, 10_000, isType('server-ready'))
	sendJson(ws, {
		type: 'attach-target',
		requestId: 'drop-r1',
		targetId: targetId ?? 'default',
		cols: 80,
		rows: 24,
	})
	const started = await waitForJsonMessage(ws, 10_000, isType('attach-started'))
	if (started?.type !== 'attach-started') throw new Error('attach-started missing')
	await waitForJsonMessage(ws, 10_000, isType('snapshot'))
	sendJson(ws, {
		type: 'snapshot-applied',
		requestId: started.requestId,
		attachmentId: started.attachmentId,
	})
	await waitForJsonMessage(ws, 10_000, isType('attach-committed'))
	return started.attachmentId
}

function handlerRequest(
	binding: WsAttachmentBinding,
	attachmentId: string,
	body: Buffer,
	targetImageDrop: (targetId: string) => 'local-path' | 'disabled' | undefined = () => 'local-path',
	write: typeof writeImageDrop = writeImageDrop,
): Response | Promise<Response> {
	const app = new Hono()
	app.post('/drop', (c) => handleImageDropRequest(c, () => ({}), binding, targetImageDrop, write))
	return app.request('http://localhost/drop', {
		method: 'POST',
		headers: {
			host: 'localhost',
			origin: 'http://localhost',
			[X_HERDWEB_ATTACHMENT_ID_HEADER]: attachmentId,
		},
		body: body as unknown as BodyInit,
	})
}

function committedBinding(targetId = 'target'): [WsAttachmentBinding, string] {
	const binding = new WsAttachmentBinding()
	const started = binding.beginAttach('client', 'request', targetId)
	if (!started.ok) throw new Error('failed to begin test attachment')
	binding.snapshotSent('client', started.capability)
	binding.snapshotApplied('client', started.capability)
	return [binding, started.capability.attachmentId]
}

function waitForClose(ws: WebSocket, timeoutMs = 10_000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('timed out waiting for websocket close'))
		}, timeoutMs)

		const onClose = (code: number) => {
			cleanup()
			resolve(code)
		}
		const cleanup = () => {
			clearTimeout(timer)
			ws.off('close', onClose)
		}

		ws.on('close', onClose)
	})
}

describe('serve websocket hardening', () => {
	test('oversized websocket frames are rejected without killing the terminal session', async () => {
		const port = await reservePort()
		const proc = startServe(port)

		try {
			await waitForHttp(`http://127.0.0.1:${port}`)

			const abusiveClient = await openSocket(port)
			await waitForJsonMessage(abusiveClient)
			const closePromise = waitForClose(abusiveClient)
			abusiveClient.send('x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1))
			expect(await closePromise).toBeGreaterThan(0)

			const healthyClient = await openSocket(port)
			await waitForJsonMessage(healthyClient)
			const responsePromise = waitForJsonMessage(
				healthyClient,
				10_000,
				(message) => message?.type === 'pong' && message.nonce === 'health-ping',
			)
			healthyClient.send(JSON.stringify({ type: 'ping', nonce: 'health-ping' }))

			const response = await responsePromise
			expect(response).toEqual({ type: 'pong', nonce: 'health-ping' })
			healthyClient.close()
		} finally {
			await stopServe(proc)
		}
	})

	test('real websocket sends ready then target summaries without starting a PTY', async () => {
		const port = await reservePort()
		const markerDir = mkdtempSync(join(tmpdir(), 'herdweb-no-spawn-'))
		const marker = join(markerDir, 'started')
		const proc = startServe(port, ['bash', '-c', `touch ${marker}; sleep 60`])
		try {
			await waitForHttp(`http://127.0.0.1:${port}`)
			const client = await openSocket(port)
			expect(await waitForRawMessage(client)).toBe('{"type":"server-ready","protocol":2}')
			expect(await waitForRawMessage(client)).toBe(
				'{"type":"targets","targets":[{"id":"default","name":"Default","processState":"not-started","capabilities":{"imageDrop":"local-path"}}]}',
			)
			expect(existsSync(marker)).toBe(false)
			client.close()
		} finally {
			await stopServe(proc)
			rmSync(markerDir, { recursive: true, force: true })
		}
	})

	test('real websocket gates old committed input during a provisional attach', async () => {
		const port = await reservePort()
		const proc = startServe(port, [
			'bash',
			'-c',
			'stty -echo; while IFS= read -r line; do if [ "$line" = size ]; then printf "%s" "$(stty size)"; fi; done',
		])
		try {
			await waitForHttp(`http://127.0.0.1:${port}`)
			const client = await openSocket(port)
			expect(await waitForJsonMessage(client)).toEqual({ type: 'server-ready', protocol: 2 })
			const targets = await waitForJsonMessage(client)
			if (targets?.type !== 'targets' || !targets.targets[0]) {
				throw new Error('targets frame missing')
			}
			const pong = waitForJsonMessage(
				client,
				10_000,
				(message) => message?.type === 'pong' && message.nonce === 'health-ping',
			)
			sendJson(client, { type: 'ping', nonce: 'health-ping' })
			expect(await pong).toEqual({ type: 'pong', nonce: 'health-ping' })
			const targetId = targets.targets[0].id
			const status = (processState: string) => (message: ReturnType<typeof parseServerMessage>) =>
				message?.type === 'target-status' && message.target.processState === processState
			sendJson(client, {
				type: 'attach-target',
				requestId: 'attach-1',
				targetId,
				cols: 80,
				rows: 24,
			})
			const started = await waitForJsonMessage(client, 10_000, isType('attach-started'))
			if (started?.type !== 'attach-started') throw new Error('attach-started frame missing')
			expect(await waitForJsonMessage(client, 10_000, status('starting'))).toMatchObject({
				type: 'target-status',
				target: { id: targetId, processState: 'starting' },
			})
			expect(await waitForJsonMessage(client, 10_000, status('process-running'))).toMatchObject({
				type: 'target-status',
				target: { id: targetId, processState: 'process-running' },
			})
			const snapshot = await waitForJsonMessage(client, 10_000, isType('snapshot'))
			if (snapshot?.type !== 'snapshot') throw new Error('snapshot frame missing')
			expect(snapshot.attachmentId).toBe(started.attachmentId)
			sendJson(client, {
				type: 'snapshot-applied',
				requestId: started.requestId,
				attachmentId: started.attachmentId,
			})
			expect(await waitForJsonMessage(client, 10_000, isType('attach-committed'))).toEqual({
				type: 'attach-committed',
				requestId: started.requestId,
				targetId: started.targetId,
				attachmentId: started.attachmentId,
			})
			sendJson(client, {
				type: 'attach-target',
				requestId: 'attach-2',
				targetId,
				cols: 80,
				rows: 24,
			})
			const replacement = await waitForJsonMessage(client, 10_000, isType('attach-started'))
			if (replacement?.type !== 'attach-started')
				throw new Error('replacement attach-started missing')
			await waitForJsonMessage(client, 10_000, isType('snapshot'))

			const staleFrames = [
				{ type: 'input', attachmentId: started.attachmentId, data: 'stale\n' },
				{ type: 'resize', attachmentId: started.attachmentId, cols: 123, rows: 45 },
				{
					type: 'input-action',
					attachmentId: started.attachmentId,
					id: 'stale-action',
					data: 'size\n',
				},
			] as const
			for (const frame of staleFrames) {
				const error = waitForJsonMessage(client, 10_000, isType('error'))
				sendJson(client, frame)
				expect(await error).toEqual({
					type: 'error',
					attachmentId: started.attachmentId,
					message: 'attachment is not committed',
				})
			}

			sendJson(client, {
				type: 'snapshot-applied',
				requestId: replacement.requestId,
				attachmentId: replacement.attachmentId,
			})
			expect(await waitForJsonMessage(client, 10_000, isType('attach-committed'))).toMatchObject({
				type: 'attach-committed',
				attachmentId: replacement.attachmentId,
			})
			sendJson(client, { type: 'input', attachmentId: replacement.attachmentId, data: 'size\n' })
			const replacementOutput = await waitForJsonMessage(client, 10_000, isType('output'))
			if (replacementOutput?.type !== 'output') throw new Error('replacement PTY output missing')
			expect(replacementOutput.data).toContain('24 80')
			sendJson(client, {
				type: 'input-action',
				attachmentId: replacement.attachmentId,
				id: 'live-action',
				data: 'size\n',
			})
			expect(await waitForJsonMessage(client, 10_000, isType('input-accepted'))).toMatchObject({
				type: 'input-accepted',
				id: 'live-action',
			})
			client.close()
		} finally {
			await stopServe(proc)
		}
	})
})

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// How the body is transmitted: 'declare-only' sends headers with an over-limit content-length
// and zero body bytes (the server rejects from headers alone); 'content-length' sends the whole
// body with one end(); 'chunked' streams 256 KiB blocks without a content-length header.
type ImageDropPostMode = 'declare-only' | 'content-length' | 'chunked'
function postRawImageDrop(
	url: string,
	body: Buffer,
	mode: ImageDropPostMode,
	headers: Record<string, string> = {},
): Promise<{ statusCode: number; path?: string; size?: number }> {
	return new Promise((resolve, reject) => {
		let responded = false
		const request = httpRequest(
			url,
			{
				method: 'POST',
				headers: { ...(mode === 'chunked' ? {} : { 'content-length': body.length }), ...headers },
			},
			(response) => {
				responded = true
				const chunks: Buffer[] = []
				response.on('data', (chunk: Buffer) => chunks.push(chunk))
				response.once('end', () => {
					const text = Buffer.concat(chunks).toString('utf-8')
					const parsed: { path?: string; size?: number } =
						response.statusCode === 200 ? JSON.parse(text) : {}
					resolve({ statusCode: response.statusCode ?? 0, ...parsed })
					// declare-only never sends a body, so the request stays open until torn down here.
					if (mode === 'declare-only') request.destroy()
				})
			},
		)
		// Once a response arrived it is the source of truth; reject only when none ever did.
		request.on('error', (error) => {
			if (!responded) reject(error)
		})
		// Writes still in flight when the socket dies surface on the socket itself (WriteWrap
		// EPIPE), outside the request's error forwarding — swallow them explicitly.
		request.on('socket', (socket) => socket.on('error', () => {}))
		if (mode === 'declare-only') {
			// The server short-circuits on the declared content-length, so not a single body byte
			// is written — no upload bytes ever race the 413 or the socket reset.
			request.flushHeaders()
			return
		}
		if (mode === 'content-length') {
			// The server only responds after reading the full declared body — no early response.
			request.end(body)
			return
		}
		// Chunked: the server's streaming counter trips the limit only after the final byte
		// arrives, and by then every block below is already handed to the kernel — the cancel
		// can never race an in-flight write.
		for (let offset = 0; offset < body.length; offset += 262_144) {
			request.write(body.subarray(offset, offset + 262_144))
		}
		request.end()
	})
}

describe('image drop body limits', () => {
	test('accepts exactly 10 MiB and rejects 10 MiB + 1 by content-length', async () => {
		const port = await reservePort()
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-abuse-'))
		const proc = startServe(port, ['bash', '--norc', '--noprofile'], { TMPDIR: dropDir })
		try {
			await waitForHttp(`http://127.0.0.1:${port}`)
			const attachmentId = await commitAttachment(port)
			const dropHeader = { [X_HERDWEB_ATTACHMENT_ID_HEADER]: attachmentId }
			const endpoint = `http://127.0.0.1:${port}/api/image-drop`

			const tenMiB = Buffer.alloc(10 * 1024 * 1024)
			PNG_MAGIC.copy(tenMiB)
			const accepted = await postRawImageDrop(endpoint, tenMiB, 'content-length', dropHeader)
			expect(accepted.statusCode).toBe(200)
			// Boolean comparison: a failing toEqual on 10 MiB buffers would OOM the reporter.
			expect(readFileSync(accepted.path ?? '').equals(tenMiB)).toBe(true)

			const tooLarge = Buffer.concat([tenMiB, Buffer.from([0])])
			expect(
				(await postRawImageDrop(endpoint, tooLarge, 'declare-only', dropHeader)).statusCode,
			).toBe(413)
		} finally {
			await stopServe(proc)
			rmSync(dropDir, { recursive: true, force: true })
		}
	})
})

describe('image drop attachment binding', () => {
	test('explicit targets honor local-path and disabled capability', async () => {
		const port = await reservePort()
		const configDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-config-'))
		const configPath = join(configDir, 'config.ts')
		writeFileSync(
			configPath,
			`export default {"defaultTargetId":"local","targets":[{"id":"local","name":"Local","command":["bash"],"imageDrop":"local-path"},{"id":"off","name":"Off","command":["bash"]}]}`,
		)
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-explicit-'))
		const proc = startServe(port, [], { TMPDIR: dropDir }, ['--config', configPath])
		try {
			await waitForHttp(`http://127.0.0.1:${port}`)
			const endpoint = `http://127.0.0.1:${port}/api/image-drop`
			expect((await postRawImageDrop(endpoint, PNG_MAGIC, 'declare-only')).statusCode).toBe(400)
			const forged = await postRawImageDrop(endpoint, PNG_MAGIC, 'declare-only', {
				[X_HERDWEB_ATTACHMENT_ID_HEADER]: 'forged-token',
			})
			expect(forged.statusCode).toBe(403)
			const pending = await openSocket(port)
			await waitForJsonMessage(pending, 10_000, isType('server-ready'))
			sendJson(pending, {
				type: 'attach-target',
				requestId: 'drop-pending',
				targetId: 'local',
				cols: 80,
				rows: 24,
			})
			const started = await waitForJsonMessage(pending, 10_000, isType('attach-started'))
			if (started?.type !== 'attach-started') throw new Error('attach-started missing')
			await waitForJsonMessage(pending, 10_000, isType('snapshot'))
			expect(
				(
					await postRawImageDrop(endpoint, PNG_MAGIC, 'declare-only', {
						[X_HERDWEB_ATTACHMENT_ID_HEADER]: started.attachmentId,
					})
				).statusCode,
			).toBe(403)
			pending.close()
			const local = await commitAttachment(port, 'local')
			const off = await commitAttachment(port, 'off')
			expect([
				(
					await postRawImageDrop(endpoint, PNG_MAGIC, 'content-length', {
						[X_HERDWEB_ATTACHMENT_ID_HEADER]: local,
					})
				).statusCode,
				(
					await postRawImageDrop(endpoint, PNG_MAGIC, 'declare-only', {
						[X_HERDWEB_ATTACHMENT_ID_HEADER]: off,
					})
				).statusCode,
			]).toEqual([200, 403])
		} finally {
			await stopServe(proc)
			for (const dir of [configDir, dropDir]) rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('image drop handler guards', () => {
	test('rechecks after body and response, and removes a stale post-write file', async () => {
		const [beforeBinding, beforeAttachment] = committedBinding()
		let checks = 0
		let writes = 0
		const write = async () => {
			writes += 1
			return 'unexpected'
		}
		const rejectedBeforeWrite = await handlerRequest(
			beforeBinding,
			beforeAttachment,
			PNG_MAGIC,
			() => (++checks === 2 ? 'disabled' : 'local-path'),
			write,
		)
		expect(rejectedBeforeWrite.status).toBe(403)
		expect(writes).toBe(0)

		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-orphan-'))
		const [afterBinding, afterAttachment] = committedBinding()
		const orphan = join(dropDir, 'created.png')
		const rejectedAfterWrite = await handlerRequest(
			afterBinding,
			afterAttachment,
			PNG_MAGIC,
			undefined,
			async (bytes) => {
				writeFileSync(orphan, bytes)
				afterBinding.disconnect('client')
				return orphan
			},
		)
		expect(rejectedAfterWrite.status).toBe(403)
		expect(await rejectedAfterWrite.text()).not.toContain('path')
		expect(existsSync(orphan)).toBe(false)
		rmSync(dropDir, { recursive: true, force: true })
	})
})
