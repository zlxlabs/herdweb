// @vitest-environment node
import { execSync } from 'node:child_process'
import { createECDH } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { Agent as HttpsAgent, createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import webpush from 'web-push'
import { parseNotifyEvent } from '../src/notify/events'
import {
	type PushSubscriptionRecord,
	readSubscriptions,
	writeSubscriptions,
} from '../src/notify/push'
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

function subscription(id: string, lastSuccessAt: number, key = id): PushSubscriptionRecord {
	return {
		endpoint: `https://push.example/${id}`,
		keys: { p256dh: `${key}-p256dh`, auth: `${key}-auth` },
		lastSuccessAt,
	}
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

const mergeCases = [
	{
		name: 'all success preserves a new subscription',
		initial: [subscription('ok', 1)],
		outcomes: { ok: 'success' },
		concurrentWrite: 'append',
		expected: [subscription('ok', 456), subscription('added', 123)],
	},
	{
		name: 'partial 410 preserves a new subscription',
		initial: [subscription('gone', 1), subscription('ok', 1)],
		outcomes: { gone: 'gone', ok: 'success' },
		concurrentWrite: 'append',
		expected: [subscription('ok', 456), subscription('added', 123)],
	},
	{
		name: 'partial 410 preserves a resubscribed endpoint',
		initial: [subscription('gone', 1), subscription('ok', 1)],
		outcomes: { gone: 'gone', ok: 'success' },
		concurrentWrite: 'resubscribe',
		expected: [subscription('gone', 77, 'resubscribed'), subscription('ok', 456)],
	},
	{
		name: 'non-removable failures preserve a new subscription',
		initial: [subscription('fail', 1)],
		outcomes: { fail: 'failure' },
		concurrentWrite: 'append',
		expected: [subscription('fail', 1), subscription('added', 123)],
	},
] as const

test.each(mergeCases)('$name', async (mergeCase) => {
	stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-delivery-merge-'))
	writeSubscriptions(stateDir, [...mergeCase.initial])

	let releaseDelivery!: () => void
	const deliveryGate = new Promise<void>((resolve) => {
		releaseDelivery = resolve
	})
	let markStarted!: () => void
	const deliveryStarted = new Promise<void>((resolve) => {
		markStarted = resolve
	})
	let firstSend = true
	const sendPush = vi.fn(async (pushSubscription: { endpoint: string }) => {
		if (firstSend) {
			firstSend = false
			if (mergeCase.concurrentWrite === 'append') {
				writeSubscriptions(stateDir, [...readSubscriptions(stateDir), subscription('added', 123)])
			}
			if (mergeCase.concurrentWrite === 'resubscribe') {
				writeSubscriptions(stateDir, [
					subscription('gone', 77, 'resubscribed'),
					...readSubscriptions(stateDir).filter((sub) => !sub.endpoint.endsWith('/gone')),
				])
			}
			markStarted()
			await deliveryGate
		}
		const id = pushSubscription.endpoint.split('/').pop() ?? ''
		const outcome = (mergeCase.outcomes as Readonly<Record<string, string>>)[id]
		if (outcome === 'gone') {
			throw Object.assign(new Error('gone'), { statusCode: 410 })
		}
		if (outcome === 'failure') {
			throw Object.assign(new Error('server'), { statusCode: 503 })
		}
		return { statusCode: 201, body: '', headers: {} }
	})
	const notifyService = createNotifyService({
		stateDir,
		historyLimit: 200,
		sendPush,
		now: () => 456,
	})

	notifyService.dispatchEvent(
		parseNotifyEvent(
			JSON.stringify({
				v: 1,
				id: 'delivery-merge',
				kind: 'done',
				role: 'root',
				title: 'Done',
				ts: 1,
			}),
		),
	)
	await deliveryStarted
	releaseDelivery()
	await notifyService.awaitInFlight(1000)

	expect(readSubscriptions(stateDir)).toEqual(mergeCase.expected)
	notifyService.dispose()
})

test('skipped push does not overwrite a subscription written after dispatch', async () => {
	stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-delivery-skipped-'))
	const added = subscription('added', 123)
	const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
	notifyService.dispatchEvent(
		parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'delivery-skipped', kind: 'test', title: 'Test', ts: 1 }),
		),
	)
	writeSubscriptions(stateDir, [added])
	await notifyService.awaitInFlight(1000)

	expect(readSubscriptions(stateDir)).toEqual([added])
	notifyService.dispose()
})
