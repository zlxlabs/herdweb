/**
 * Mobile-emulation e2e for the d-pad (issues #98/#99 + drag-to-move):
 * paste key, hold-⏎ newline-without-submit, hold-to-repeat arrows, and
 * handle dragging with localStorage persistence + double-tap dock.
 *
 * Byte-level assertions: `stty -echo -icrnl` plus a bash read loop prints every
 * byte the PTY receives as a hex line (e.g. ↓ = \x1b[B → "1b5b42"), so \n (0a)
 * and \r (0d) stay distinguishable on screen (-icrnl keeps \r as 0d).
 */
import type { Page } from '@playwright/test'
import { type DpadDiagnostics, installDpadDiagnostics } from './dpad-diagnostics'
import { expect, test } from './fixtures'

let diag: DpadDiagnostics | undefined

test.beforeEach(async ({ page }, testInfo) => {
	diag = await installDpadDiagnostics(page, testInfo)
	await page.goto('/')
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
		.toBe(true)
})

test.afterEach(async ({ page: _page }, testInfo) => {
	await diag?.afterTest(testInfo)
})

async function openDpad(page: Page) {
	// Synthetic touchend instead of .tap(): a real tap makes webkit synthesise a
	// compat mouse click on ✥ ~4ms later, and tap.ts can only suppress that click
	// inside a 400ms wall-clock window. Under runner CPU contention the click can
	// be delivered after the window expired, toggling the pad CLOSED again — the
	// pad then disappears between openDpad and the next interaction (CI runs
	// 43801950871/43802465799: "key has no bounding box"; load repro: .tap() on ↓
	// stuck 30s on "element is not visible"). dispatchEvent generates no compat
	// click, so the open state is stable. Same idiom as selection-mode's drawer.
	await page
		.locator('#wt-toolbar button', { hasText: '✥' })
		.dispatchEvent('touchend', { touches: [], changedTouches: [], targetTouches: [] })
	await expect(page.locator('#wt-dpad')).toHaveClass(/open/)
	// Key taps emit input frames the client drops while not synced (by design,
	// with a "Not sent" notice): on webkit a transient socket-error ~120ms after
	// first sync left a ~1.1s reconnect window that swallowed the ↓ tap
	// (run 43361349896 attempt 2). Wait out any transient reconnect before taps.
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state), {
			timeout: 10_000,
		})
		.toBe('synced')
}

/** Print every byte the PTY receives as a hex line on screen */
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
	// .xterm-rows only — .xterm-screen textContent also captures the DOM
	// renderer's <style> block, whose hex colors (e.g. #8700d7) contain "0d"
	return (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
}

/**
 * Hold a key down with the mouse (the d-pad wires long-press/repeat on mousedown
 * too) until `until` observes the held press's effect, then release.
 *
 * The release must not happen before the page-side timers produced their effect:
 * a held key starts its timers (300ms delay, then 100ms interval / one long-press
 * shot) only after mousedown is processed, and mouseup clears any timer that has
 * not fired yet. A fixed wall-clock hold is bounded by test-process time, which
 * decouples from the page under runner CPU contention (CI run 43801950871: zero
 * input frames during an 800ms hold). Waiting for the observable echo while
 * still held removes the coupling without extending any timeout. If `until`
 * throws, the key is still released so the failure dump shows the real state.
 */
async function holdKey(
	page: Page,
	locator: ReturnType<Page['locator']>,
	until: () => Promise<unknown>,
): Promise<void> {
	const box = await locator.boundingBox()
	if (!box) throw new Error('key has no bounding box')
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	try {
		await until()
	} finally {
		await page.mouse.up()
	}
}

test('✥ opens the d-pad: nine keys, 📋, ⏎ alt badge, and the drag handle', async ({ page }) => {
	await openDpad(page)
	const dpad = page.locator('#wt-dpad')
	await expect(dpad.locator('.wt-dpad-handle')).toHaveCount(1)
	await expect(dpad.locator('button:not(.wt-dpad-handle)')).toHaveCount(9)
	await expect(dpad.locator('button', { hasText: '📋' })).toHaveCount(1)
	await expect(dpad.locator('button', { hasText: '⏎' })).toHaveClass(/wt-dpad-has-alt/)
})

