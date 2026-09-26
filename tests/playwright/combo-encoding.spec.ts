/** Combo-picker encodings on a real PTY. */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
		.toBe(true)
})

async function startByteEcho(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.term?.input(
			'stty -echo -icanon -isig -icrnl; python3 -u -c \'import os; print("byte-ready", flush=True); exec("while True:\\n b = os.read(0, 1)\\n print(\\"<byte:\\" + b.hex() + \\">\\", flush=True)")\'\r',
			true,
		)
	})
	await expect(page.locator('#terminal .xterm-rows')).toContainText('byte-ready')
}

async function receivedBytes(page: Page): Promise<string[]> {
	const text = (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
	return [...text.matchAll(/<byte:([0-9a-f]{2})>/g)].map((match) => match[1] ?? '')
}

async function openCombo(page: Page): Promise<void> {
	await page.locator('#wt-toolbar button', { hasText: '☰' }).tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)
	await page.locator('#wt-drawer-grid button', { hasText: 'Combo' }).tap()
	await expect(page.locator('#wt-combo-backdrop')).toBeVisible({ timeout: 3_000 })
}

async function sendCombo(page: Page, value: string): Promise<void> {
	await openCombo(page)
	const input = page.locator('#wt-combo-panel input')
	await expect(input).toBeFocused({ timeout: 1_000 })
	await input.fill(value)
	await input.press('Enter')
}

test('combo M-Up, F8, and C-Home write the probe-backed CSI bytes; S-Enter writes nothing', async ({
	page,
}) => {
	await startByteEcho(page)
	let start = (await receivedBytes(page)).length

	await sendCombo(page, 'M-Up')
	await expect
		.poll(async () => (await receivedBytes(page)).slice(start).join(''))
		.toBe('1b5b313b3341')
	start = (await receivedBytes(page)).length

	await sendCombo(page, 'F8')
	await expect
		.poll(async () => (await receivedBytes(page)).slice(start).join(''))
		.toBe('1b5b31397e')
	start = (await receivedBytes(page)).length

	await sendCombo(page, 'C-Home')
	await expect
		.poll(async () => (await receivedBytes(page)).slice(start).join(''))
		.toBe('1b5b313b3548')

	const beforeEnter = await receivedBytes(page)
	await sendCombo(page, 'S-Enter')
	await expect(page.locator('.wt-combo-error')).toContainText('hold ⏎ on the d-pad for a newline')
	await expect(page.locator('#wt-combo-backdrop')).toBeVisible()
	expect(await receivedBytes(page)).toEqual(beforeEnter)
})
