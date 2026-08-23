// @vitest-environment node
import { execSync } from 'node:child_process'
import { createECDH } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { Agent as HttpsAgent, createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import webpush from 'web-push'
import { parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'

interface CapturedPushRequest {
	readonly method: string
	readonly headers: Record<string, string | string[] | undefined>
	readonly body: Buffer
}

function generateSubscriptionKeys(): { p256dh: string; auth: string } {
	const ecdh = createECDH('prime256v1')
	ecdh.generateKeys()
	return {
		p256dh: ecdh.getPublicKey().toString('base64url'),
		auth: Buffer.alloc(16, 0xcd).toString('base64url'),
	}
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
	})
}

function createSelfSignedTlsMaterial(): { key: Buffer; cert: Buffer; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'herdweb-push-tls-'))
	execSync(
		'openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 -nodes -subj /CN=localhost',
		{ cwd: dir, stdio: 'ignore' },
	)
	return {
		key: readFileSync(join(dir, 'key.pem')),
		cert: readFileSync(join(dir, 'cert.pem')),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	}
}

function startFakePushEndpoint(): Promise<{
	url: string
	requests: CapturedPushRequest[]
	close: () => Promise<void>
}> {
	const requests: CapturedPushRequest[] = []
	const tls = createSelfSignedTlsMaterial()

	const server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
		const body = await readRequestBody(req)
		const headers: Record<string, string | string[] | undefined> = {}
		for (const [key, value] of Object.entries(req.headers)) {
			headers[key] = value
		}
		requests.push({
			method: req.method ?? 'GET',
			headers,
			body,
		})
		res.writeHead(201)
		res.end()
	})

	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			if (!address || typeof address === 'string') {
				reject(new Error('failed to bind fake push endpoint'))
				return
			}
			resolve({
				url: `https://127.0.0.1:${address.port}/push/device-1`,
				requests,
				close: () =>
					new Promise<void>((closeResolve, closeReject) => {
						server.close((error) => {
							tls.cleanup()
							if (error) closeReject(error)
							else closeResolve()
						})
					}),
			})
		})
	})
}

let stateDir: string

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true })
})

test('dispatchEvent sends encrypted WebPush to subscription endpoint', async () => {
	stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-delivery-'))
	const endpoint = await startFakePushEndpoint()
	const insecureAgent = new HttpsAgent({ rejectUnauthorized: false })

	try {
		writeSubscriptions(stateDir, [
			{
				endpoint: endpoint.url,
				keys: generateSubscriptionKeys(),
				lastSuccessAt: 0,
			},
		])

		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush: (subscription, payload, options) =>
				webpush.sendNotification(subscription, payload, {
					...options,
					agent: insecureAgent,
				}),
		})
		notifyService.dispatchEvent(
			parseNotifyEvent(
				JSON.stringify({ v: 1, id: 'delivery-1', kind: 'done', title: 'Done', ts: 1 }),
			),
		)
		await notifyService.awaitInFlight(5000)

		expect(endpoint.requests).toHaveLength(1)
		const push = endpoint.requests[0]
		expect(push?.method).toBe('POST')
		expect(push?.headers.ttl).toBe('3600')
		const authorization = push?.headers.authorization
		expect(typeof authorization).toBe('string')
		expect(authorization).toMatch(/^vapid /)
		expect(push?.headers['content-encoding']).toBe('aes128gcm')
		expect(push?.body.length).toBeGreaterThan(0)
		notifyService.dispose()
	} finally {
		await endpoint.close()
	}
})
