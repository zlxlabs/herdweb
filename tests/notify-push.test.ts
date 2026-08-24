import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseNotifyEvent } from '../src/notify/events'
import {
	DEFAULT_VAPID_SUBJECT,
	STALE_SUBSCRIPTION_MS,
	ensureVapidKeys,
	readSubscriptions,
	writeSubscriptions,
} from '../src/notify/push'
import * as pushModule from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'
import {
	NOTIFY_TARGET_MESSAGE_TYPE,
	handleNotificationClick,
	handlePushSubscriptionChange,
	resolveScopeUrl,
	showPushNotification,
} from '../src/sw-entry'

describe('ensureVapidKeys', () => {
	let stateDir: string

	afterEach(() => {
		rmSync(stateDir, { recursive: true, force: true })
	})

	test('generates default subject on fresh stateDir', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-vapid-'))
		const keys = ensureVapidKeys(stateDir)
		expect(keys.subject).toBe('mailto:admin@example.com')
		const disk = JSON.parse(readFileSync(join(stateDir, 'vapid.json'), 'utf-8'))
		expect(disk.subject).toBe('mailto:admin@example.com')
	})

	test('default subject matches deliverable mailto format', () => {
		expect(DEFAULT_VAPID_SUBJECT).toMatch(/^mailto:.+@.+\..+$/)
	})

	test('config subject overrides disk subject and syncs file', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-vapid-'))
		const diskPath = join(stateDir, 'vapid.json')
		const diskKeys = {
			publicKey: 'disk-pub',
			privateKey: 'disk-priv',
			subject: 'mailto:herdweb@localhost',
		}
		writeFileSync(diskPath, JSON.stringify(diskKeys), { mode: 0o600 })
		const keys = ensureVapidKeys(stateDir, { subject: 'mailto:ops@mydomain.com' })
		expect(keys.publicKey).toBe('disk-pub')
		expect(keys.privateKey).toBe('disk-priv')
		expect(keys.subject).toBe('mailto:ops@mydomain.com')
		const disk = JSON.parse(readFileSync(diskPath, 'utf-8'))
		expect(disk.subject).toBe('mailto:ops@mydomain.com')
		expect(disk.publicKey).toBe('disk-pub')
	})

	test('returns disk subject when no override', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-vapid-'))
		const diskPath = join(stateDir, 'vapid.json')
		const diskKeys = {
			publicKey: 'disk-pub',
			privateKey: 'disk-priv',
			subject: 'mailto:stored@mydomain.com',
		}
		writeFileSync(diskPath, JSON.stringify(diskKeys), { mode: 0o600 })
		const keys = ensureVapidKeys(stateDir)
		expect(keys.subject).toBe('mailto:stored@mydomain.com')
		expect(keys.publicKey).toBe('disk-pub')
	})

	test('subject-only override keeps disk keypair', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-vapid-'))
		const diskPath = join(stateDir, 'vapid.json')
		const diskKeys = {
			publicKey: 'keep-pub',
			privateKey: 'keep-priv',
			subject: 'mailto:herdweb@localhost',
		}
		writeFileSync(diskPath, JSON.stringify(diskKeys), { mode: 0o600 })
		const keys = ensureVapidKeys(stateDir, { subject: 'mailto:admin@example.com' })
		expect(keys.publicKey).toBe('keep-pub')
		expect(keys.privateKey).toBe('keep-priv')
		expect(keys.subject).toBe('mailto:admin@example.com')
	})
})

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
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'p2', kind: 'done', title: 'T', ts: 1 })),
		)
		await notifyService.awaitInFlight(1000)
		expect(readSubscriptions(stateDir)).toHaveLength(0)
		expect(
			logSpy.mock.calls.some(
				([message]) =>
					typeof message === 'string' &&
					message.includes('herdweb: notify subscription removed (stale )') &&
					message.includes('push.example'),
			),
		).toBe(true)
		logSpy.mockRestore()
		notifyService.dispose()
	})

	test('logs skipped when no subscriptions', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-push-'))
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'p-empty', kind: 'test', title: 'T', ts: 1 })),
		)
		await notifyService.awaitInFlight(1000)
		expect(
			logSpy.mock.calls.some(
				([message]) =>
					typeof message === 'string' &&
					message.includes('herdweb: notify push skipped — no subscriptions'),
			),
		).toBe(true)
		logSpy.mockRestore()
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

	test('handleNotificationClick and showPushNotification honor v1/v2 contracts', async () => {
		const v1 = { v: 1 as const, id: '1', kind: 'done' as const, title: 'T', ts: 1 }
		const v2 = { ...v1, v: 2 as const, targetId: 'workbox' }
		const focus = vi.fn()
		const postMessage = vi.fn()
		const clients = (matched: unknown[], openWindow = vi.fn()) =>
			({ matchAll: vi.fn().mockResolvedValue(matched), openWindow }) as Parameters<
				typeof handleNotificationClick
			>[0]
		await handleNotificationClick(
			clients([{ focus, postMessage }]),
			'http://localhost/herdweb/',
			v1,
		)
		expect(postMessage).not.toHaveBeenCalled()
		focus.mockClear()
		await handleNotificationClick(
			clients([{ focus, postMessage }]),
			'http://localhost/herdweb/',
			v2,
		)
		expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(
			focus.mock.invocationCallOrder[0] ?? 0,
		)
		expect(postMessage).toHaveBeenCalledWith({
			type: NOTIFY_TARGET_MESSAGE_TYPE,
			targetId: 'workbox',
		})
		const openWindow = vi.fn()
		await handleNotificationClick(clients([], openWindow), 'http://localhost/app/', v1)
		expect(openWindow).toHaveBeenCalledWith('http://localhost/app/')
		openWindow.mockClear()
		await handleNotificationClick(clients([], openWindow), 'http://localhost/herdweb/', {
			...v2,
			targetId: 'a/b',
		})
		expect(openWindow).toHaveBeenCalledWith('http://localhost/herdweb/?target=a%2Fb')
		const showNotification = vi.fn().mockResolvedValue(undefined)
		const registration = { showNotification } as unknown as ServiceWorkerRegistration
		const base = {
			v: 2 as const,
			id: '1',
			kind: 'asking' as const,
			session: 'dev',
			title: 'Hi',
			ts: 1,
		}
		await showPushNotification(registration, { ...base, targetId: 'a' })
		await showPushNotification(registration, { ...base, targetId: 'b' })
		expect(showNotification.mock.calls[0]?.[1]).toMatchObject({ tag: 'asking:a:dev' })
		expect(showNotification.mock.calls[1]?.[1]).toMatchObject({ tag: 'asking:b:dev' })
		await showPushNotification(registration, { ...base, v: 1, kind: 'asking', title: 'Hi' })
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
