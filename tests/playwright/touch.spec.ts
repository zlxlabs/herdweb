/**
 * Touch-only interaction tests that reproduce GitHub issue #19:
 * buttons don't respond to taps on iPhone Safari.
 *
 * iOS Safari can fail to synthesise `click` after touch events on
 * dynamically created elements. We simulate this by dispatching only
 * touchend (via dispatchEvent) — no click follows. Buttons with only
 * click listeners will fail; buttons with touchend listeners will work.
 *
 * Playwright's tap() always dispatches touch + click, so it can't
 * reproduce the bug. dispatchEvent('touchend') is the key.
 */
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
})

test('drawer toggle responds to touchend-only (no click)', async ({ page }) => {
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await expect(toggle).toBeVisible()

	// Dispatch only touchend — simulates iOS Safari not firing click
	await toggle.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	const drawer = page.locator('#wt-drawer')
	await expect(drawer).toHaveClass(/open/)
})

test('drawer input button responds to touchstart + touchend', async ({ page }) => {
	// Open drawer via tap() (known working method) to set up state
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)

	// Drawer input buttons go through onAttachmentTap, which only honours a
	// touchend whose touchstart was captured on the same identifier — residual
	// touchend-only sequences stay rejected. tap() dispatches a real touch pair
	// (non-empty changedTouches, one identifier); the synthesised click after
	// it must not double-fire through the module-level touch guard.
	const drawerButton = page.locator('#wt-drawer-grid button').first()
	await expect(drawerButton).toBeVisible()
	await drawerButton.tap()

	await expect(page.locator('#wt-drawer')).not.toHaveClass(/open/)
})

test('backdrop responds to touchend-only', async ({ page }) => {
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)

	const backdrop = page.locator('#wt-backdrop')
	await backdrop.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	await expect(page.locator('#wt-drawer')).not.toHaveClass(/open/)
})

test('drawer open → close → re-open cycle', async ({ page }) => {
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	const drawer = page.locator('#wt-drawer')

	// Open
	await toggle.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(drawer).toHaveClass(/open/)

	// Close via backdrop
	await page.locator('#wt-backdrop').dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(drawer).not.toHaveClass(/open/)

	// Re-open via tap — synthesised click must not re-close
	await toggle.tap()
	await expect(drawer).toHaveClass(/open/)
})

test('synthesised click from tap() hits backdrop (regression guard)', async ({ page }) => {
	// Proves the mechanism that caused the open-then-close bug still exists:
	// after touchend opens the drawer, synthesised mousedown/click land on the
	// backdrop. The module-level touch guard in tap.ts suppresses the onTap
	// click handler, so the drawer stays open despite the click reaching it.
	await page.evaluate(() => {
		const w = window as unknown as { __backdropClicks: { isTrusted: boolean }[] }
		w.__backdropClicks = []
		document.addEventListener(
			'click',
			(e) => {
				if ((e.target as HTMLElement)?.id === 'wt-backdrop') {
					w.__backdropClicks.push({ isTrusted: e.isTrusted })
				}
			},
			{ capture: true },
		)
	})

	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.tap()
	await page.waitForTimeout(200)

	const clicks = await page.evaluate(
		() => (window as unknown as { __backdropClicks: { isTrusted: boolean }[] }).__backdropClicks,
	)
	// Synthesised click should have reached the backdrop
	expect(clicks.length).toBeGreaterThan(0)
	expect(clicks[0]?.isTrusted).toBe(true)

	// But the drawer should still be open (guard blocked the close)
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)
})

test('guide button responds to touchend-only', async ({ page }) => {
	// Open the drawer via touchend (no click follows on affected iOS Safari)
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)

	const guideBtn = page.locator('#wt-drawer-grid button', { hasText: 'Guide' })
	await expect(guideBtn).toBeVisible()
	await guideBtn.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	const overlay = page.locator('#wt-help')
	await expect(overlay).toBeVisible()
})

test('scroll buttons are not rendered by default', async ({ page }) => {
	await expect(page.locator('#wt-scroll-buttons')).toHaveCount(0)
})
