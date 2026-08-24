import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import noReconnectConfig from './session-exit.config'

const noReconnectConfigPath = join(import.meta.dirname, 'session-exit.config.ts')
void noReconnectConfig
const reconnectConfigDir = mkdtempSync(join(tmpdir(), 'herdweb-session-exit-config-'))
const reconnectConfigPath = join(reconnectConfigDir, 'herdweb.config.ts')
writeFileSync(reconnectConfigPath, 'export default { reconnect: { enabled: true } }\n')
test.afterAll(() => rmSync(reconnectConfigDir, { recursive: true, force: true }))
const naturalExitServeOptions = { detached: false, killWithParent: false }

const endingCommand = (marker: string): string[] => [
	'bash',
	'--norc',
	'--noprofile',
	'-lc',
	`printf "${marker}\\n"; read -r; exit 0`,
]

test.describe('session exit with reconnect', () => {
	test.use({
		serveOptions: {
			...naturalExitServeOptions,
			command: endingCommand('session-exit-e2e'),
			configPath: reconnectConfigPath,
		},
	})

	test('ended command closes the session and shows reconnect overlay', async ({ page, serve }) => {
		await page.goto(serve.url)
		await expect(page.locator('body')).toContainText('session-exit-e2e')
		await page.evaluate(() => window.term?.input('\r', true))
		await expect(page.locator('#herdweb-reconnect-overlay')).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('#herdweb-reconnect-overlay')).toContainText(
			'Session ended — restart herdweb to start a new one.',
		)
		expect((await fetch(serve.url)).ok).toBe(true)
		await serve.close()
	})
})

test.describe('session exit without reconnect', () => {
	test.use({
		serveOptions: {
			...naturalExitServeOptions,
			command: endingCommand('session-exit-no-reconnect'),
			configPath: noReconnectConfigPath,
		},
	})

	test('ended command shows a status overlay when reconnect is disabled', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url)
		await expect(page.locator('body')).toContainText('session-exit-no-reconnect')
		await page.evaluate(() => window.term?.input('\r', true))
		await expect(page.locator('#herdweb-session-status')).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('#herdweb-session-status')).toContainText('Session ended')
		await expect(page.locator('#herdweb-reconnect-overlay')).toHaveCount(0)
		await page.reload()
		await expect(page.locator('#herdweb-session-status')).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('#herdweb-session-status')).toContainText('Session ended')
		expect((await fetch(serve.url)).ok).toBe(true)
		await serve.close()
	})
})
