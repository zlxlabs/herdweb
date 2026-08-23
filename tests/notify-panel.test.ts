import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createNotifyPanel } from '../src/controls/notify-panel'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

function setupPushMocks(options: {
	currentSub: {
		endpoint: string
		unsubscribe: ReturnType<typeof vi.fn>
		getKey: (name: string) => ArrayBuffer
	} | null
	subscribe: ReturnType<typeof vi.fn>
}): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith('/api/push/vapid-key')) {
			return { ok: true, json: async () => ({ publicKey: 'cHVibGljLWtleQ' }) }
		}
		if (url.endsWith('/api/push/subscribe')) {
			return { ok: true }
		}
		if (url.endsWith('/api/push/subscription') && init?.method === 'DELETE') {
			return { ok: true, status: 204 }
		}
		return { ok: false, status: 500 }
	})

	Object.defineProperty(globalThis, 'Notification', {
		value: { requestPermission: vi.fn().mockResolvedValue('granted') },
		configurable: true,
	})
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve({
				pushManager: {
					getSubscription: vi.fn(() => Promise.resolve(options.currentSub)),
					subscribe: options.subscribe,
				},
			}),
		},
		configurable: true,
	})

	return fetchMock
}

test('change event with checked=true triggers subscribe', async () => {
	const unsubscribe = vi.fn().mockResolvedValue(true)
	let currentSub: {
		endpoint: string
		unsubscribe: ReturnType<typeof vi.fn>
		getKey: (name: string) => ArrayBuffer
	} | null = null

	const subscribe = vi.fn().mockImplementation(async () => {
		currentSub = {
			endpoint: 'https://push.example/device',
			unsubscribe,
			getKey: () => new Uint8Array([1]).buffer,
		}
		return currentSub
	})

	const fetchMock = setupPushMocks({ currentSub, subscribe })

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	toggle.checked = true
	toggle.dispatchEvent(new Event('change', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(Notification.requestPermission).toHaveBeenCalled()
	expect(subscribe).toHaveBeenCalled()
	expect(
		fetchMock.mock.calls.some(
			([url]) => typeof url === 'string' && url.endsWith('/api/push/vapid-key'),
		),
	).toBe(true)
	expect(fetchMock).toHaveBeenCalledWith(
		'/api/push/subscribe',
		expect.objectContaining({ method: 'POST' }),
	)
})

test('change event with checked=false triggers unsubscribe', async () => {
	const unsubscribe = vi.fn().mockResolvedValue(true)
	const currentSub = {
		endpoint: 'https://push.example/device',
		unsubscribe,
		getKey: () => new Uint8Array([1]).buffer,
	}

	const subscribe = vi.fn()
	const fetchMock = setupPushMocks({ currentSub, subscribe })

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	toggle.checked = false
	toggle.dispatchEvent(new Event('change', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(fetchMock).toHaveBeenCalledWith(
		'/api/push/subscription',
		expect.objectContaining({
			method: 'DELETE',
			body: JSON.stringify({ endpoint: 'https://push.example/device' }),
		}),
	)
	expect(unsubscribe).toHaveBeenCalled()
})

test('toggle click triggers change and subscribe branch', async () => {
	const unsubscribe = vi.fn().mockResolvedValue(true)
	let currentSub: {
		endpoint: string
		unsubscribe: ReturnType<typeof vi.fn>
		getKey: (name: string) => ArrayBuffer
	} | null = null

	const subscribe = vi.fn().mockImplementation(async () => {
		currentSub = {
			endpoint: 'https://push.example/device',
			unsubscribe,
			getKey: () => new Uint8Array([1]).buffer,
		}
		return currentSub
	})

	const fetchMock = setupPushMocks({ currentSub, subscribe })

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	toggle.checked = false
	toggle.click()
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(subscribe).toHaveBeenCalled()
	expect(fetchMock).toHaveBeenCalledWith(
		'/api/push/subscribe',
		expect.objectContaining({ method: 'POST' }),
	)
})

test('touchend alone does not trigger subscribe or unsubscribe', async () => {
	const unsubscribe = vi.fn().mockResolvedValue(true)
	const currentSub = {
		endpoint: 'https://push.example/device',
		unsubscribe,
		getKey: () => new Uint8Array([1]).buffer,
	}

	const subscribe = vi.fn()
	const fetchMock = setupPushMocks({ currentSub, subscribe })

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	// User taps to turn off while checked is still true (pre-flip on touch).
	toggle.checked = true
	toggle.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	const pushCalls = fetchMock.mock.calls.filter(
		([url]) =>
			typeof url === 'string' &&
			(url.endsWith('/api/push/vapid-key') ||
				url.endsWith('/api/push/subscribe') ||
				url.endsWith('/api/push/subscription')),
	)
	expect(pushCalls).toHaveLength(0)
	expect(Notification.requestPermission).not.toHaveBeenCalled()
	expect(subscribe).not.toHaveBeenCalled()
	expect(unsubscribe).not.toHaveBeenCalled()
})

test('subscribe rejects show failure status and reset toggle without POST subscribe', async () => {
	const subscribe = vi.fn().mockRejectedValue(new Error('Registration failed - permission denied'))
	const fetchMock = setupPushMocks({ currentSub: null, subscribe })

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	const status = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-status')
	if (!toggle || !status) throw new Error('missing panel elements')

	toggle.checked = true
	toggle.dispatchEvent(new Event('change', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(status.textContent).toContain('订阅失败')
	expect(toggle.checked).toBe(false)
	expect(
		fetchMock.mock.calls.some(
			([url, init]) =>
				typeof url === 'string' && url.endsWith('/api/push/subscribe') && init?.method === 'POST',
		),
	).toBe(false)
})

test('subscribe rolls back local subscription when POST rejects', async () => {
	const unsubscribe = vi.fn().mockResolvedValue(true)
	let currentSub: {
		endpoint: string
		unsubscribe: ReturnType<typeof vi.fn>
		getKey: (name: string) => ArrayBuffer
	} | null = null

	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith('/api/push/vapid-key')) {
			return { ok: true, json: async () => ({ publicKey: 'cHVibGljLWtleQ' }) }
		}
		if (url.endsWith('/api/push/subscribe') && init?.method === 'POST') {
			throw new Error('network down')
		}
		return { ok: false, status: 500 }
	})

	const subscribe = vi.fn().mockImplementation(async () => {
		currentSub = {
			endpoint: 'https://push.example/device',
			unsubscribe,
			getKey: () => new Uint8Array([1]).buffer,
		}
		return currentSub
	})

	Object.defineProperty(globalThis, 'Notification', {
		value: { requestPermission: vi.fn().mockResolvedValue('granted') },
		configurable: true,
	})
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve({
				pushManager: {
					getSubscription: vi.fn(() => Promise.resolve(currentSub)),
					subscribe,
				},
			}),
		},
		configurable: true,
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	toggle.checked = true
	toggle.dispatchEvent(new Event('change', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(unsubscribe).toHaveBeenCalled()
	expect(toggle.checked).toBe(false)
})

test('test button POSTs to /api/push/test', async () => {
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve({
				pushManager: {
					getSubscription: vi.fn(() => Promise.resolve(null)),
					subscribe: vi.fn(),
				},
			}),
		},
		configurable: true,
	})

	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith('/api/events/history')) {
			return { ok: true, json: async () => ({ events: [] }) }
		}
		if (url.endsWith('/api/push/test') && init?.method === 'POST') {
			return { ok: true, status: 202 }
		}
		return { ok: false, status: 500 }
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const testBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-test')
	if (!testBtn) throw new Error('missing test button')
	testBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(
		fetchMock.mock.calls.some(
			([url, init]) =>
				typeof url === 'string' && url.endsWith('/api/push/test') && init?.method === 'POST',
		),
	).toBe(true)
})

