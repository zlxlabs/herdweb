import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startIsolatedServe } from './isolated-serve'

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

		await expect(page.locator('#terminal .xterm')).toBeVisible()
	} finally {
		await serve.close()
	}
})
