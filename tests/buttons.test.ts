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
		expect(defaultRow1[0]?.action).toEqual({ type: 'send', data: '\x1b[27u' })
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
				b.action.type === 'send' &&
				b.action.data.startsWith('\x1b[') &&
				b.action.data !== '\x1b[Z' &&
				b.action.data !== '\x1b[27u',
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

	test('puts select-mode in the App drawer section', () => {
		const button = defaultDrawerButtons.find((candidate) => candidate.id === 'select-mode')
		expect(button?.label).toBe('Select')
		expect(button?.action).toEqual({ type: 'select-mode' })
		expect(button?.section).toBe('App')
	})

	test('starts with agent keys before herdr', () => {
		const expected = [
			{ section: 'Codex', label: 'Reply', data: '\x1b[1;3A' },
			{ section: 'Codex', label: 'Queue', data: '\t' },
			{ section: 'Codex', label: 'Think−', data: '\x1b,' },
			{ section: 'Codex', label: 'Think+', data: '\x1b.' },
			{ section: 'Codex', label: 'Transcript', data: '\x14' },
			{ section: 'Claude', label: 'Mode', data: '\x1b[Z' },
			{ section: 'Claude', label: 'Verbose', data: '\x0f' },
			{ section: 'Claude', label: 'Tasks', data: '\x14' },
			{ section: 'Claude', label: 'Model', data: '\x1bp' },
			{ section: 'Pi', label: 'Queue', data: '\x1b\r' },
			{ section: 'Pi', label: 'Think', data: '\x1b[Z' },
			{ section: 'Pi', label: 'Model', data: '\x10' },
			{ section: 'Pi', label: 'Expand', data: '\x0f' },
		]
		expect(
			defaultDrawerButtons.slice(0, 13).map(({ section, label, action }) => ({
				section,
				label,
				data: action.type === 'send' ? action.data : undefined,
			})),
		).toEqual(expected)
		expect(defaultDrawerButtons[13]?.section).toBe('herdr')
	})
})

describe('defaultRow2', () => {
	test('is empty — the toolbar is a single row by default', () => {
		expect(defaultRow2).toEqual([])
	})
})