test('refreshToggle uses getRegistration when ready hangs (Edge 151)', async () => {
	vi.useFakeTimers()
	const registration = {
		active: {},
		pushManager: {
			getSubscription: vi.fn(() => Promise.resolve(null)),
			subscribe: vi.fn(),
		},
	}
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: new Promise<ServiceWorkerRegistration>(() => {}),
			getRegistration: vi.fn(() => Promise.resolve(registration)),
		},
		configurable: true,
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()
	await vi.runAllTimersAsync()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	const status = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-status')
	if (!toggle || !status) throw new Error('missing panel elements')

	expect(toggle.disabled).toBe(false)
	expect(status.textContent).not.toContain('unavailable')
	expect(status.textContent).not.toContain('timed out')
	vi.useRealTimers()
})

test('getRegistration polls until installing worker becomes active', async () => {
	vi.useFakeTimers()
	const registration: {
		active: ServiceWorker | null
		installing: ServiceWorker | null
		pushManager: { getSubscription: ReturnType<typeof vi.fn> }
	} = {
		active: null,
		installing: {} as ServiceWorker,
		pushManager: {
			getSubscription: vi.fn(() => Promise.resolve(null)),
		},
	}
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: new Promise<ServiceWorkerRegistration>(() => {}),
			getRegistration: vi.fn(() => Promise.resolve(registration)),
		},
		configurable: true,
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	await vi.advanceTimersByTimeAsync(250)
	registration.active = {} as ServiceWorker
	registration.installing = null
	await vi.runAllTimersAsync()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	if (!toggle) throw new Error('missing toggle')

	expect(toggle.disabled).toBe(false)
	vi.useRealTimers()
})

