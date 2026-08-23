import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDpad, dpadToggleButton } from '../src/controls/dpad'
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

describe('dpadToggleButton', () => {
	test('is the ✥ toolbar button with the dpad-toggle action', () => {
		expect(dpadToggleButton.id).toBe('dpad-toggle')
		expect(dpadToggleButton.label).toBe('✥')
		expect(dpadToggleButton.action).toEqual({ type: 'dpad-toggle' })
	})
})

describe('createDpad', () => {
	test('starts hidden; toggle() shows and hides the panel', () => {
		const dpad = createDpad(mockTerminalWithSent())

		// The 'open' class is the single source of truth (user-observable state)
		expect(dpad.element.classList.contains('open')).toBe(false)

		dpad.toggle()
		expect(dpad.element.classList.contains('open')).toBe(true)

		dpad.toggle()
		expect(dpad.element.classList.contains('open')).toBe(false)
	})

	test('renders exactly the eight keys ← ↑ ↓ → ⌫ ⏎ ⇥ ⇧⇥', () => {
		const dpad = createDpad(mockTerminalWithSent())
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
	})

	test('each key sends its exact byte sequence via term.input', () => {
		const term = mockTerminalWithSent()
		const dpad = createDpad(term)
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
	})

	test('focus safety: touchend on a d-pad key is defaultPrevented (no focus steal)', () => {
		const dpad = createDpad(mockTerminalWithSent())

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
		const dpad = createDpad(probe)

		for (const button of dpadKeys(dpad.element)) {
			button.click()
		}

		expect(focused).toBe(0)
		expect(blurred).toBe(0)
		expect(probe.sent).toHaveLength(8)
	})
})
