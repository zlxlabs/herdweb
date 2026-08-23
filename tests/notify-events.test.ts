// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NotifyEventError, parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { SlidingWindowRateLimiter } from '../src/notify/rate-limit'
import { registerNotifyRoutes } from '../src/notify/routes'
import { createNotifyService } from '../src/notify/service'
import { buildSecurityHeaders, isAllowedOrigin, withSecurityHeaders } from '../src/serve'

function routeVariants(basePath: string, path: string): readonly string[] {
	return basePath === '/' ? [path] : [path, `${basePath}${path}`]
}

interface TestHarness {
	readonly port: number
	readonly stateDir: string
	readonly notifyService: ReturnType<typeof createNotifyService>
	close(): void
}

async function createHarness(token?: string): Promise<TestHarness> {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-events-'))
	const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
	const app = new Hono()
	const securityHeaders = buildSecurityHeaders('127.0.0.1:0', '127.0.0.1', 0, 'nonce')
	registerNotifyRoutes(app, {
		basePath: '/',
		notifyService,
		stateDir,
		token,
		securityHeadersForRequest: () => securityHeaders,
		routeVariants,
		withSecurityHeaders,
		isAllowedOrigin,
	})

	return await new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
			resolve({
				port: info.port,
				stateDir,
				notifyService,
				close() {
					server.close()
					notifyService.dispose()
					rmSync(stateDir, { recursive: true, force: true })
				},
			})
		})
	})
}

const validBase = {
	v: 1,
	id: 'evt-1',
	kind: 'asking',
	title: 'Need input',
	ts: 1_700_000_000,
} as const

describe('parseNotifyEvent', () => {
	test.each([
		['asking', 'asking'],
		['done', 'done'],
		['ci-red', 'ci-red'],
		['silence', 'silence'],
		['health', 'health'],
		['test', 'test'],
	])('accepts kind=%s', (kind, expected) => {
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, kind }))
		expect(event.kind).toBe(expected)
	})

	test.each([
		['failed kind', { ...validBase, kind: 'failed' }],
		['unknown kind', { ...validBase, kind: 'unknown' }],
		['tool field', { ...validBase, tool: 'grep' }],
		['unknown field', { ...validBase, extra: true }],
		['wrong version', { ...validBase, v: 2 }],
		['missing id for non-test', { v: 1, kind: 'asking', title: 'T', ts: 1 }],
	])('rejects %s with 400', (_label, payload) => {
		try {
			parseNotifyEvent(JSON.stringify(payload))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
		}
	})

	test('truncates title/body/reason', () => {
		const event = parseNotifyEvent(
			JSON.stringify({
				...validBase,
				title: 't'.repeat(200),
				body: 'b'.repeat(300),
				reason: 'r'.repeat(200),
			}),
		)
		expect(event.title).toHaveLength(120)
		expect(event.body).toHaveLength(200)
		expect(event.reason).toHaveLength(120)
	})

	test('rejects raw payload over 4 KiB with 413', () => {
		const huge = JSON.stringify({ ...validBase, body: 'x'.repeat(5000) })
		try {
			parseNotifyEvent(huge)
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(413)
		}
	})
})

describe('POST /api/events', () => {
	let harness: TestHarness

	afterEach(() => {
		harness?.close()
	})

	test('accepts valid event with 202 and persists', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ v: 1, id: 'persist-1', kind: 'done', title: 'Done', ts: 1 }),
		})
		expect(response.status).toBe(202)
		const lines = readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim()
		expect(lines).toContain('persist-1')
	})

	test('requires bearer token when configured', async () => {
		harness = await createHarness('secret')
		const denied = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ v: 1, id: 'auth-1', kind: 'done', title: 'T', ts: 1 }),
		})
		expect(denied.status).toBe(401)
		const allowed = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer secret',
			},
			body: JSON.stringify({ v: 1, id: 'auth-2', kind: 'done', title: 'T', ts: 1 }),
		})
		expect(allowed.status).toBe(202)
	})

	test('returns 429 after 60 events per minute', async () => {
		harness = await createHarness()
		let lastStatus = 202
		for (let i = 0; i < 61; i++) {
			const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ v: 1, id: `rate-${i}`, kind: 'done', title: 'T', ts: i }),
			})
			lastStatus = response.status
		}
		expect(lastStatus).toBe(429)
	})

	test('duplicate id returns 202 without double append', async () => {
		harness = await createHarness()
		const body = JSON.stringify({ v: 1, id: 'dup', kind: 'done', title: 'T', ts: 1 })
		expect(
			(
				await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
				})
			).status,
		).toBe(202)
		expect(
			(
				await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
				})
			).status,
		).toBe(202)
		const lines = readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(lines).toHaveLength(1)
	})

	test('kind=test bypasses dedup and disk', async () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-test-kind-'))
		const sendPush = vi.fn().mockResolvedValue(undefined)
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: Date.now(),
			},
		])
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		const payload = parseNotifyEvent(JSON.stringify({ v: 1, kind: 'test', title: 'T', ts: 1 }))
		expect(notifyService.dispatchEvent(payload)).toBe('accepted')
		expect(notifyService.dispatchEvent(payload)).toBe('accepted')
		expect(() => readFileSync(join(stateDir, 'events.jsonl'))).toThrow()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(2)
		notifyService.dispose()
		rmSync(stateDir, { recursive: true, force: true })
	})

	test('FIFO dedup eviction allows reuse after capacity', () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-fifo-'))
		const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
		for (let i = 0; i < 1001; i++) {
			const event = parseNotifyEvent(
				JSON.stringify({ v: 1, id: `id-${i}`, kind: 'done', title: 'T', ts: i }),
			)
			notifyService.dispatchEvent(event)
		}
		const replay = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'id-0', kind: 'done', title: 'T', ts: 9999 }),
		)
		expect(notifyService.dispatchEvent(replay)).toBe('accepted')
		notifyService.dispose()
		rmSync(stateDir, { recursive: true, force: true })
	})
})

describe('SlidingWindowRateLimiter', () => {
	test('blocks the 61st event in a window', () => {
		const limiter = new SlidingWindowRateLimiter(60, 60_000, () => 0)
		for (let i = 0; i < 60; i++) {
			expect(limiter.allow()).toBe(true)
		}
		expect(limiter.allow()).toBe(false)
	})
})
