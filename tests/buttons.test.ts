import { describe, expect, test } from 'vitest'
import { defaultDrawerButtons } from '../src/config'
import { dpadToggleButton } from '../src/controls/dpad'
import { keyboardToggleButton } from '../src/controls/keyboard-controller'
import { defaultRow1, defaultRow2 } from '../src/toolbar/buttons'

describe('defaultRow1 (moshi-style single row)', () => {
	test('is exactly the 8-button set in render order: control keys left, input modes right', () => {
		expect(defaultRow1.map((b) => b.id)).toEqual([
			'esc',
			'ctrl-c',
			'dpad-toggle',
			'enter',
			'voice-input',
			'image-upload',
			'keyboard-toggle',
			'drawer-toggle',
		])
	})

	test('starts with Esc', () => {
		expect(defaultRow1[0]?.label).toBe('Esc')
		expect(defaultRow1[0]?.action).toEqual({ type: 'send', data: '\x1b' })
	})

	test('has a dedicated C-c second — double-tap quits coding agents', () => {
		expect(defaultRow1[1]?.id).toBe('ctrl-c')
		expect(defaultRow1[1]?.action).toEqual({ type: 'send', data: '\x03' })
	})

	test('keeps ⏎ on the row — the primary send key never moves into a submenu', () => {
		const enter = defaultRow1.find((b) => b.id === 'enter')
		expect(enter?.action).toEqual({ type: 'send', data: '\r' })
	})

	test('⌫ leaves the row and the drawer — the d-pad owns it now', () => {
		expect(defaultRow1.find((b) => b.id === 'backspace')).toBeUndefined()
		expect(defaultDrawerButtons.find((b) => b.id === 'backspace')).toBeUndefined()
	})

	test('has no arrow keys — the floating d-pad (✥) owns them now', () => {
		const arrows = defaultRow1.filter(
			(b) =>
				b.action.type === 'send' && b.action.data.startsWith('\x1b[') && b.action.data !== '\x1b[Z',
		)
		expect(arrows).toEqual([])
		const dpad = defaultRow1.find((b) => b.id === 'dpad-toggle')
		expect(dpad).toEqual(dpadToggleButton)
	})

	test('voice-input sits between ⏎ and 🖼 in the right-hand input zone', () => {
		const ids = defaultRow1.map((b) => b.id)
		expect(ids.indexOf('voice-input')).toBe(ids.indexOf('enter') + 1)
		expect(ids.indexOf('voice-input')).toBe(ids.indexOf('image-upload') - 1)
	})

	test('ends with ⌨ then ☰ (icon-only, no More text)', () => {
		expect(defaultRow1[defaultRow1.length - 2]).toEqual(keyboardToggleButton)
		const last = defaultRow1[defaultRow1.length - 1]
		expect(last?.action).toEqual({ type: 'drawer-toggle' })
		expect(last?.label).toBe('☰')
	})

	test('keeps the sticky Ctrl, Prefix and Paste off the row', () => {
		expect(defaultRow1.find((b) => b.action.type === 'ctrl-modifier')).toBeUndefined()
		expect(defaultRow1.find((b) => b.action.type === 'prefix')).toBeUndefined()
		expect(defaultRow1.find((b) => b.action.type === 'paste')).toBeUndefined()
	})
})

describe('defaultRow2', () => {
	test('is empty — the toolbar is a single row by default', () => {
		expect(defaultRow2).toEqual([])
	})
})
