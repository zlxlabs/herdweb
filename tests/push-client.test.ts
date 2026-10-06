import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { reconcilePushSubscription } from '../src/notify/push-client'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

function bytes(...values: number[]): ArrayBuffer {
	return new Uint8Array(values).buffer
}

function pushSubscription(
	endpoint: string,
	applicationServerKey: ArrayBuffer | null,
): PushSubscription {
	return {
		endpoint,
		options: { applicationServerKey },
		getKey: (name: PushEncryptionKeyName) => (name === 'p256dh' ? bytes(4, 5) : bytes(6, 7)),
		unsubscribe: vi.fn().mockResolvedValue(true),
	} as unknown as PushSubscription
}

function installNotification(permission: NotificationPermission): void {
	Object.defineProperty(globalThis, 'Notification', {
		value: { permission, requestPermission: vi.fn() },
		configurable: true,
	})
}

function installRegistration(registration: ServiceWorkerRegistration): void {
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { getRegistration: vi.fn().mockResolvedValue(registration) },
		configurable: true,
	})
}

function makeRegistration(subscription: PushSubscription | null): {
	registration: ServiceWorkerRegistration
	getSubscription: ReturnType<typeof vi.fn>
	subscribe: ReturnType<typeof vi.fn>
} {
	const getSubscription = vi.fn().mockResolvedValue(subscription)
	const subscribe = vi.fn()
	const registration = {
		pushManager: { getSubscription, subscribe },
	} as unknown as ServiceWorkerRegistration
	return { registration, getSubscription, subscribe }
}

function okResponse(body: unknown = {}): Response {
	return { ok: true, status: 200, json: async () => body } as Response
}

test('does nothing when notification permission is not granted', async () => {
	installNotification('default')
	const oldSubscription = pushSubscription('https://push.example/device', bytes(1, 2, 3))
	const { registration, getSubscription, subscribe } = makeRegistration(oldSubscription)
	installRegistration(registration)
	const fetchFn = vi.fn()

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(fetchFn).not.toHaveBeenCalled()
	expect(getSubscription).not.toHaveBeenCalled()
	expect(subscribe).not.toHaveBeenCalled()
})

test('does not fetch or create a subscription when authorized but unsubscribed', async () => {
	installNotification('granted')
	const { registration, getSubscription, subscribe } = makeRegistration(null)
	installRegistration(registration)
	const fetchFn = vi.fn()

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(getSubscription).toHaveBeenCalledOnce()
	expect(fetchFn).not.toHaveBeenCalled()
	expect(subscribe).not.toHaveBeenCalled()
})

test('reposts an existing subscription when its application server key matches', async () => {
	installNotification('granted')
	const existing = pushSubscription('https://push.example/existing', bytes(1, 2, 3))
	const { registration, subscribe } = makeRegistration(existing)
	installRegistration(registration)
	const fetchFn = vi.fn().mockResolvedValue(okResponse({ publicKey: 'AQID' }))

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(subscribe).not.toHaveBeenCalled()
	expect(fetchFn).toHaveBeenCalledTimes(2)
	expect(fetchFn.mock.calls[0]?.[0]).toBe('/app/api/push/vapid-key')
	const postCall = fetchFn.mock.calls[1]
	expect(postCall?.[0]).toBe('/app/api/push/subscribe')
	expect(postCall?.[1]).toMatchObject({
		method: 'POST',
		body: JSON.stringify({
			endpoint: 'https://push.example/existing',
			keys: { p256dh: 'BAU', auth: 'Bgc' },
		}),
	})
})

test('treats an unknown stored application server key as matching', async () => {
	installNotification('granted')
	const existing = pushSubscription('https://push.example/unknown-key', null)
	const { registration, subscribe } = makeRegistration(existing)
	installRegistration(registration)
	const fetchFn = vi.fn().mockResolvedValue(okResponse({ publicKey: 'AQID' }))

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(subscribe).not.toHaveBeenCalled()
	expect(fetchFn.mock.calls[1]?.[0]).toBe('/app/api/push/subscribe')
	expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toMatchObject({
		endpoint: 'https://push.example/unknown-key',
	})
})

test('rotates a mismatched key in unsubscribe, subscribe, DELETE, POST order', async () => {
	installNotification('granted')
	const order: string[] = []
	const oldSubscription = pushSubscription('https://push.example/old', bytes(9, 9))
	const newSubscription = pushSubscription('https://push.example/new', bytes(1, 2, 3))
	const unsubscribe = vi.fn(async () => {
		order.push('unsubscribe')
		return true
	})
	Object.defineProperty(oldSubscription, 'unsubscribe', { value: unsubscribe })
	let subscribeOptions: PushSubscriptionOptionsInit | undefined
	const subscribe = vi.fn(async (options: PushSubscriptionOptionsInit) => {
		order.push('subscribe')
		subscribeOptions = options
		return newSubscription
	})
	const getSubscription = vi.fn().mockResolvedValue(oldSubscription)
	const registration = {
		pushManager: { getSubscription, subscribe },
	} as unknown as ServiceWorkerRegistration
	installRegistration(registration)
	const requests: { url: string; init?: RequestInit }[] = []
	const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input)
		requests.push({ url, init })
		if (url.endsWith('/api/push/vapid-key')) {
			order.push('vapid-key')
			return okResponse({ publicKey: 'AQID' })
		}
		if (init?.method === 'DELETE') {
			order.push('DELETE')
			return okResponse()
		}
		order.push('POST')
		return okResponse()
	})

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(order).toEqual(['vapid-key', 'unsubscribe', 'subscribe', 'DELETE', 'POST'])
	expect(unsubscribe).toHaveBeenCalledOnce()
	expect(subscribeOptions?.userVisibleOnly).toBe(true)
	expect(Array.from(new Uint8Array(subscribeOptions?.applicationServerKey as ArrayBuffer))).toEqual(
		[1, 2, 3],
	)
	expect(requests[1]?.url).toBe('/app/api/push/subscription')
	expect(requests[1]?.init?.method).toBe('DELETE')
	expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
		endpoint: 'https://push.example/old',
	})
	expect(requests[2]?.url).toBe('/app/api/push/subscribe')
	expect(requests[2]?.init?.method).toBe('POST')
	expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
		endpoint: 'https://push.example/new',
		keys: { p256dh: 'BAU', auth: 'Bgc' },
	})
})

test('logs reconciliation failures without retrying or surfacing UI', async () => {
	installNotification('granted')
	const existing = pushSubscription('https://push.example/device', bytes(1, 2, 3))
	const { registration } = makeRegistration(existing)
	installRegistration(registration)
	const error = new Error('network down')
	const fetchFn = vi.fn().mockRejectedValue(error)
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

	await reconcilePushSubscription('/app', fetchFn as unknown as typeof fetch)

	expect(fetchFn).toHaveBeenCalledOnce()
	expect(errorSpy).toHaveBeenCalledExactlyOnceWith('herdweb: push reconcile failed', error)
})