test('refreshToggle degrades when service worker ready never resolves', async () => {
	vi.useFakeTimers()
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: new Promise<ServiceWorkerRegistration>(() => {}),
			getRegistration: vi.fn(() => Promise.resolve(undefined)),
		},
		configurable: true,
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	const status = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-status')
	if (!toggle || !status) throw new Error('missing panel elements')

	await vi.advanceTimersByTimeAsync(5000)

	expect(toggle.disabled).toBe(true)
	expect(status.textContent).toContain('timed out')
	vi.useRealTimers()
})

const SW_STATUS_CASES: ReadonlyArray<{
	name: string
	setup: () => void
	advanceMs: number
	expected: string
}> = [
	{
		name: 'unsupported browser',
		setup: () => {
			Reflect.deleteProperty(navigator, 'serviceWorker')
		},
		advanceMs: 0,
		expected: 'Service Worker：此浏览器不支持',
	},
	{
		name: 'unregistered browser',
		setup: () => {
			Object.defineProperty(navigator, 'serviceWorker', {
				value: {
					ready: new Promise<never>(() => {}),
					getRegistration: vi.fn().mockResolvedValue(null),
				},
				configurable: true,
			})
		},
		advanceMs: 5000,
		expected: 'Service Worker：未注册',
	},
	{
		name: 'active registration',
		setup: () => {
			const registration = {
				active: {},
				pushManager: {
					getSubscription: vi.fn().mockResolvedValue(null),
				},
			}
			Object.defineProperty(navigator, 'serviceWorker', {
				value: {
					ready: Promise.resolve(registration),
					getRegistration: vi.fn().mockResolvedValue(registration),
				},
				configurable: true,
			})
		},
		advanceMs: 0,
		expected: 'Service Worker：已激活',
	},
	{
		name: 'installing registration',
		setup: () => {
			const registration = {
				active: null,
				installing: {},
				pushManager: {
					getSubscription: vi.fn().mockResolvedValue(null),
				},
			}
			Object.defineProperty(navigator, 'serviceWorker', {
				value: {
					ready: new Promise<never>(() => {}),
					getRegistration: vi.fn().mockResolvedValue(registration),
				},
				configurable: true,
			})
		},
		advanceMs: 2000,
		expected: 'Service Worker：注册中',
	},
]

for (const { name, setup, advanceMs, expected } of SW_STATUS_CASES) {
	test(`service worker status line renders ${name}`, async () => {
		vi.useFakeTimers()
		setup()
		const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
		document.body.appendChild(panel.element)
		panel.open()

		await vi.advanceTimersByTimeAsync(advanceMs)
		await vi.runAllTimersAsync()

		const swStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-sw-status')
		if (!swStatus) throw new Error('missing service worker status line')
		expect(swStatus.textContent).toBe(expected)
	})
}

test('service worker check button registers with base path and refreshes toggle', async () => {
	const registration = {
		active: {},
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(null),
		},
	}
	const register = vi.fn().mockResolvedValue(registration)
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve(registration),
			getRegistration: vi.fn().mockResolvedValue(registration),
			register,
		},
		configurable: true,
	})

	const panel = createNotifyPanel({
		basePath: '/agent',
		fetchFn: vi.fn() as unknown as typeof fetch,
	})
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 50))

	const toggle = panel.element.querySelector<HTMLInputElement>('.wt-notify-toggle')
	const swStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-sw-status')
	const swCheckBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-sw-check')
	if (!toggle || !swStatus || !swCheckBtn) throw new Error('missing service worker elements')

	swCheckBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(register).toHaveBeenCalledWith('/agent/sw.js', { scope: '/agent/' })
	expect(toggle.disabled).toBe(false)
	expect(swStatus.textContent).toBe('Service Worker：已激活')
})

