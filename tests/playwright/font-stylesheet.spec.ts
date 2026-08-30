import { expect, test } from './fixtures'

test('terminal still renders when the font stylesheet never returns', async ({ page, context }) => {
	// Hang the third-party font CSS forever (pending, not abort/404). context.route
	// is the interceptor this repo has verified actually reaches the request;
	// page.route misses some resource types (PR #134).
	await context.route('**/*jetbrainsmono-nfm.css*', () => new Promise(() => {}))

	// waitUntil 'commit' returns once the local HTML arrives. The invariant is
	// that a hung font CSS must not stop the parser from running the inline
	// bundle — so the terminal appears without waiting for window.load (a print
	// stylesheet can still delay load even when it is not render-blocking).
	await page.goto('/', { waitUntil: 'commit' })
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await expect(page.locator('#terminal .xterm')).toBeVisible()
	await expect.poll(() => page.evaluate(() => Boolean(window.term))).toBe(true)
})
