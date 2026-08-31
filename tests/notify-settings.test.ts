// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { registerNotifyRoutes } from '../src/notify/routes'
import { createNotifyService } from '../src/notify/service'
import { readNotifySettings } from '../src/notify/state'
import { buildSecurityHeaders, isAllowedOrigin, withSecurityHeaders } from '../src/serve'

function routeVariants(basePath: string, path: string): readonly string[] {
	return basePath === '/' ? [path] : [path, `${basePath}${path}`]
}

interface TestHarness {
	readonly port: number
	readonly stateDir: string
	readonly notifyService: ReturnType<typeof createNotifyService>
	readonly sendPush: ReturnType<typeof vi.fn>
	close(): void
}

async function createHarness(): Promise<TestHarness> {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-settings-'))
	writeSubscriptions(stateDir, [
		{
			endpoint: 'https://push.example/device',
			keys: { p256dh: 'k', auth: 'a' },
			lastSuccessAt: 1,
		},
	])
	const sendPush = vi.fn().mockResolvedValue(undefined)
	const notifyService = createNotifyService({
		stateDir,
		historyLimit: 200,
		sendPush,
		isAwayMode: () => readNotifySettings(stateDir).awayMode,
	})
	const app = new Hono()
	const securityHeaders = buildSecurityHeaders('127.0.0.1:0', '127.0.0.1', 0, 'nonce')
	registerNotifyRoutes(app, {
		basePath: '/',
		notifyService,
		stateDir,
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
				sendPush,
				close() {
					server.close()
					notifyService.dispose()
					rmSync(stateDir, { recursive: true, force: true })
				},
			})
		})
	})
}

function deferrableAsking(id: string) {
	return parseNotifyEvent(
		JSON.stringify({
			v: 1,
			id,
			kind: 'asking',
			title: 'T',
			ts: 1_700_000_000_000,
			presence: 'likely-present',
		}),
	)
}

describe('/api/notify/settings', () => {
	let harness: TestHarness

	afterEach(() => {
		vi.restoreAllMocks()
		harness?.close()
	})

	test('GET returns the default when no settings file exists', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ awayMode: false })
	})

	test('PUT persists awayMode and GET reflects it', async () => {
		harness = await createHarness()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		const put = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ awayMode: true }),
		})
		expect(put.status).toBe(200)
		expect(await put.json()).toEqual({ awayMode: true })
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'notify-settings.json'), 'utf-8'),
		) as unknown
		expect(stored).toEqual({ awayMode: true })
		const get = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`)
		expect(await get.json()).toEqual({ awayMode: true })
	})

	test('PUT with an unknown field returns 400', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ awayMode: true, theme: 'dark' }),
		})
		expect(response.status).toBe(400)
		expect(readNotifySettings(harness.stateDir)).toEqual({ awayMode: false })
	})

	test('PUT with a non-boolean awayMode returns 400', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ awayMode: 'yes' }),
		})
		expect(response.status).toBe(400)
	})

	test('PUT from a cross-origin request returns 403', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				origin: 'https://evil.example',
			},
			body: JSON.stringify({ awayMode: true }),
		})
		expect(response.status).toBe(403)
		expect(readNotifySettings(harness.stateDir)).toEqual({ awayMode: false })
	})

	test('PUT awayMode=true flushes pending presence-deferred events immediately', async () => {
		harness = await createHarness()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		harness.notifyService.dispatchEvent(deferrableAsking('held-1'))
		expect(harness.sendPush).not.toHaveBeenCalled()

		const put = await fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ awayMode: true }),
		})
		expect(put.status).toBe(200)
		expect(harness.sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(harness.sendPush.mock.calls[0]?.[1]))).toMatchObject({
			id: 'held-1',
		})

		// While away mode is on, new likely-present events are no longer deferred.
		harness.notifyService.dispatchEvent(deferrableAsking('held-2'))
		expect(harness.sendPush).toHaveBeenCalledTimes(2)
		await harness.notifyService.awaitInFlight(1000)
	})

	test('PUT awayMode=false restores the defer behavior', async () => {
		harness = await createHarness()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		const put = (awayMode: boolean) =>
			fetch(`http://127.0.0.1:${harness.port}/api/notify/settings`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ awayMode }),
			})
		expect((await put(true)).status).toBe(200)
		expect((await put(false)).status).toBe(200)
		expect(readNotifySettings(harness.stateDir)).toEqual({ awayMode: false })

		harness.notifyService.dispatchEvent(deferrableAsking('held-3'))
		expect(harness.sendPush).not.toHaveBeenCalled()
		await harness.notifyService.awaitInFlight(1000)
		expect(harness.sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(harness.sendPush.mock.calls[0]?.[1]))).toMatchObject({
			id: 'held-3',
		})
	})
})