test('service worker check button shows registration error', async () => {
	const registration = {
		active: {},
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(null),
		},
	}
	const error = new Error('boom-script-url')
	const register = vi.fn().mockRejectedValue(error)
	const getRegistration = vi.fn().mockResolvedValue(registration)
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve(registration),
			getRegistration,
			register,
		},
		configurable: true,
	})
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 50))

	const swStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-sw-status')
	const swCheckBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-sw-check')
	if (!swStatus || !swCheckBtn) throw new Error('missing service worker elements')

	swCheckBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(swStatus.textContent).toContain('Service Worker：注册失败')
	expect(swStatus.textContent).toContain('boom-script-url')
	expect(consoleError).toHaveBeenCalledWith('herdweb: service worker registration failed', error)
})

function stubNotification(
	value: { permission: string; requestPermission: ReturnType<typeof vi.fn> } | undefined,
): void {
	Object.defineProperty(globalThis, 'Notification', { value, configurable: true })
}

function stubServiceWorker(): void {
	Object.defineProperty(navigator, 'serviceWorker', {
		value: {
			ready: Promise.resolve({
				pushManager: {
					getSubscription: vi.fn(() => Promise.resolve(null)),
					subscribe: vi.fn(),
				},
			}),
		},
		configurable: true,
	})
}

const PERMISSION_CASES: ReadonlyArray<{ permission: string | undefined; expected: string }> = [
	{ permission: 'granted', expected: '通知权限：已允许' },
	{ permission: 'default', expected: '通知权限：未决定' },
	{ permission: 'denied', expected: '通知权限：已拒绝（需在浏览器站点设置中允许）' },
	{ permission: undefined, expected: '此浏览器不支持通知' },
]

for (const { permission, expected } of PERMISSION_CASES) {
	test(`permission line renders "${expected}"`, () => {
		stubNotification(
			permission === undefined
				? undefined
				: { permission, requestPermission: vi.fn().mockResolvedValue(permission) },
		)
		const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
		document.body.appendChild(panel.element)
		panel.open()

		const permStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-perm-status')
		if (!permStatus) throw new Error('missing permission status line')
		expect(permStatus.textContent).toBe(expected)
	})
}

test('permission line has text after open()', () => {
	stubNotification({ permission: 'default', requestPermission: vi.fn() })
	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const permStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-perm-status')
	if (!permStatus) throw new Error('missing permission status line')
	expect(permStatus.textContent?.length).toBeGreaterThan(0)
})

test('perm check button requests permission and updates the permission line', async () => {
	const notificationMock = {
		permission: 'default',
		requestPermission: vi.fn(async () => {
			notificationMock.permission = 'granted'
			return 'granted'
		}),
	}
	stubNotification(notificationMock)
	stubServiceWorker()

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const permStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-perm-status')
	const permCheckBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-perm-check')
	if (!permStatus || !permCheckBtn) throw new Error('missing permission elements')
	expect(permStatus.textContent).toBe('通知权限：未决定')

	permCheckBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(notificationMock.requestPermission).toHaveBeenCalled()
	expect(permStatus.textContent).toBe('通知权限：已允许')
})

test('denied permission shows site-settings guidance', async () => {
	stubNotification({
		permission: 'denied',
		requestPermission: vi.fn().mockResolvedValue('denied'),
	})
	stubServiceWorker()

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const status = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-status')
	const permCheckBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-perm-check')
	if (!status || !permCheckBtn) throw new Error('missing panel elements')

	permCheckBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(status.textContent).toContain('站点设置')
})

test('perm check button is a no-op when Notification is unsupported', async () => {
	stubNotification(undefined)
	stubServiceWorker()

	const panel = createNotifyPanel({ basePath: '/', fetchFn: vi.fn() as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()

	const permStatus = panel.element.querySelector<HTMLParagraphElement>('.wt-notify-perm-status')
	const permCheckBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-perm-check')
	if (!permStatus || !permCheckBtn) throw new Error('missing permission elements')

	permCheckBtn.dispatchEvent(new Event('touchend', { bubbles: true }))
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(permStatus.textContent).toBe('此浏览器不支持通知')
})
