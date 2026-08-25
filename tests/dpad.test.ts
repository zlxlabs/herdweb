import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDpad, defaultDpadKeys, dpadToggleButton } from '../src/controls/dpad'
import type { ButtonAction, ControlButton } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminalWithSent } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
	_resetTouchGuard()
})

afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

function dpadKeys(element: HTMLElement): HTMLButtonElement[] {
	return [...element.querySelectorAll('button')]
}

function createTestDpad(
	term: ReturnType<typeof mockTerminalWithSent>,
	keys: readonly (ControlButton | null)[] = defaultDpadKeys,
) {
	const executeAction = vi.fn<(action: ButtonAction) => void>()
	const dpad = createDpad(term, keys, { executeAction })
	return { dpad, executeAction }
}

describe('dpadToggleButton', () => {
	test('is the ✥ toolbar button with the dpad-toggle action', () => {
		expect(dpadToggleButton.id).toBe('dpad-toggle')
		expect(dpadToggleButton.label).toBe('✥')
		expect(dpadToggleButton.action).toEqual({ type: 'dpad-toggle' })
	})
})

describe('defaultDpadKeys', () => {
	test('is the 3×3 cluster: eight send keys with a null spacer at index 2', () => {
		expect(defaultDpadKeys).toHaveLength(9)
		expect(defaultDpadKeys[2]).toBeNull()
		const keys = defaultDpadKeys.filter((key) => key !== null)
		expect(keys).toHaveLength(8)
		for (const key of keys) {
			expect(key.action.type).toBe('send')
		}
		expect(keys.map((key) => key.label)).toEqual(['⌫', '↑', '←', '⏎', '→', '⇥', '↓', '⇧⇥'])
	})
})

describe('createDpad', () => {
	test('starts hidden; toggle() shows and hides the panel', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())

		// The 'open' class is the single source of truth (user-observable state)
		expect(dpad.element.classList.contains('open')).toBe(false)

		dpad.toggle()
		expect(dpad.element.classList.contains('open')).toBe(true)

		dpad.toggle()
		expect(dpad.element.classList.contains('open')).toBe(false)
	})

	test('renders exactly the eight keys ← ↑ ↓ → ⌫ ⏎ ⇥ ⇧⇥ plus a spacer cell', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		expect(dpadKeys(dpad.element).map((b) => b.textContent)).toEqual([
			'⌫',
			'↑',
			'←',
			'⏎',
			'→',
			'⇥',
			'↓',
			'⇧⇥',
		])

		const cells = [...dpad.element.children]
		expect(cells).toHaveLength(9)
		expect(cells[2]?.classList.contains('wt-dpad-spacer')).toBe(true)
	})

	test('custom keys replace the default layout', () => {
		const keys: readonly (ControlButton | null)[] = [
			{
				id: 'dpad-paste',
				label: '📋',
				description: 'Paste from clipboard',
				action: { type: 'paste' },
			},
			null,
			{
				id: 'dpad-custom',
				label: 'C-d',
				description: 'Send Ctrl-D key',
				action: { type: 'send', data: '\x04' },
			},
		]
		const { dpad } = createTestDpad(mockTerminalWithSent(), keys)

		const buttons = dpadKeys(dpad.element)
		expect(buttons.map((b) => b.textContent)).toEqual(['📋', 'C-d'])
		expect(buttons[0]?.getAttribute('aria-label')).toBe('Paste from clipboard')
		const cells = [...dpad.element.children]
		expect(cells).toHaveLength(3)
		expect(cells[1]?.classList.contains('wt-dpad-spacer')).toBe(true)
	})

	test('each default key sends its exact byte sequence via term.input', () => {
		const term = mockTerminalWithSent()
		const { dpad, executeAction } = createTestDpad(term)
		const expected: Record<string, string> = {
			'←': '\x1b[D',
			'↑': '\x1b[A',
			'↓': '\x1b[B',
			'→': '\x1b[C',
			'⌫': '\x7f',
			'⏎': '\r',
			'⇥': '\t',
			'⇧⇥': '\x1b[Z',
		}

		for (const button of dpadKeys(dpad.element)) {
			const label = button.textContent ?? ''
			button.click()
			expect(term.sent[term.sent.length - 1]).toBe(expected[label])
		}
		expect(term.sent).toHaveLength(8)
		expect(executeAction).not.toHaveBeenCalled()
	})

	test('non-send keys dispatch through executeAction and never touch term.input', () => {
		const term = mockTerminalWithSent()
		const pasteKey: ControlButton = {
			id: 'dpad-paste',
			label: '📋',
			description: 'Paste from clipboard',
			action: { type: 'paste' },
		}
		const { dpad, executeAction } = createTestDpad(term, [pasteKey])

		dpadKeys(dpad.element)[0]?.click()

		expect(executeAction).toHaveBeenCalledTimes(1)
		expect(executeAction).toHaveBeenCalledWith({ type: 'paste' })
		expect(term.sent).toEqual([])
	})

	test('focus safety: touchend on a d-pad key is defaultPrevented (no focus steal)', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())

		for (const button of dpadKeys(dpad.element)) {
			const event = new Event('touchend', { cancelable: true })
			button.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(true)
		}
	})

	test('tapping a key never focuses or blurs the terminal (keyboard lock untouched)', () => {
		const term = mockTerminalWithSent()
		let focused = 0
		let blurred = 0
		const probe = {
			...term,
			focus() {
				focused++
			},
			blur() {
				blurred++
			},
		}
		const { dpad } = createTestDpad(probe)

		for (const button of dpadKeys(dpad.element)) {
			button.click()
		}

		expect(focused).toBe(0)
		expect(blurred).toBe(0)
		expect(probe.sent).toHaveLength(8)
	})
})
