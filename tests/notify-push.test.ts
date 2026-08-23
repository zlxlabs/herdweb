import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseNotifyEvent } from '../src/notify/events'
import { STALE_SUBSCRIPTION_MS, readSubscriptions, writeSubscriptions } from '../src/notify/push'
import * as pushModule from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'
import {
	handleNotificationClick,
	handlePushSubscriptionChange,
	resolveScopeUrl,
	showPushNotification,
} from '../src/sw-entry'

describe('notify push delivery', () => {
	let stateDir: string

	afterEach(() => {
		rmSync(stateDir, { recursive: true, force: true })
		vi.useRealTimers()
	})

	test('updates lastSuccessAt on successful delivery', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		const now = 1_700_000_000_000
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
			now: () => now,
		})
		const event = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'p1', kind: 'done', title: 'T', ts: 1 }),
		)
		notifyService.dispatchEvent(event)
		await notifyService.awaitInFlight(1000)
		const subs = readSubscriptions(stateDir)
		expect(subs[0]?.lastSuccessAt).toBe(now)
		notifyService.dispose()
	})

	test('removes subscription on 410', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/gone',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: Date.now(),
			},
		])
		const sendPush = vi
			.fn()
			.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'p2', kind: 'done', title: 'T', ts: 1 })),
		)
		await notifyService.awaitInFlight(1000)
		expect(readSubscriptions(stateDir)).toHaveLength(0)
		notifyService.dispose()
	})

	test('keeps subscription on 5xx and isolates other endpoints', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/fail',
				keys: { p256dh: 'k1', auth: 'a1' },
				lastSuccessAt: 1,
			},
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k2', auth: 'a2' },
				lastSuccessAt: 1,
			},
		])
		const sendPush = vi.fn(async (sub: { endpoint: string }) => {
			if (sub.endpoint.endsWith('/fail')) {
				throw Object.assign(new Error('server'), { statusCode: 503 })
			}
			return { statusCode: 201, body: '', headers: {} }
		})
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
			now: () => 2,
		})
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'p3', kind: 'done', title: 'T', ts: 1 })),
		)
		await notifyService.awaitInFlight(1000)
		const subs = readSubscriptions(stateDir)
		expect(subs).toHaveLength(2)
		expect(subs.find((sub) => sub.endpoint.endsWith('/ok'))?.lastSuccessAt).toBe(2)
		notifyService.dispose()
	})

	test('prunes subscriptions older than 90 days on scan', () => {
		vi.useFakeTimers()
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		const now = 2_000_000_000_000
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/stale',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: now - STALE_SUBSCRIPTION_MS - 1,
			},
		])
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, now: () => now })
		vi.advanceTimersByTime(24 * 60 * 60 * 1000)
		expect(readSubscriptions(stateDir)).toHaveLength(0)
		notifyService.dispose()
	})

	test('dispatchEvent does not emit unhandledRejection when push write fails', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const writeSpy = vi.spyOn(pushModule, 'writeSubscriptions').mockImplementation(() => {
			throw new Error('disk full')
		})
		let unhandled = false
		const onUnhandled = () => {
			unhandled = true
		}
		process.on('unhandledRejection', onUnhandled)
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		const event = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'p-reject', kind: 'done', title: 'T', ts: 1 }),
		)
		notifyService.dispatchEvent(event)
		await notifyService.awaitInFlight(1000)
		process.off('unhandledRejection', onUnhandled)
		writeSpy.mockRestore()
		expect(unhandled).toBe(false)
		notifyService.dispose()
	})

	test('skips stale prune while push delivery is in flight', () => {
		vi.useFakeTimers()
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		const now = 2_000_000_000_000
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/stale',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: now - STALE_SUBSCRIPTION_MS - 1,
			},
		])
		const sendPush = vi.fn().mockImplementation(() => new Promise<void>(() => {}))
		const writeSpy = vi.spyOn(pushModule, 'writeSubscriptions')
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
			now: () => now,
		})
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'p4', kind: 'done', title: 'T', ts: 1 })),
		)
		writeSpy.mockClear()
		vi.advanceTimersByTime(24 * 60 * 60 * 1000)
		expect(writeSpy).not.toHaveBeenCalled()
		writeSpy.mockRestore()
		notifyService.dispose()
	})
})

describe('service worker helpers', () => {
	test('resolveScopeUrl joins paths under scope', () => {
		expect(resolveScopeUrl('http://localhost/herdweb/', '/api/push/vapid-key')).toBe(
			'http://localhost/herdweb/api/push/vapid-key',
		)
	})

	test('handleNotificationClick focuses existing client', async () => {
		const focus = vi.fn()
		const clients = {
			matchAll: vi.fn().mockResolvedValue([{ focus }]),
			openWindow: vi.fn(),
		}
		await handleNotificationClick(
			clients as Parameters<typeof handleNotificationClick>[0],
			'http://localhost/',
		)
		expect(focus).toHaveBeenCalled()
		expect(clients.openWindow).not.toHaveBeenCalled()
	})

	test('handleNotificationClick opens scope when no window', async () => {
		const openWindow = vi.fn()
		const clients = {
			matchAll: vi.fn().mockResolvedValue([]),
			openWindow,
		}
		await handleNotificationClick(
			clients as Parameters<typeof handleNotificationClick>[0],
			'http://localhost/app/',
		)
		expect(openWindow).toHaveBeenCalledWith('http://localhost/app/')
	})

	test('showPushNotification uses kind:session tag', async () => {
		const showNotification = vi.fn().mockResolvedValue(undefined)
		const registration = { showNotification } as unknown as ServiceWorkerRegistration
		await showPushNotification(registration, {
			v: 1,
			id: '1',
			kind: 'asking',
			session: 'dev',
			title: 'Hi',
			ts: 1,
		})
		expect(showNotification).toHaveBeenCalledWith(
			'Hi',
			expect.objectContaining({ tag: 'asking:dev' }),
		)
	})

	test('handlePushSubscriptionChange rotates server subscription', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ publicKey: 'cHVibGljLWtleQ' }),
			})
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true })
		const subscription = {
			endpoint: 'https://push.example/new',
			getKey: () => new Uint8Array([1, 2, 3]).buffer,
		}
		const registration = {
			pushManager: {
				getSubscription: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/old' }),
				subscribe: vi.fn().mockResolvedValue(subscription),
			},
		} as unknown as ServiceWorkerRegistration
		await handlePushSubscriptionChange(registration, 'http://localhost/', fetchFn)
		expect(fetchFn.mock.calls[0]?.[0]).toContain('vapid-key')
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost/api/push/subscription',
			expect.objectContaining({ method: 'DELETE' }),
		)
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost/api/push/subscribe',
			expect.objectContaining({ method: 'POST' }),
		)
	})

	test('handlePushSubscriptionChange rolls back when subscribe POST fails', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true)
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ publicKey: 'cHVibGljLWtleQ' }),
			})
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: false, status: 500 })
		const subscription = {
			endpoint: 'https://push.example/new',
			unsubscribe,
			getKey: () => new Uint8Array([1, 2, 3]).buffer,
		}
		const registration = {
			pushManager: {
				getSubscription: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/old' }),
				subscribe: vi.fn().mockResolvedValue(subscription),
			},
		} as unknown as ServiceWorkerRegistration
		await expect(
			handlePushSubscriptionChange(registration, 'http://localhost/', fetchFn),
		).rejects.toThrow('subscribe failed: 500')
		expect(unsubscribe).toHaveBeenCalled()
	})
})