test('tap ↓ sends the down-arrow sequence', async ({ page }) => {
	await startByteEcho(page)
	await openDpad(page)

	await page.locator('#wt-dpad button', { hasText: '↓' }).tap()

	await expect.poll(() => screenText(page)).toContain('1b5b42')
})

test('holding ⏎ sends \\n (0a) and never \\r (0d)', async ({ page }) => {
	await startByteEcho(page)
	await openDpad(page)

	// Hold until the newline echo shows up, then release (see holdKey). The
	// echoed command text and prompt cannot contain '0a', so the first match is
	// the dispatch itself.
	await holdKey(page, page.locator('#wt-dpad button', { hasText: '⏎' }), async () => {
		await expect
			.poll(async () => (await screenText(page)).match(/0a/g)?.length ?? 0)
			.toBeGreaterThanOrEqual(1)
	})

	expect(await screenText(page)).not.toContain('0d')
})

test('holding → repeats the right-arrow sequence (300ms delay, 100ms interval)', async ({
	page,
}) => {
	await startByteEcho(page)
	await openDpad(page)

	// Hold until three repeats have echoed, then release (see holdKey):
	// first send at ~300ms, then every ~100ms, observed while still held
	await holdKey(page, page.locator('#wt-dpad button', { hasText: '→' }), async () => {
		await expect
			.poll(async () => (await screenText(page)).match(/1b5b43/g)?.length ?? 0)
			.toBeGreaterThanOrEqual(3)
	})
})

test('📋 pastes clipboard text into the terminal', async ({ page, context, browserName }) => {
	test.skip(browserName !== 'chromium', 'webkit has no clipboard-read permission grant')
	await context.grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.evaluate(() => navigator.clipboard.writeText('e2e-paste-ok'))
	await openDpad(page)

	await page.locator('#wt-dpad button', { hasText: '📋' }).tap()

	// Canonical-mode bash echoes the pasted bytes at the prompt
	await expect(page.locator('body')).toContainText('e2e-paste-ok')
})

test('dragging the handle moves the pad, persists across reload, double-tap docks', async ({
	page,
}) => {
	await openDpad(page)
	const dpad = page.locator('#wt-dpad')
	const handle = dpad.locator('.wt-dpad-handle')
	const before = await dpad.boundingBox()
	const handleBox = await handle.boundingBox()
	if (!before || !handleBox) throw new Error('d-pad not laid out')

	const grabX = handleBox.x + handleBox.width / 2
	const grabY = handleBox.y + handleBox.height / 2
	await page.mouse.move(grabX, grabY)
	await page.mouse.down()
	await page.mouse.move(grabX - 120, grabY - 160, { steps: 5 })
	await page.mouse.up()

	await expect(dpad).toHaveClass(/wt-dpad-floating/)
	const dragged = await dpad.boundingBox()
	if (!dragged) throw new Error('d-pad not laid out after drag')
	// Drag delta −120/−160, clamped into the viewport (tolerance for px rounding)
	expect(Math.abs(dragged.x - Math.max(0, before.x - 120))).toBeLessThan(15)
	expect(Math.abs(dragged.y - Math.max(0, before.y - 160))).toBeLessThan(15)

	const style = async () =>
		dpad.evaluate((el) => ({
			left: (el as HTMLElement).style.left,
			top: (el as HTMLElement).style.top,
		}))
	const draggedStyle = await style()

	// Position persists in localStorage and is re-applied after a reload
	await page.reload()
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
		.toBe(true)
	await openDpad(page)
	await expect(dpad).toHaveClass(/wt-dpad-floating/)
	expect(await style()).toEqual(draggedStyle)

	// Double-tap the handle docks the pad back above the toolbar. One dblclick
	// (one queued input batch) instead of two separate clicks: the dock window is
	// 300ms of PAGE time between the two pointerups, and two independent
	// actionability-checked clicks can be processed >300ms apart under runner CPU
	// contention, leaving the pad floating (load repro: 3/20 and 1/20 at base).
	await handle.dblclick()
	await expect(dpad).not.toHaveClass(/wt-dpad-floating/)
	expect(await style()).toEqual({ left: '', top: '' })
	expect(await page.evaluate(() => localStorage.getItem('herdweb:dpadPosition'))).toBeNull()
})
