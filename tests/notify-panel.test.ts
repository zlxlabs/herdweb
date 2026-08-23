import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createNotifyPanel } from '../src/controls/notify-panel'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

test('toggle off sends DELETE for the active subscription', async () => {
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
		if (url.endsWith('/api/push/subscribe')) {
			return { ok: true }
		}
		if (url.endsWith('/api/push/subscription') && init?.method === 'DELETE') {
			return { ok: true, status: 204 }
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

	currentSub = {
		endpoint: 'https://push.example/device',
		unsubscribe,
		getKey: () => new Uint8Array([1]).buffer,
	}
	toggle.checked = true
	toggle.click()
	await new Promise((resolve) => setTimeout(resolve, 20))

	expect(fetchMock).toHaveBeenCalledWith(
		'/api/push/subscription',
		expect.objectContaining({
			method: 'DELETE',
			body: JSON.stringify({ endpoint: 'https://push.example/device' }),
		}),
	)
	expect(unsubscribe).toHaveBeenCalled()
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

	toggle.checked = false
	toggle.click()
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(unsubscribe).toHaveBeenCalled()
	expect(toggle.checked).toBe(false)
})

test('refreshToggle degrades when service worker ready never resolves', async () => {
	vi.useFakeTimers()
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { ready: new Promise<ServiceWorkerRegistration>(() => {}) },
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
