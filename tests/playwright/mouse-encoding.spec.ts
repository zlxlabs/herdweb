/**
 * Regression test for late-join mouse encoding: the app enables SGR mouse
 * reporting (?1006h) before a client connects, so the client depends on the
 * snapshot to replay it. The serialize addon only replays tracking modes
 * (?1000h etc.), so without the server appending the encoding mode, the late
 * client's xterm stays on legacy X10 encoding and emits reports via
 * term.onBinary — which the client never forwards. The tap dies silently.
 *
 * Runs against an isolated server: the test holds the PTY in a modal state
 * (foreground cat + live mouse modes) that must not leak into another test.
 */
import { expect, test } from './fixtures'

test('late client taps produce SGR mouse reports', async ({ browser, serve }) => {
	const firstContext = await browser.newContext({
		viewport: { width: 430, height: 932 },
		isMobile: true,
		hasTouch: true,
	})
	const secondContext = await browser.newContext({
		viewport: { width: 430, height: 932 },
		isMobile: true,
		hasTouch: true,
	})

	try {
		const firstPage = await firstContext.newPage()
		await firstPage.goto(serve.url)
		await firstPage.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect
			.poll(() => firstPage.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
			.toBe(true)

		// Enable mouse tracking + SGR encoding on the PTY, then run cat so
		// the shell doesn't interpret the incoming mouse reports — the tty
		// echoes them as visible ^[[<...M text.
		await firstPage.evaluate(() => {
			window.term?.input("printf '\\033[?1000h\\033[?1006hmouse-ready\\n'; cat -v\r", true)
		})
		await expect(firstPage.locator('body')).toContainText('mouse-ready')

		// Late join: this client only learns the mouse state from the snapshot.
		const secondPage = await secondContext.newPage()
		await secondPage.goto(serve.url)
		await secondPage.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect
			.poll(() => secondPage.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
			.toBe(true)
		await expect(secondPage.locator('body')).toContainText('mouse-ready')

		await secondPage.locator('#terminal .xterm-screen').click({ position: { x: 100, y: 100 } })

		// SGR-encoded report (\e[<...M) echoed by the tty. Without the
		// encoding replayed, the click is emitted via onBinary and dropped —
		// nothing ever reaches the PTY.
		await expect(secondPage.locator('body')).toContainText('^[[<')
	} finally {
		await firstContext.close()
		await secondContext.close()
	}
})

function dispatchScreenTouch(type: string): void {
	const screen = document.querySelector('#terminal .xterm-screen')
	if (!(screen instanceof HTMLElement)) {
		throw new Error('no .xterm-screen')
	}
	const rect = screen.getBoundingClientRect()
	const clientX = rect.left + Math.min(100, rect.width / 2)
	const clientY = rect.top + Math.min(100, rect.height / 2)
	const ended = type === 'touchend'
	const touchInit = {
		identifier: 1,
		target: screen,
		clientX,
		clientY,
		pageX: clientX,
		pageY: clientY,
		screenX: clientX,
		screenY: clientY,
		radiusX: 1,
		radiusY: 1,
		rotationAngle: 0,
		force: 1,
	}

	try {
		const touch = new Touch(touchInit)
		const active = ended ? [] : [touch]
		screen.dispatchEvent(
			new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				touches: active,
				targetTouches: active,
				changedTouches: [touch],
			}),
		)
		return
	} catch {
		// WebKit does not expose a constructable Touch(); keep a TouchEvent
		// instance so the production `e instanceof TouchEvent` guard still holds.
	}

	const touch = touchInit
	const active = ended ? [] : [touch]
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.setPrototypeOf(event, TouchEvent.prototype)
	Object.defineProperty(event, 'touches', { value: active })
	Object.defineProperty(event, 'targetTouches', { value: active })
	Object.defineProperty(event, 'changedTouches', { value: [touch] })
	screen.dispatchEvent(event)
}

test('long-press on the terminal emits SGR right-click reports', async ({ browser, serve }) => {
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		isMobile: true,
		hasTouch: true,
	})

	try {
		const page = await context.newPage()
		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
		await expect
			.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
			.toBe(true)

		await page.evaluate(() => {
			window.term?.input("printf '\\033[?1000h\\033[?1006hmouse-ready\\n'; cat -v\r", true)
		})
		await expect(page.locator('body')).toContainText('mouse-ready')

		await page.evaluate(dispatchScreenTouch, 'touchstart')
		await expect(page.locator('body')).toContainText('^[[<2;', { timeout: 3_000 })
		const echoLine = await page.evaluate(() => {
			const line = document.body.innerText.split('\n').find((row) => row.includes('^[[<2;'))
			return line ?? ''
		})
		expect(echoLine).toContain('^[[<2;')
		await page.evaluate(dispatchScreenTouch, 'touchend')
	} finally {
		await context.close()
	}
})
