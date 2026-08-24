import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { MAX_CLIENT_MESSAGE_BYTES, parseServerMessage } from '../src/session-protocol'
import { sleep, spawnProcess } from '../src/util/node-compat'

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
): ReturnType<typeof spawnProcess> {
	const proc = spawnProcess(
		['tsx', join(repoRoot, 'cli.ts'), 'serve', '--port', String(port), '--', ...command],
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

	test('real websocket pings unattached then commits a scoped snapshot', async () => {
		const port = await reservePort()
		const proc = startServe(port, ['cat'])
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
			client.send(JSON.stringify({ type: 'ping', nonce: 'health-ping' }))
			expect(await pong).toEqual({ type: 'pong', nonce: 'health-ping' })
			const targetId = targets.targets[0].id
			const status = (processState: string) => (message: ReturnType<typeof parseServerMessage>) =>
				message?.type === 'target-status' && message.target.processState === processState
			client.send(
				JSON.stringify({
					type: 'attach-target',
					requestId: 'attach-1',
					targetId,
					cols: 80,
					rows: 24,
				}),
			)
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
			client.send(
				JSON.stringify({
					type: 'snapshot-applied',
					requestId: started.requestId,
					attachmentId: started.attachmentId,
				}),
			)
			expect(await waitForJsonMessage(client, 10_000, isType('attach-committed'))).toEqual({
				type: 'attach-committed',
				requestId: started.requestId,
				targetId: started.targetId,
				attachmentId: started.attachmentId,
			})
			client.send(
				JSON.stringify({ type: 'input', attachmentId: started.attachmentId, data: 'wire-marker' }),
			)
			expect(await waitForJsonMessage(client, 10_000, isType('output'))).toMatchObject({
				type: 'output',
				attachmentId: started.attachmentId,
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
): Promise<{ statusCode: number; path?: string; size?: number }> {
	return new Promise((resolve, reject) => {
		let responded = false
		const request = httpRequest(
			url,
			{ method: 'POST', headers: mode === 'chunked' ? {} : { 'content-length': body.length } },
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
	test('accepts exactly 10 MiB and rejects 10 MiB + 1, with content-length or chunked', async () => {
		const port = await reservePort()
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-abuse-'))
		const proc = startServe(port, ['bash', '--norc', '--noprofile'], { TMPDIR: dropDir })
		try {
			const endpoint = `http://127.0.0.1:${port}/api/image-drop`
			await waitForHttp(`http://127.0.0.1:${port}`)

			const tenMiB = Buffer.alloc(10 * 1024 * 1024)
			PNG_MAGIC.copy(tenMiB)
			const accepted = await postRawImageDrop(endpoint, tenMiB, 'content-length')
			expect(accepted.statusCode).toBe(200)
			// Boolean comparison: a failing toEqual on 10 MiB buffers would OOM the reporter.
			expect(readFileSync(accepted.path ?? '').equals(tenMiB)).toBe(true)

			const tooLarge = Buffer.concat([tenMiB, Buffer.from([0])])
			expect((await postRawImageDrop(endpoint, tooLarge, 'declare-only')).statusCode).toBe(413)
			expect((await postRawImageDrop(endpoint, tooLarge, 'chunked')).statusCode).toBe(413)

			const chunkedPng = await postRawImageDrop(endpoint, PNG_MAGIC, 'chunked')
			expect(chunkedPng.statusCode).toBe(200)
			expect(readFileSync(chunkedPng.path ?? '')).toEqual(PNG_MAGIC)
		} finally {
			await stopServe(proc)
			rmSync(dropDir, { recursive: true, force: true })
		}
	})
})
