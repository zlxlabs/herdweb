/**
 * E2E tests for the prefix button: tap Prefix → sends prefix byte →
 * combo picker opens with contextual title/description.
 * The Prefix button lives in the drawer since the toolbar went single-row.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
})

/** Open the drawer and tap the Prefix button inside it */
async function tapDrawerPrefix(page: Page): Promise<void> {
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)
	const prefixBtn = page.locator('#wt-drawer-grid button', { hasText: 'Prefix' })
	await prefixBtn.tap()
}

test('prefix button tap opens combo picker with contextual title', async ({ page }) => {
	await tapDrawerPrefix(page)

	const backdrop = page.locator('#wt-combo-backdrop')
	await expect(backdrop).toBeVisible({ timeout: 3_000 })

	await expect(page.locator('#wt-combo-panel h3')).toContainText('Ctrl-B')
	await expect(page.locator('#wt-combo-panel p').first()).toContainText('C-x = Ctrl+x')
})

test('prefix combo picker submits follow-up key and closes', async ({ page }) => {
	await tapDrawerPrefix(page)

	const backdrop = page.locator('#wt-combo-backdrop')
	await expect(backdrop).toBeVisible({ timeout: 3_000 })

	const input = page.locator('#wt-combo-panel input')
	await expect(input).toBeFocused({ timeout: 1_000 })
	await input.fill('r')
	await input.press('Enter')

	await expect(backdrop).not.toBeVisible({ timeout: 3_000 })
})

test('prefix combo picker cancel restores default title', async ({ page }) => {
	// Open via prefix
	await tapDrawerPrefix(page)
	await expect(page.locator('#wt-combo-backdrop')).toBeVisible({ timeout: 3_000 })

	// Cancel
	const cancelBtn = page.locator('#wt-combo-panel button', { hasText: 'Cancel' })
	await cancelBtn.tap()
	await expect(page.locator('#wt-combo-backdrop')).not.toBeVisible()

	// Re-open via drawer Combo button — should have default title
	const toggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await toggle.tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)

	const comboBtn = page.locator('#wt-drawer-grid button', { hasText: 'Combo' })
	await comboBtn.tap()
	await expect(page.locator('#wt-combo-backdrop')).toBeVisible({ timeout: 3_000 })
	await expect(page.locator('#wt-combo-panel h3')).toHaveText('Send combo')
})
