import { type Page, test as base, expect } from '@playwright/test'
import { startIsolatedServe } from './isolated-serve'

type ServeOptions = NonNullable<Parameters<typeof startIsolatedServe>[0]>
type IsolatedServe = Awaited<ReturnType<typeof startIsolatedServe>>

type Fixtures = {
	serveOptions: ServeOptions
	serve: IsolatedServe
	terminalPage: Page
}

export const test = base.extend<Fixtures>({
	serveOptions: [{}, { option: true }],
	serve: async ({ serveOptions }, use) => {
		const serve = await startIsolatedServe(serveOptions)
		try {
			await use(serve)
		} finally {
			await serve.close()
		}
	},
	baseURL: async ({ serve }, use) => {
		await use(serve.url)
	},
	terminalPage: async ({ page }, use) => {
		await openTerminal(page, '/')
		await use(page)
	},
})

/**
 * Navigate and wait until the terminal client is `synced` — the server has
 * committed the attach (attach-committed received) and the snapshot is on
 * screen. Guarantees at return time: terminal DOM is up and connection state
 * is `synced`, so typed input reaches the PTY. Does NOT guarantee any future
 * state: a later disconnect still drops subsequent input by design, and tests
 * that need an unsynced page (offline, first-load, proxy installs) must use
 * the raw `page` fixture instead.
 */
export async function openTerminal(page: Page, url: string): Promise<void> {
	await page.goto(url)
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state), {
			timeout: 15_000,
		})
		.toBe('synced')
}

export { expect }
