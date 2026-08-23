import { expect, test } from './fixtures'

test('serves the herdweb terminal client', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await expect(page.locator('#terminal .xterm')).toBeVisible()
	await expect.poll(() => page.evaluate(() => Boolean(window.term))).toBe(true)
})

test('loads without console errors', async ({ page }) => {
	const consoleErrors: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'error') {
			// WebKit logs 'Viewport argument key "interactive-widget" not recognized and
			// ignored' for interactive-widget=resizes-content — expected noise, the key
			// targets Android Chrome and is safely ignored elsewhere.
			if (message.text().includes('interactive-widget')) return
			consoleErrors.push(message.text())
		}
	})

	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await page.waitForTimeout(500)

	expect(consoleErrors).toEqual([])
})

test('terminal accepts keyboard input after tapping the screen', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })

	await page.locator('#terminal').click()
	await expect
		.poll(() =>
			page.evaluate(() => ({
				tag: document.activeElement?.tagName,
				className: document.activeElement?.className || '',
			})),
		)
		.toEqual({
			tag: 'TEXTAREA',
			className: 'xterm-helper-textarea',
		})

	await page.keyboard.type('printf "keyboard-smoke\\n"')
	await page.keyboard.press('Enter')

	await expect(page.locator('body')).toContainText('keyboard-smoke')
})

test('no floating controls overlay the terminal content', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })

	// The old #-/+/? floating cluster is gone; controls live in the drawer
	await expect(page.locator('#wt-font-controls')).toHaveCount(0)
	// Scroll buttons are opt-in and off by default
	await expect(page.locator('#wt-scroll-buttons')).toHaveCount(0)
})

test('help overlay shows version', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })

	// Open help via touchend — simulates iOS Safari not firing click on dynamic elements
	const moreBtn = page.locator('#wt-toolbar button', { hasText: '☰' })
	await expect(moreBtn).toBeVisible()
	await moreBtn.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	const guideBtn = page.locator('#wt-drawer-grid button', { hasText: 'Guide' })
	await expect(guideBtn).toBeVisible()
	await guideBtn.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	const overlay = page.locator('#wt-help')
	await expect(overlay).toBeVisible()

	const versionEl = page.locator('#wt-help .wt-help-version')
	await expect(versionEl).toBeVisible()
	await expect(versionEl).toContainText(/herdweb v\d+\.\d+\.\d+/)
})

test('late client receives terminal snapshot', async ({ browser, page }) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })

	await page.evaluate(() => {
		window.term?.input('printf "snapshot-smoke\\n"\r', true)
	})

	await expect(page.locator('body')).toContainText('snapshot-smoke')

	const secondPage = await browser.newPage()
	await secondPage.goto('/')
	await secondPage.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await expect(secondPage.locator('body')).toContainText('snapshot-smoke')
})
