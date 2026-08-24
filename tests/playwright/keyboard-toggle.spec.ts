/**
 * Contract tests for the client-entry term bridge keyboard semantics (V6#8).
 * src/client-entry.ts is excluded from unit-test coverage, so the wiring is
 * verified here against the real xterm textarea: the suppressed attribute,
 * focus/blur events, and WS input payloads from button sends.
 */
import { expect, test } from './fixtures'

declare global {
	interface Window {
		__focusEvents?: boolean[]
		__sentPayloads?: string[]
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await page.waitForSelector('#wt-toolbar', { timeout: 10_000 })
})

test('setKeyboardSuppressed toggles inputmode="none" on the real textarea', async ({ page }) => {
	const result = await page.evaluate(() => {
		const bridge = window.term
		const textarea = document.querySelector('.xterm-helper-textarea')
		if (!bridge?.setKeyboardSuppressed || !textarea) {
			return { hasApi: false } as const
		}
		bridge.setKeyboardSuppressed(true)
		const suppressed = textarea.getAttribute('inputmode')
		bridge.setKeyboardSuppressed(false)
		const restored = textarea.getAttribute('inputmode')
		return { hasApi: true, suppressed, restored } as const
	})

	expect(result.hasApi).toBe(true)
	expect(result.suppressed).toBe('none')
	expect(result.restored).toBeNull()
})

test('locking while focused blurs the textarea first', async ({ page }) => {
	// Focus the terminal, then suppress: the bridge must blur (spike 时序) —
	// observable as the textarea losing focus.
	const result = await page.evaluate(() => {
		const bridge = window.term
		if (!bridge?.setKeyboardSuppressed) return { hasApi: false } as const
		bridge.focus()
		const focusedBefore = document.activeElement?.className ?? ''
		bridge.setKeyboardSuppressed(true)
		const focusedAfter = document.activeElement?.className ?? ''
		bridge.setKeyboardSuppressed(false)
		return { hasApi: true, focusedBefore, focusedAfter } as const
	})

	expect(result.hasApi).toBe(true)
	expect(result.focusedBefore).toContain('xterm-helper-textarea')
	expect(result.focusedAfter).not.toContain('xterm-helper-textarea')
})

test('onFocusChange fires on real textarea focus and blur', async ({ page }) => {
	await page.evaluate(() => {
		window.__focusEvents = []
		window.term?.onFocusChange?.((focused) => {
			window.__focusEvents?.push(focused)
		})
	})

	await page.locator('#terminal').click()
	await expect.poll(() => page.evaluate(() => window.__focusEvents ?? [])).toContain(true)

	await page.evaluate(() => window.term?.blur?.())
	await expect.poll(() => page.evaluate(() => window.__focusEvents ?? [])).toContain(false)
})

test('send button produces a WS input payload while the keyboard is suppressed', async ({
	page,
}) => {
	// Spy on the live terminal WebSocket — the contract is the payload the
	// client actually sends, not a mock.
	await page.evaluate(() => {
		window.__sentPayloads = []
		const socket = window.__herdwebSockets?.[0]
		if (!socket) return
		const original = socket.send.bind(socket)
		socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
			window.__sentPayloads?.push(String(data))
			original(data)
		}
		window.term?.setKeyboardSuppressed?.(true)
	})

	// Suppression is active: inputmode="none" on the real textarea
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.querySelector('.xterm-helper-textarea')?.getAttribute('inputmode'),
			),
		)
		.toBe('none')

	// Tap the toolbar Esc button — button sends bypass the textarea entirely
	const escButton = page.locator('#wt-toolbar button', { hasText: /^Esc$/ })
	await escButton.tap()

	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window.__sentPayloads ?? [])
						.map((raw) => JSON.parse(raw) as Record<string, unknown>)
						.find(
							(message) =>
								message.type === 'input' &&
								typeof message.attachmentId === 'string' &&
								message.attachmentId.length > 0,
						) ?? null,
			),
		)
		.toEqual({
			type: 'input',
			data: '\x1b',
			attachmentId: expect.stringMatching(/./),
		})

	// Escape leaves interactive bash's readline waiting for the next byte;
	// return the PTY to a killable state before isolated-serve teardown.
	await page.evaluate(() => window.term?.input('\x03', true))
})

test('⌨ button focuses the terminal in auto mode (wiring: button → registry → controller)', async ({
	page,
}) => {
	// Default config is auto: ⌨ is momentary control — a tap summons focus.
	const toggle = page.locator('#wt-toolbar button.wt-keyboard-toggle')
	await expect(toggle).toBeVisible()
	await toggle.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})

	await expect
		.poll(() => page.evaluate(() => document.activeElement?.className ?? ''))
		.toContain('xterm-helper-textarea')
})
