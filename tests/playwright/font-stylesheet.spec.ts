import { expect, test } from './fixtures'

test('terminal still renders when the font stylesheet never returns', async ({ page, context }) => {
	// Hang the third-party font CSS forever (pending, not abort/404). context.route
	// is the interceptor this repo has verified actually reaches the request;
	// page.route misses some resource types (PR #134).
	await context.route('**/*jetbrainsmono-nfm.css*', () => new Promise(() => {}))

	// waitUntil 'load' must return even if the third-party font CSS hangs:
	// the stylesheet is injected only after the load event, so it cannot stall
	// page.goto's default waitUntil=load.
	await page.goto('/', { waitUntil: 'load' })
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await expect(page.locator('#terminal .xterm')).toBeVisible()
	await expect.poll(() => page.evaluate(() => Boolean(window.term))).toBe(true)
})
