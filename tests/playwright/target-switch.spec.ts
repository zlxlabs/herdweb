import { join } from 'node:path'
import { expect, test } from './fixtures'
import targetSingleConfig from './target-single.config'
import targetSwitchConfig from './target-switch.config'

// Imported so knip treats the config file as used (same pattern as session-exit).
void targetSwitchConfig
void targetSingleConfig
const explicitConfigPath = join(import.meta.dirname, 'target-switch.config.ts')
const explicitSingleConfigPath = join(import.meta.dirname, 'target-single.config.ts')

test.describe('explicit target picker (T5)', () => {
	test.use({ serveOptions: { configPath: explicitConfigPath, command: [] } })

	test('desktop browser shows badge and picker in explicit mode', async ({ browser, serve }) => {
		const desktopContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			isMobile: false,
			hasTouch: false,
		})
		try {
			const page = await desktopContext.newPage()
			await page.goto(serve.url)
			await expect
				.poll(() =>
					page.evaluate(() => !('ontouchstart' in window) && navigator.maxTouchPoints === 0),
				)
				.toBe(true)
			const badge = page.locator('button.wt-target-badge')
			await expect(badge).toBeVisible({ timeout: 15_000 })
			await expect(badge).toHaveText('One')
			await expect(page.locator('body')).toContainText('target-one-ready')

			await badge.click()
			const picker = page.locator('.wt-target-picker.open')
			await expect(picker).toBeVisible()
			await expect(picker.locator('[data-target-id="two"]')).toContainText('Not started')

			await picker.locator('[data-target-id="two"]').click()
			await expect(picker).toHaveCount(0)
			await expect(badge).toHaveText('Two', { timeout: 15_000 })
			await expect(page.locator('body')).toContainText('target-two-ready')
		} finally {
			await desktopContext.close()
		}
	})

	test('badge reflects the current target and the picker switches targets', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url)
		const badge = page.locator('button.wt-target-badge')
		await expect(badge).toBeVisible({ timeout: 15_000 })
		await expect(badge).toHaveText('One')
		await expect(page.locator('body')).toContainText('target-one-ready')

		await badge.click()
		const picker = page.locator('.wt-target-picker.open')
		await expect(picker).toBeVisible()
		await expect(picker.locator('[data-target-id="one"]')).toContainText('Running')
		await expect(picker.locator('[data-target-id="two"]')).toContainText('Not started')

		await picker.locator('[data-target-id="two"]').click()
		await expect(picker).toHaveCount(0)
		await expect(badge).toHaveText('Two', { timeout: 15_000 })
		await expect(page.locator('body')).toContainText('target-two-ready')

		// The commit persisted the choice: URL param + lastTargetId.
		await expect.poll(() => page.evaluate(() => window.location.href)).toContain('target=two')
		const lastTargetId = await page.evaluate(() => localStorage.getItem('herdweb:lastTargetId:/'))
		expect(lastTargetId).toBe('two')

		// Reload restores the persisted target instead of the default.
		await page.reload()
		await expect(page.locator('button.wt-target-badge')).toHaveText('Two', { timeout: 15_000 })
		await expect(page.locator('body')).toContainText('target-two-ready')
	})
})

test.describe('single mode (T5)', () => {
	test('single mode renders no target badge', async ({ page }) => {
		await page.goto('/')
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect.poll(() => page.evaluate(() => Boolean(window.term))).toBe(true)
		await expect(page.locator('button.wt-target-badge')).toHaveCount(0)
	})
})

test.describe('explicit single target (R1)', () => {
	test.use({ serveOptions: { configPath: explicitSingleConfigPath, command: [] } })

	test('does not render badge or picker for one explicit target', async ({ page, serve }) => {
		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect(page.locator('button.wt-target-badge')).toHaveCount(0)
		await expect(page.locator('.wt-target-picker')).toHaveCount(0)
	})
})
