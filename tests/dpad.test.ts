import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultActionRegistry } from '../src/actions/registry'
import {
	DPAD_POSITION_STORAGE_KEY,
	clampDpadPosition,
	createDpad,
	defaultDpadKeys,
	dpadToggleButton,
	readDpadPosition,
	writeDpadPosition,
} from '../src/controls/dpad'
import type { ButtonAction, ControlButton } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { sendData } from '../src/util/terminal'
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
	return [...element.querySelectorAll('button:not(.wt-dpad-handle)')]
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
	test('is the 3×3 cluster: eight send keys plus a 📋 paste key at index 2', () => {
		expect(defaultDpadKeys).toHaveLength(9)
		expect(defaultDpadKeys.map((key) => key?.label)).toEqual([
			'⌫',
			'↑',
			'📋',
			'←',
			'⏎',
			'→',
			'⇥',
			'↓',
			'⇧⇥',
		])
		expect(defaultDpadKeys[2]?.action).toEqual({ type: 'paste' })
		for (const [index, key] of defaultDpadKeys.entries()) {
			if (index === 2) continue
			expect(key?.action.type).toBe('send')
		}
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

	test('renders the nine keys in grid order (⌫ ↑ 📋 ← ⏎ → ⇥ ↓ ⇧⇥), no spacer', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		expect(dpadKeys(dpad.element).map((b) => b.textContent)).toEqual([
			'⌫',
			'↑',
			'📋',
			'←',
			'⏎',
			'→',
			'⇥',
			'↓',
			'⇧⇥',
		])
		expect(dpad.element.querySelector('.wt-dpad-spacer')).toBeNull()
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
		// Children: the drag handle plus one grid cell per key slot
		const cells = [...dpad.element.children]
		expect(cells).toHaveLength(4)
		expect(cells[0]?.classList.contains('wt-dpad-handle')).toBe(true)
		expect(cells[2]?.classList.contains('wt-dpad-spacer')).toBe(true)
	})

	test('send keys emit their exact byte sequence; 📋 dispatches through executeAction', () => {
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
			if (label === '📋') continue
			expect(term.sent[term.sent.length - 1]).toBe(expected[label])
		}
		expect(term.sent).toHaveLength(8)
		expect(executeAction).toHaveBeenCalledTimes(1)
		expect(executeAction).toHaveBeenCalledWith({ type: 'paste' })
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

describe('dpad paste wiring (registry end-to-end)', () => {
	function createDpadWithRealRegistry(options: { clipboard: unknown; toasts: string[] }) {
		const term = mockTerminalWithSent()
		Object.defineProperty(navigator, 'clipboard', {
			value: options.clipboard,
			configurable: true,
		})
		const registry = createDefaultActionRegistry({
			showToast: (message) => options.toasts.push(message),
		})
		let executed: Promise<boolean> | undefined
		const dpad = createDpad(term, defaultDpadKeys, {
			executeAction: (action) => {
				executed = registry.execute(action, {
					term,
					kbWasOpen: false,
					focusIfNeeded() {},
					async sendText(data: string) {
						sendData(term, data)
					},
				})
			},
		})
		const tapPaste = () => {
			dpadKeys(dpad.element)
				.find((button) => button.textContent === '📋')
				?.click()
			return executed
		}
		return { term, tapPaste }
	}

	test('📋 paste key delivers clipboard text into the terminal', async () => {
		const toasts: string[] = []
		const { term, tapPaste } = createDpadWithRealRegistry({
			clipboard: { readText: async () => 'clipboard text' },
			toasts,
		})

		await tapPaste()

		expect(term.sent).toEqual(['clipboard text'])
		expect(toasts).toEqual([])
	})

	test('📋 paste failure surfaces a toast and sends nothing', async () => {
		const toasts: string[] = []
		const { term, tapPaste } = createDpadWithRealRegistry({
			clipboard: {
				readText: async () => {
					throw new Error('denied')
				},
			},
			toasts,
		})

		await tapPaste()

		expect(toasts).toEqual(['Paste failed — clipboard read was denied.'])
		expect(term.sent).toEqual([])
	})
})

describe('long-press (hold ⏎ for newline, no submit)', () => {
	const touch = (id: number, target: HTMLElement) =>
		({ identifier: id, target, clientX: 0, clientY: 0 }) as unknown as Touch

	function enterKey(element: HTMLElement): HTMLButtonElement {
		const button = dpadKeys(element).find((b) => b.textContent === '⏎')
		if (!button) throw new Error('no ⏎ key')
		return button
	}

	function tapTouch(button: HTMLButtonElement, holdMs: number): void {
		vi.useFakeTimers()
		try {
			button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [touch(1, button)] }))
			vi.advanceTimersByTime(holdMs)
			button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(1, button)] }))
		} finally {
			vi.useRealTimers()
		}
	}

	test('the default ⏎ key carries longPressAction \\n and the alt-key marker class', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		const enter = enterKey(dpad.element)
		expect(enter.classList.contains('wt-dpad-has-alt')).toBe(true)
		expect(enter.getAttribute('aria-label')).toBe('Enter — hold to insert newline (no submit)')
		const backspace = dpadKeys(dpad.element).find((b) => b.textContent === '⌫')
		expect(backspace?.classList.contains('wt-dpad-has-alt')).toBe(false)
	})

	test('short tap on ⏎ sends \\r (unchanged tap behaviour)', () => {
		const term = mockTerminalWithSent()
		const { dpad } = createTestDpad(term)

		tapTouch(enterKey(dpad.element), 100)

		expect(term.sent).toEqual(['\r'])
	})

	test('holding ⏎ past the threshold sends \\n and suppresses the \\r tap', () => {
		const term = mockTerminalWithSent()
		const { dpad } = createTestDpad(term)

		tapTouch(enterKey(dpad.element), 600)

		expect(term.sent).toEqual(['\n'])
	})

	test('releasing ⏎ below the threshold sends only \\r', () => {
		const term = mockTerminalWithSent()
		const { dpad } = createTestDpad(term)

		tapTouch(enterKey(dpad.element), 499)

		expect(term.sent).toEqual(['\r'])
	})

	test('a custom longPressAction (e.g. kitty sequence) is dispatched instead', () => {
		const term = mockTerminalWithSent()
		const kittyEnter: ControlButton = {
			id: 'dpad-enter',
			label: '⏎',
			description: 'Enter — hold to insert newline (no submit)',
			action: { type: 'send', data: '\r' },
			longPressAction: { type: 'send', data: '\x1b[13;2u' },
		}
		const { dpad } = createTestDpad(term, [kittyEnter])
		const enter = enterKey(dpad.element)

		tapTouch(enter, 600)
		expect(term.sent).toEqual(['\x1b[13;2u'])

		tapTouch(enter, 100)
		expect(term.sent).toEqual(['\x1b[13;2u', '\r'])
	})

	test('mouse long-press works too (mousedown holds, click is suppressed)', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)
			const enter = enterKey(dpad.element)

			enter.dispatchEvent(new MouseEvent('mousedown'))
			vi.advanceTimersByTime(600)
			enter.dispatchEvent(new MouseEvent('mouseup'))
			enter.click()
			expect(term.sent).toEqual(['\n'])

			enter.dispatchEvent(new MouseEvent('mousedown'))
			vi.advanceTimersByTime(100)
			enter.dispatchEvent(new MouseEvent('mouseup'))
			enter.click()
			expect(term.sent).toEqual(['\n', '\r'])
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('hold-to-repeat (← ↑ ↓ → ⌫)', () => {
	const touch = (id: number, target: HTMLElement) =>
		({ identifier: id, target, clientX: 0, clientY: 0 }) as unknown as Touch

	function keyByLabel(element: HTMLElement, label: string): HTMLButtonElement {
		const button = dpadKeys(element).find((b) => b.textContent === label)
		if (!button) throw new Error(`no ${label} key`)
		return button
	}

	function holdTouch(button: HTMLButtonElement, holdMs: number): void {
		button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [touch(1, button)] }))
		vi.advanceTimersByTime(holdMs)
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(1, button)] }))
	}

	test('holding ↓ for 1s follows the 300ms-delay/100ms-interval cadence (8 sends), tap suppressed', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)

			holdTouch(keyByLabel(dpad.element, '↓'), 1000)

			expect(term.sent).toEqual(Array(8).fill('\x1b[B'))
		} finally {
			vi.useRealTimers()
		}
	})

	test('short tap on ↓ still sends exactly once', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)

			holdTouch(keyByLabel(dpad.element, '↓'), 100)

			expect(term.sent).toEqual(['\x1b[B'])
		} finally {
			vi.useRealTimers()
		}
	})

	test('releasing mid-repeat stops immediately (3 sends at 550ms, none after)', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)
			const down = keyByLabel(dpad.element, '↓')

			holdTouch(down, 550)
			expect(term.sent).toHaveLength(3)

			vi.advanceTimersByTime(1000)
			expect(term.sent).toHaveLength(3)
		} finally {
			vi.useRealTimers()
		}
	})

	test('⏎ has longPressAction, so it never repeats (1.5s hold → a single \\n)', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)

			holdTouch(keyByLabel(dpad.element, '⏎'), 1500)

			expect(term.sent).toEqual(['\n'])
		} finally {
			vi.useRealTimers()
		}
	})

	test('a custom key with repeatOnHold: true repeats', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const repeatKey: ControlButton = {
				id: 'dpad-x',
				label: 'x',
				description: 'Send x key',
				action: { type: 'send', data: 'x' },
				repeatOnHold: true,
			}
			const { dpad } = createTestDpad(term, [repeatKey])

			holdTouch(keyByLabel(dpad.element, 'x'), 650)

			expect(term.sent).toEqual(['x', 'x', 'x', 'x'])
		} finally {
			vi.useRealTimers()
		}
	})

	test('mouse hold repeats and the click after mouseup is suppressed', () => {
		vi.useFakeTimers()
		try {
			const term = mockTerminalWithSent()
			const { dpad } = createTestDpad(term)
			const down = keyByLabel(dpad.element, '↓')

			down.dispatchEvent(new MouseEvent('mousedown'))
			vi.advanceTimersByTime(800)
			down.dispatchEvent(new MouseEvent('mouseup'))
			down.click()

			expect(term.sent).toEqual(Array(6).fill('\x1b[B'))
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('draggable pad with persisted position', () => {
	function dragHandle(element: HTMLElement): HTMLButtonElement {
		const handle = element.querySelector<HTMLButtonElement>('.wt-dpad-handle')
		if (!handle) throw new Error('no drag handle')
		return handle
	}

	function pointer(type: string, target: HTMLElement, x: number, y: number): void {
		target.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y }))
	}

	beforeEach(() => {
		localStorage.clear()
	})

	describe('clampDpadPosition', () => {
		test('clamps negative and overflowing coordinates into the viewport', () => {
			expect(clampDpadPosition({ x: -5, y: 9999 }, 390, 844, 164, 180)).toEqual({ x: 0, y: 664 })
			expect(clampDpadPosition({ x: 9999, y: -5 }, 390, 844, 164, 180)).toEqual({ x: 226, y: 0 })
			expect(clampDpadPosition({ x: 50, y: 60 }, 390, 844, 164, 180)).toEqual({ x: 50, y: 60 })
		})

		test('a pad larger than the viewport pins to 0 (no negative range)', () => {
			expect(clampDpadPosition({ x: 50, y: 50 }, 100, 100, 164, 180)).toEqual({ x: 0, y: 0 })
		})
	})

	describe('readDpadPosition / writeDpadPosition', () => {
		test('round-trips a position through storage', () => {
			writeDpadPosition(localStorage, { x: 12, y: 34 })
			expect(readDpadPosition(localStorage)).toEqual({ x: 12, y: 34 })
			expect(localStorage.getItem(DPAD_POSITION_STORAGE_KEY)).toBe('{"x":12,"y":34}')
		})

		test('returns null when the key is missing, corrupted, or has non-numeric fields', () => {
			expect(readDpadPosition(localStorage)).toBeNull()
			localStorage.setItem(DPAD_POSITION_STORAGE_KEY, 'not json')
			expect(readDpadPosition(localStorage)).toBeNull()
			localStorage.setItem(DPAD_POSITION_STORAGE_KEY, '{"x":"12","y":34}')
			expect(readDpadPosition(localStorage)).toBeNull()
		})
	})

	test('renders a full-width drag handle above the key grid', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		const handle = dragHandle(dpad.element)
		expect(handle.getAttribute('aria-label')).toBe('Drag to move pad, double-tap to dock')
		expect(dpad.element.firstElementChild).toBe(handle)
	})

	test('dragging the handle updates left/top inline styles, floats the pad, and persists on release', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		const handle = dragHandle(dpad.element)

		pointer('pointerdown', handle, 100, 100)
		pointer('pointermove', handle, 150, 140)

		expect(dpad.element.classList.contains('wt-dpad-floating')).toBe(true)
		expect(dpad.element.style.left).toBe('50px')
		expect(dpad.element.style.top).toBe('40px')

		pointer('pointerup', handle, 150, 140)
		expect(readDpadPosition(localStorage)).toEqual({ x: 50, y: 40 })
	})

	test('pointermove below the 4px threshold is still a tap, not a drag', () => {
		const { dpad } = createTestDpad(mockTerminalWithSent())
		const handle = dragHandle(dpad.element)

		pointer('pointerdown', handle, 100, 100)
		pointer('pointermove', handle, 101, 102)
		pointer('pointerup', handle, 101, 102)

		expect(dpad.element.classList.contains('wt-dpad-floating')).toBe(false)
		expect(readDpadPosition(localStorage)).toBeNull()
	})

	test('double-tap on the handle docks the pad (clears inline styles and storage)', () => {
		writeDpadPosition(localStorage, { x: 20, y: 30 })
		const { dpad } = createTestDpad(mockTerminalWithSent())
		const handle = dragHandle(dpad.element)

		pointer('pointerdown', handle, 100, 100)
		pointer('pointermove', handle, 150, 140)
		pointer('pointerup', handle, 150, 140)
		expect(dpad.element.classList.contains('wt-dpad-floating')).toBe(true)

		pointer('pointerdown', handle, 150, 140)
		pointer('pointerup', handle, 150, 140)
		pointer('pointerdown', handle, 150, 140)
		pointer('pointerup', handle, 150, 140)

		expect(dpad.element.classList.contains('wt-dpad-floating')).toBe(false)
		expect(dpad.element.style.left).toBe('')
		expect(dpad.element.style.top).toBe('')
		expect(readDpadPosition(localStorage)).toBeNull()
	})

	test('a stored position is applied (clamped) when the pad is first opened', () => {
		writeDpadPosition(localStorage, { x: 70, y: 80 })
		const { dpad } = createTestDpad(mockTerminalWithSent())

		dpad.toggle()

		expect(dpad.element.classList.contains('wt-dpad-floating')).toBe(true)
		expect(dpad.element.style.left).toBe('70px')
		expect(dpad.element.style.top).toBe('80px')
	})
})
