import { expect, test } from './fixtures'

// UI walkthrough evidence pipeline (herdweb-visual.yml). Each case boots its
// own isolated serve via tests/playwright/fixtures.ts (fresh process + fresh
// port, temp HOME), drives the real mobile terminal main path, and produces
// video/trace/screenshot + a self-contained HTML report through
// playwright.visual.config.ts. This spec is excluded from the shared blocking
// suite (playwright.config.ts testIgnore); media is evidence, never a
// replacement for assertions. No artificial sleeps.
test.describe('herdweb ui walkthrough', () => {
	test('mobile terminal page opens on the isolated target', async ({ page }) => {
		await page.goto('/')
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect(page.locator('#terminal .xterm')).toBeVisible()

		// The client must be attached to THIS case's temporary serve target.
		await expect
			.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
			.toBe(true)
		expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
	})

	test('basic controls interact: keyboard input and drawer', async ({ page }) => {
		await page.goto('/')
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })

		// Keyboard input round-trips through the PTY.
		await page.locator('#terminal').click()
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.className || ''))
			.toBe('xterm-helper-textarea')
		await page.keyboard.type('printf "visual-walkthrough\\n"')
		await page.keyboard.press('Enter')
		await expect(page.locator('body')).toContainText('visual-walkthrough')

		// Toolbar control opens the drawer (touchend models iOS Safari not
		// firing click on dynamic elements).
		await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
		const moreBtn = page.locator('#wt-toolbar button', { hasText: '☰' })
		await expect(moreBtn).toBeVisible()
		await moreBtn.dispatchEvent('touchend', {
			touches: [],
			changedTouches: [],
			targetTouches: [],
		})
		await expect(page.locator('#wt-drawer-grid button').first()).toBeVisible()
	})
})
