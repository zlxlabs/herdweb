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
	// settles puts Answer below the viewport (CI: y-bottom 842 > 727).
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

test('shows Answer and agent sections and lists their Guide descriptions', async ({ page }) => {
	await openDrawer(page)
	await expect(page.locator('#wt-drawer-grid .wt-drawer-section')).toHaveText([
		'Answer',
		'Codex',
		'Claude',
		'Pi',
		'herdr',
		'Terminal',
		'App',
	])

	await page.locator('#wt-drawer-grid button', { hasText: 'Guide' }).tap()
	const help = page.locator('#wt-help')
	await expect(help).toBeVisible()
	for (const description of [
		'Answer option 1',
		'Answer option 2',
		'Answer option 3',
		'Answer yes',
		'Answer no',
		'Codex: answer pending question (Alt+↑)',
		'Codex: queue message (Tab)',
		'Codex: less reasoning (Alt+,)',
		'Codex: more reasoning (Alt+.)',
		'Codex: open transcript (Ctrl+T)',
		'Claude Code: cycle mode (Shift+Tab)',
		'Claude Code: verbose output (Ctrl+O)',
		'Claude Code: toggle tasks (Ctrl+T)',
		'Claude Code: switch model (Alt+P)',
		'Pi: queue follow-up (Alt+Enter)',
		'Pi: cycle thinking level (Shift+Tab)',
		'Pi: cycle models (Ctrl+P)',
		'Pi: toggle tool output (Ctrl+O)',
	]) {
		await expect(help).toContainText(description)
	}
})

test('keeps Answer visible and scrolls to the last App button', async ({ page }) => {
	await openDrawer(page)

	const grid = page.locator('#wt-drawer-grid')
	const answerYes = page.getByRole('button', { name: 'y', exact: true })
	const answerBounds = await answerYes.boundingBox()
	const viewport = page.viewportSize()
	if (!answerBounds || !viewport) throw new Error('Answer button or viewport is unavailable')
	expect(answerBounds.x).toBeGreaterThanOrEqual(0)
	expect(answerBounds.y).toBeGreaterThanOrEqual(0)
	expect(answerBounds.x + answerBounds.width).toBeLessThanOrEqual(viewport.width)
	expect(answerBounds.y + answerBounds.height).toBeLessThanOrEqual(viewport.height)
	expect(await grid.evaluate((element) => element.scrollTop)).toBe(0)

	const lastAppButton = grid.getByRole('button', { name: 'Select', exact: true })
	await lastAppButton.scrollIntoViewIfNeeded()
	expect(await grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await lastAppButton.tap()
	await expect(page.locator('#wt-selection-mode')).toBeVisible()
})

test('drawer taps send Answer, Codex, and Claude bytes to the PTY', async ({ page }) => {
	await startByteEcho(page)

	await openDrawer(page)
	await page.getByRole('button', { name: 'y', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('79')

	await openDrawer(page)
	await page.getByRole('button', { name: 'Reply', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('1b5b313b3341')

	await openDrawer(page)
	await page
		.locator('#wt-drawer-grid button')
		.filter({ hasText: /^Queue$/ })
		.first()
		.tap()
	await expect.poll(() => screenText(page)).toContain('09')

	await openDrawer(page)
	await page.getByRole('button', { name: 'Mode', exact: true }).tap()
	await expect.poll(() => screenText(page)).toContain('1b5b5a')
})
