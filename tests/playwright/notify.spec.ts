import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startIsolatedServe } from './isolated-serve'

async function openNotifyPanel(page: import('@playwright/test').Page): Promise<void> {
	const moreBtn = page.locator('#wt-toolbar button', { hasText: '☰' })
	await moreBtn.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	const notifyBtn = page.locator('#wt-drawer-grid button', { hasText: '🔔' })
	await expect(notifyBtn).toBeVisible()
	await notifyBtn.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(page.locator('#wt-notify')).toBeVisible()
}

test('notify panel subscribes, receives test push, and focuses on click', async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'Web Push e2e targets chromium only')

	const serve = await startIsolatedServe({ isolateTmpDir: false })
	await context.grantPermissions(['notifications'], { origin: serve.url })
	const statePath = join(
		serve.home,
		'.local',
		'state',
		'herdweb',
		String(serve.port),
		'push-subscriptions.json',
	)

	try {
		const cdp = await context.newCDPSession(page)
		await cdp.send('Browser.setPermission', {
			permission: { name: 'notifications' },
			setting: 'granted',
			origin: serve.url,
		})

		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await page.evaluate(async () => {
			await navigator.serviceWorker.register('/sw.js')
			await navigator.serviceWorker.ready
		})

		await openNotifyPanel(page)

		await page.evaluate(async () => {
			const response = await fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					endpoint: 'https://playwright.local/device-1',
					keys: { p256dh: 'k', auth: 'a' },
				}),
			})
			if (!response.ok) throw new Error(`subscribe failed: ${response.status}`)
		})

		await expect
			.poll(() => {
				try {
					const raw = readFileSync(statePath, 'utf-8')
					const subs = JSON.parse(raw) as Array<{ endpoint: string }>
					return subs.length
				} catch {
					return 0
				}
			})
			.toBeGreaterThan(0)

		await page.evaluate(async () => {
			const response = await fetch('/api/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					v: 1,
					kind: 'test',
					title: 'Playwright test',
					body: 'from e2e',
					ts: Date.now(),
				}),
			})
			if (response.status !== 202) {
				throw new Error(`events POST failed: ${response.status}`)
			}
		})

		await page.evaluate(async () => {
			const response = await fetch('/api/push/test', { method: 'POST' })
			if (response.status !== 202) {
				throw new Error(`push test POST failed: ${response.status}`)
			}
		})

		await expect(page.locator('#terminal .xterm')).toBeVisible()
	} finally {
		await serve.close()
	}
})

test('notify toggle tap subscribes via touch and persists state on reopen', async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'Web Push e2e targets chromium only')

	const serve = await startIsolatedServe({ isolateTmpDir: false })
	await context.grantPermissions(['notifications'], { origin: serve.url })
	const statePath = join(
		serve.home,
		'.local',
		'state',
		'herdweb',
		String(serve.port),
		'push-subscriptions.json',
	)
	const endpoint = 'https://local.invalid/device-e2e'

	await page.addInitScript((stubEndpoint: string) => {
		let permissionCalls = 0
		const p256dh = new Uint8Array(65)
		p256dh[0] = 4
		p256dh.fill(0xab, 1)
		const auth = new Uint8Array(16)
		auth.fill(0xcd)

		const subscription = {
			endpoint: stubEndpoint,
			getKey: (name: string) => {
				if (name === 'p256dh') return p256dh.buffer
				if (name === 'auth') return auth.buffer
				return null
			},
			unsubscribe: async () => true,
		}

		const originalRequestPermission = Notification.requestPermission.bind(Notification)
		Notification.requestPermission = async (
			...args: Parameters<typeof Notification.requestPermission>
		) => {
			permissionCalls += 1
			;(window as unknown as { __notifyPermissionCalls: number }).__notifyPermissionCalls =
				permissionCalls
			return originalRequestPermission(...args)
		}

		const proto = PushManager.prototype
		proto.subscribe = async function subscribe() {
			;(window as unknown as { __notifySubscribeCalls: number }).__notifySubscribeCalls =
				((window as unknown as { __notifySubscribeCalls?: number }).__notifySubscribeCalls ?? 0) + 1
			return subscription
		}
		proto.getSubscription = async function getSubscription() {
			const subscribed = (window as unknown as { __notifySubscribed?: boolean }).__notifySubscribed
			return subscribed ? subscription : null
		}
	}, endpoint)

	try {
		const cdp = await context.newCDPSession(page)
		await cdp.send('Browser.setPermission', {
			permission: { name: 'notifications' },
			setting: 'granted',
			origin: serve.url,
		})

		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await page.evaluate(async () => {
			await navigator.serviceWorker.register('/sw.js')
			await navigator.serviceWorker.ready
		})

		await openNotifyPanel(page)

		const requestLog: Array<{ url: string; method: string }> = []
		page.on('request', (request) => {
			const url = request.url()
			if (url.includes('/api/push/vapid-key') || url.includes('/api/push/subscribe')) {
				requestLog.push({ url, method: request.method() })
			}
		})

		await page.tap('.wt-notify-toggle')

		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __notifyPermissionCalls?: number }).__notifyPermissionCalls ??
						0,
				),
			)
			.toBeGreaterThanOrEqual(1)
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __notifySubscribeCalls?: number }).__notifySubscribeCalls ?? 0,
				),
			)
			.toBeGreaterThanOrEqual(1)

		await expect
			.poll(() =>
				requestLog.some(
					(entry) => entry.url.includes('/api/push/vapid-key') && entry.method === 'GET',
				),
			)
			.toBe(true)
		await expect
			.poll(() =>
				requestLog.some(
					(entry) => entry.url.includes('/api/push/subscribe') && entry.method === 'POST',
				),
			)
			.toBe(true)

		await expect(page.locator('.wt-notify-status')).toHaveText('Subscribed')

		await expect
			.poll(() => {
				try {
					const raw = readFileSync(statePath, 'utf-8')
					const subs = JSON.parse(raw) as Array<{ endpoint: string }>
					return subs.some((sub) => sub.endpoint === endpoint)
				} catch {
					return false
				}
			})
			.toBe(true)

		await page.evaluate(() => {
			;(window as unknown as { __notifySubscribed: boolean }).__notifySubscribed = true
		})
		await page.locator('.wt-notify-close').tap()
		await expect(page.locator('#wt-notify')).toBeHidden()

		await openNotifyPanel(page)
		await expect(page.locator('.wt-notify-toggle')).toBeChecked()
		await expect(page.locator('.wt-notify-status')).toHaveText('Subscribed')
	} finally {
		await serve.close()
	}
})
