import { expect, test } from './fixtures'

function dispatchTouch(page: import('@playwright/test').Page, selector: string, type: string) {
	return page.evaluate(
		({ selector, type }) => {
			const target = document.querySelector(selector)
			if (!(target instanceof HTMLElement)) throw new Error(`missing ${selector}`)
			const rect = target.getBoundingClientRect()
			const clientX = rect.left + Math.min(100, rect.width / 2)
			const clientY = rect.top + Math.min(100, rect.height / 2)
			const touch = {
				identifier: 1,
				target,
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
			const active = type === 'touchend' ? [] : [touch]
			const event = new Event(type, { bubbles: true, cancelable: true })
			Object.setPrototypeOf(event, TouchEvent.prototype)
			Object.defineProperty(event, 'touches', { value: active })
			Object.defineProperty(event, 'targetTouches', { value: active })
			Object.defineProperty(event, 'changedTouches', { value: [touch] })
			target.dispatchEvent(event)
		},
		{ selector, type },
	)
}

async function waitForSynced(page: import('@playwright/test').Page): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state === 'synced'))
		.toBe(true)
}

async function openSelectionMode(page: import('@playwright/test').Page): Promise<void> {
	const drawerToggle = page.locator('#wt-toolbar button', { hasText: '☰' })
	await drawerToggle.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(page.locator('#wt-drawer')).toHaveClass(/open/)

	const selectButton = page.locator('#wt-drawer-grid button', { hasText: 'Select' })
	await expect(selectButton).toBeVisible()
	await selectButton.dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(page.locator('#wt-selection-mode')).toBeVisible()
}

test('freezes selectable terminal text and excludes later output', async ({ page }) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await waitForSynced(page)

	await page.evaluate(() => {
		window.term?.input("printf 'selection-before\\n'\r", true)
	})
	await expect(page.locator('body')).toContainText('selection-before')

	await openSelectionMode(page)
	const snapshot = page.locator('#wt-selection-mode-snapshot')
	await expect(snapshot).toContainText('selection-before')
	await expect
		.poll(() =>
			page.evaluate(() => {
				const overlay = document.querySelector('#wt-selection-mode')
				const snapshot = document.querySelector('#wt-selection-mode-snapshot')
				return {
					parentId: overlay?.parentElement?.id,
					insideScreen: Boolean(overlay?.closest('.xterm-screen')),
					userSelect: snapshot
						? getComputedStyle(snapshot).userSelect || getComputedStyle(snapshot).webkitUserSelect
						: '',
					touchAction: snapshot ? getComputedStyle(snapshot).touchAction : '',
				}
			}),
		)
		.toEqual({
			parentId: 'terminal-container',
			insideScreen: false,
			userSelect: 'text',
			touchAction: 'auto',
		})

	await page.evaluate(() => {
		window.term?.input("printf 'selection-after\\n'\r", true)
	})
	await expect(page.locator('body')).toContainText('selection-after')
	await expect(snapshot).not.toContainText('selection-after')
})

test('selection overlay does not trigger terminal long-press and can be exited', async ({
	page,
}) => {
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
	await waitForSynced(page)

	await page.evaluate(() => {
		window.term?.input("printf '\\033[?1000h\\033[?1006hmouse-ready\\n'; cat -v\r", true)
	})
	await expect(page.locator('body')).toContainText('mouse-ready')

	await openSelectionMode(page)
	await dispatchTouch(page, '#wt-selection-mode-snapshot', 'touchstart')
	await expect
		.poll(() => page.evaluate(() => document.body.innerText.includes('^[[<2;')))
		.toBe(false)
	await page.waitForTimeout(650)
	await expect(page.locator('body')).not.toContainText('^[[<2;')
	await dispatchTouch(page, '#wt-selection-mode-snapshot', 'touchend')

	await page.locator('#wt-selection-mode-close').dispatchEvent('touchend', {
		touches: [],
		changedTouches: [],
		targetTouches: [],
	})
	await expect(page.locator('#wt-selection-mode')).toHaveCount(0)

	await dispatchTouch(page, '#terminal .xterm-screen', 'touchstart')
	await expect(page.locator('body')).toContainText('^[[<2;', { timeout: 3_000 })
	await dispatchTouch(page, '#terminal .xterm-screen', 'touchend')

	await openSelectionMode(page)
	await page.keyboard.press('Escape')
	await expect(page.locator('#wt-selection-mode')).toHaveCount(0)
})
