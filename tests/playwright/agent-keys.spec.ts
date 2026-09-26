/** Real drawer taps for the default agent shortcuts and their PTY bytes. */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
		.toBe(true)
})

async function openDrawer(page: Page): Promise<void> {
	const drawer = page.locator('#wt-drawer')
	await page.locator('#wt-toolbar button', { hasText: '☰' }).tap()
	await expect(drawer).toHaveClass(/open/)
	// class=open starts the 0.25s translateY slide; measuring before it
	// settles puts Codex Reply below the viewport (CI: y-bottom 842 > 727).
	await expect
		.poll(() =>
			drawer.evaluate((element) => {
				const transform = getComputedStyle(element).transform
				if (transform === 'none') return 0
				return Math.round(Math.abs(new DOMMatrixReadOnly(transform).f))
			}),
		)
		.toBe(0)
}

async function startByteEcho(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.term?.input(
			"printf 'byte-ready\\n'; stty -echo -icrnl; while IFS= read -rsn1 -d '' c || [ -n \"$c\" ]; do printf '%02x\\n' \"'$c\"; done\r",
			true,
		)
	})
	await expect(page.locator('body')).toContainText('byte-ready')
}

async function screenText(page: Page): Promise<string> {
	return (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
}

test('shows agent sections and lists their Guide descriptions', async ({ page }) => {
	await openDrawer(page)
	await expect(page.locator('#wt-drawer-grid .wt-drawer-section')).toHaveText([
		'Agent',
		'herdr',
		'Terminal',
		'App',
	])

	await page.locator('#wt-drawer-grid button', { hasText: 'Guide' }).tap()
	const help = page.locator('#wt-help')
	await expect(help).toBeVisible()
	for (const description of [
		'Codex: answer pending question (Alt+↑)',
		'Open slash commands',
		'Codex: invoke a skill',
	]) {
		await expect(help).toContainText(description)
	}
})

test('keeps Codex Reply visible and scrolls to the last App button', async ({ page }) => {
	await openDrawer(page)

	const grid = page.locator('#wt-drawer-grid')
	const reply = page.getByRole('button', { name: 'Reply', exact: true })
	const replyBounds = await reply.boundingBox()
	const viewport = page.viewportSize()
	if (!replyBounds || !viewport) throw new Error('Reply button or viewport is unavailable')
	expect(replyBounds.x).toBeGreaterThanOrEqual(0)
	expect(replyBounds.y).toBeGreaterThanOrEqual(0)
	expect(replyBounds.x + replyBounds.width).toBeLessThanOrEqual(viewport.width)
	expect(replyBounds.y + replyBounds.height).toBeLessThanOrEqual(viewport.height)
	expect(await grid.evaluate((element) => element.scrollTop)).toBe(0)

	const lastAppButton = grid.getByRole('button', { name: 'Select', exact: true })
	await lastAppButton.scrollIntoViewIfNeeded()
	expect(await grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await lastAppButton.tap()
	await expect(page.locator('#wt-selection-mode')).toBeVisible()
})

test('drawer taps send Agent bytes to the PTY', async ({ page }) => {
	await startByteEcho(page)

	await openDrawer(page)
	await page.getByRole('button', { name: 'Reply', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('1b5b313b3341')

	await openDrawer(page)
	await page.getByRole('button', { name: '/', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('2f')

	await openDrawer(page)
	await page.getByRole('button', { name: '$', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('24')
})
