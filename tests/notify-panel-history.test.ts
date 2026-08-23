import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createNotifyPanel } from '../src/controls/notify-panel'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

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

test('open fetches history and renders empty state', async () => {
	stubServiceWorker()
	const fetchMock = vi.fn(async (url: string) => {
		if (url.endsWith('/api/events/history')) {
			return { ok: true, json: async () => ({ events: [] }) }
		}
		return { ok: false, status: 500 }
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 20))

	expect(fetchMock).toHaveBeenCalledWith('/api/events/history')
	const empty = panel.element.querySelector('.wt-notify-history-empty')
	expect(empty?.textContent).toBe('暂无事件')
})

test('open renders history items with kind badge and body', async () => {
	stubServiceWorker()
	const now = 1_700_000_000_000
	const fetchMock = vi.fn(async (url: string) => {
		if (url.endsWith('/api/events/history')) {
			return {
				ok: true,
				json: async () => ({
					events: [
						{
							v: 1,
							id: 'evt-1',
							kind: 'asking',
							title: 'Need input',
							body: 'Details here',
							ts: now - 3 * 60 * 1000,
						},
					],
				}),
			}
		}
		return { ok: false, status: 500 }
	})

	const panel = createNotifyPanel({
		basePath: '/',
		fetchFn: fetchMock as unknown as typeof fetch,
		now: () => now,
	})
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 20))

	const item = panel.element.querySelector('.wt-notify-history-item')
	expect(item).not.toBeNull()
	expect(panel.element.querySelector('.wt-notify-kind-asking')?.textContent).toBe('等待输入')
	expect(panel.element.querySelector('.wt-notify-history-title')?.textContent).toBe('Need input')
	expect(panel.element.querySelector('.wt-notify-history-body')?.textContent).toBe('Details here')
	expect(panel.element.querySelector('.wt-notify-history-time')?.textContent).toBe('3 分钟前')
})

test('fetch failure shows error row without breaking panel controls', async () => {
	stubServiceWorker()
	const fetchMock = vi.fn(async (url: string) => {
		if (url.endsWith('/api/events/history')) {
			return { ok: false, status: 503 }
		}
		return { ok: true, json: async () => ({ events: [] }) }
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 20))

	expect(panel.element.querySelector('.wt-notify-history-error')?.textContent).toBe(
		'加载失败 (503)',
	)
	expect(panel.element.querySelector('.wt-notify-toggle')).not.toBeNull()
	expect(panel.element.querySelector('.wt-notify-test')).not.toBeNull()
})

test('refresh button re-fetches history', async () => {
	stubServiceWorker()
	let callCount = 0
	const fetchMock = vi.fn(async (url: string) => {
		if (url.endsWith('/api/events/history')) {
			callCount += 1
			return {
				ok: true,
				json: async () => ({
					events:
						callCount === 1 ? [] : [{ v: 1, id: 'evt-2', kind: 'done', title: 'Finished', ts: 1 }],
				}),
			}
		}
		return { ok: false, status: 500 }
	})

	const panel = createNotifyPanel({ basePath: '/', fetchFn: fetchMock as unknown as typeof fetch })
	document.body.appendChild(panel.element)
	panel.open()
	await new Promise((resolve) => setTimeout(resolve, 20))
	expect(panel.element.querySelector('.wt-notify-history-empty')?.textContent).toBe('暂无事件')

	const refreshBtn = panel.element.querySelector<HTMLButtonElement>('.wt-notify-history-refresh')
	if (!refreshBtn) throw new Error('missing refresh button')
	refreshBtn.click()
	await new Promise((resolve) => setTimeout(resolve, 20))

	expect(fetchMock).toHaveBeenCalledTimes(2)
	expect(panel.element.querySelector('.wt-notify-history-title')?.textContent).toBe('Finished')
})
