import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { defineConfig } from '../src/config'
import { createDrawer } from '../src/drawer/drawer'
import { createHookRegistry } from '../src/hooks/registry'
import type { ControlButton } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
	_resetTouchGuard()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

function makeDrawer() {
	const config = defineConfig()
	return createDrawer(mockTerminal(), config.drawer.buttons, {
		hooks: createHookRegistry(),
		appConfig: config,
	})
}

describe('drawer close paths', () => {
	test('renders a visible × close button in the handle area', () => {
		const { drawer } = makeDrawer()
		const closeButton = drawer.querySelector<HTMLButtonElement>('#wt-drawer-close')

		expect(closeButton).not.toBeNull()
		expect(closeButton?.textContent).toBe('×')
		expect(closeButton?.getAttribute('aria-label')).toBe('Close drawer')
		// Lives next to the drag handle
		expect(closeButton?.parentElement?.id).toBe('wt-drawer-header')
		expect(drawer.querySelector('#wt-drawer-header #wt-drawer-handle')).not.toBeNull()
	})

	test('tapping × closes the drawer (class + backdrop)', () => {
		const { backdrop, drawer, open, isOpen } = makeDrawer()
		open()
		expect(isOpen()).toBe(true)

		drawer.querySelector<HTMLButtonElement>('#wt-drawer-close')?.click()

		expect(isOpen()).toBe(false)
		expect(drawer.classList.contains('open')).toBe(false)
		expect(backdrop.style.display).toBe('none')
	})

	test('focus safety: touchend on × is defaultPrevented (no focus steal)', () => {
		const { drawer } = makeDrawer()
		const closeButton = drawer.querySelector<HTMLButtonElement>('#wt-drawer-close')

		const event = new Event('touchend', { cancelable: true })
		closeButton?.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
	})

	test('backdrop tap still closes the drawer', () => {
		const { backdrop, drawer, open, isOpen } = makeDrawer()
		open()

		backdrop.click()

		expect(isOpen()).toBe(false)
		expect(drawer.classList.contains('open')).toBe(false)
	})

	test('↑ ↓ fallback buttons are reachable in the default drawer grid', () => {
		const { drawer } = makeDrawer()
		const labels = [...drawer.querySelectorAll('#wt-drawer-grid button')].map((b) => b.textContent)
		expect(labels).toContain('↑')
		expect(labels).toContain('↓')
	})

	test('Tab fallback is reachable in the default drawer grid (⌫ took its row1 slot)', () => {
		const { drawer } = makeDrawer()
		const labels = [...drawer.querySelectorAll('#wt-drawer-grid button')].map((b) => b.textContent)
		expect(labels).toContain('Tab')
	})
})

describe('drawer section headings', () => {
	test('renders one heading row per section, in order', () => {
		const { drawer } = makeDrawer()
		const headings = [...drawer.querySelectorAll('#wt-drawer-grid .wt-drawer-section')].map(
			(h) => h.textContent,
		)
		expect(headings).toEqual(['herdr', 'Terminal', 'App'])
	})

	test('each heading precedes the first button of its section', () => {
		const { drawer } = makeDrawer()
		const grid = drawer.querySelector('#wt-drawer-grid')
		const children = [...(grid?.children ?? [])]

		const herdrHeading = children.findIndex((c) => c.textContent === 'herdr')
		expect(children[herdrHeading + 1]?.textContent).toBe('+ Win')
		const terminalHeading = children.findIndex((c) => c.textContent === 'Terminal')
		expect(children[terminalHeading + 1]?.textContent).toBe('PgUp')
		const appHeading = children.findIndex((c) => c.textContent === 'App')
		expect(children[appHeading + 1]?.textContent).toBe('Font −')
	})

	test('buttons without a section render no heading', () => {
		const config = defineConfig()
		const plain: readonly ControlButton[] = [
			{ id: 'a', label: 'A', description: 'a', action: { type: 'send', data: 'a' } },
			{ id: 'b', label: 'B', description: 'b', action: { type: 'send', data: 'b' } },
		]
		const { drawer } = createDrawer(mockTerminal(), plain, {
			hooks: createHookRegistry(),
			appConfig: config,
		})
		expect(drawer.querySelectorAll('#wt-drawer-grid .wt-drawer-section').length).toBe(0)
		expect(drawer.querySelectorAll('#wt-drawer-grid button').length).toBe(2)
	})
})
