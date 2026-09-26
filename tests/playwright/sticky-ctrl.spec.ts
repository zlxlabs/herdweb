import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const configDir = mkdtempSync(join(tmpdir(), 'herdweb-sticky-ctrl-'))
const configPath = join(configDir, 'herdweb.config.ts')
writeFileSync(
	configPath,
	`export default {
	toolbar: { row1: [
		{ id: 'test-ctrl', label: 'Ctrl', description: 'Sticky Ctrl', action: { type: 'ctrl-modifier' } },
		{ id: 'test-drawer', label: '☰', description: 'Open drawer', action: { type: 'drawer-toggle' } },
	] },
	floatingButtons: [{ position: 'top-left', buttons: [
		{ id: 'test-floating-ctrl', label: 'Ctrl', description: 'Sticky Ctrl', action: { type: 'ctrl-modifier' } },
	] }],
}`,
)
test.use({ serveOptions: { configPath } })
test.afterAll(() => rmSync(configDir, { recursive: true, force: true }))

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
			"stty -echo -icanon -isig -icrnl; python3 -u -c 'import os; print(\"byte-ready\", flush=True); exec(\"while True:\\n b = os.read(0, 1)\\n print(\\\"<byte:\\\" + b.hex() + \\\">\\\", flush=True)\")'\r",
			true,
		)
	})
	await expect(page.locator('#terminal .xterm-rows')).toContainText('byte-ready')
}

async function receivedBytes(page: Page): Promise<string[]> {
	const text = (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
	return [...text.matchAll(/<byte:([0-9a-f]{2})>/g)].map((match) => match[1] ?? '')
}

test('armed Ctrl sends the next soft-keyboard letter once as a control byte', async ({ page }) => {
	await startByteEcho(page)
	const ctrl = page.locator('#wt-toolbar button[data-herdweb-action="ctrl-modifier"]')
	await ctrl.tap()
	await expect.poll(() => ctrl.evaluate((button) => (button as HTMLElement).style.background)).not.toBe('')
	await page.locator('#terminal textarea').focus()
	await page.keyboard.type('c')

	await expect.poll(() => receivedBytes(page)).toEqual(['03'])
})

test('drawer Ctrl arms the shared state and stays indicated after the drawer closes', async ({
	page,
}) => {
	await startByteEcho(page)
	await page.locator('#wt-toolbar button[data-herdweb-action="drawer-toggle"]').tap()
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)
	await page.locator('#wt-drawer-grid').getByRole('button', { name: 'Ctrl', exact: true }).tap()
	await expect(page.locator('#wt-drawer')).not.toHaveClass(/open/)
	await expect(page.locator('#wt-ctrl-indicator')).toBeVisible()

	await page.locator('#terminal textarea').focus()
	await page.keyboard.type('c')

	await expect.poll(() => receivedBytes(page)).toEqual(['03'])
	await expect(page.locator('#wt-ctrl-indicator')).toBeHidden()
})

test('floating Ctrl uses the same sticky input path', async ({ page }) => {
	await startByteEcho(page)
	await page.locator('.wt-floating-group button', { hasText: 'Ctrl' }).tap()
	await expect(page.locator('#wt-ctrl-indicator')).toBeVisible()
	await page.locator('#terminal textarea').focus()
	await page.keyboard.type('c')

	await expect.poll(() => receivedBytes(page)).toEqual(['03'])
})

test('ordinary keyboard input sends one unchanged byte when Ctrl is not armed', async ({ page }) => {
	await startByteEcho(page)
	await page.locator('#terminal textarea').focus()
	await page.keyboard.type('c')

	await expect.poll(() => receivedBytes(page)).toEqual(['63'])
})
