import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createComboPicker, parseComboInput } from '../src/controls/combo-picker'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('createComboPicker', () => {
	test('open with custom title and description sets DOM text', () => {
		const picker = createComboPicker()
		document.body.appendChild(picker.element)

		picker.open({
			async sendText() {},
			focusIfNeeded() {},
			title: 'After prefix',
			description: 'Examples: r (reload), c (new window)',
		})

		const title = picker.element.querySelector('h3')
		const desc = picker.element.querySelector('p')
		expect(title?.textContent).toBe('After prefix')
		expect(desc?.textContent).toBe('Examples: r (reload), c (new window)')
	})

	test('open without custom title uses defaults', () => {
		const picker = createComboPicker()
		document.body.appendChild(picker.element)

		picker.open({
			async sendText() {},
			focusIfNeeded() {},
		})

		const title = picker.element.querySelector('h3')
		const desc = picker.element.querySelector('p')
		expect(title?.textContent).toBe('Send combo')
		expect(desc?.textContent).toBe('Examples: C-s, C-[, M-Enter, Alt-x')
	})

	test('close resets title and description to defaults', () => {
		const picker = createComboPicker()
		document.body.appendChild(picker.element)

		picker.open({
			async sendText() {},
			focusIfNeeded() {},
			title: 'Custom',
			description: 'Custom desc',
		})
		picker.close()

		const title = picker.element.querySelector('h3')
		const desc = picker.element.querySelector('p')
		expect(title?.textContent).toBe('Send combo')
		expect(desc?.textContent).toBe('Examples: C-s, C-[, M-Enter, Alt-x')
	})
})

describe('parseComboInput', () => {
	test('parses Ctrl letter combos', () => {
		const parsed = parseComboInput('C-s')
		expect(parsed).toEqual({ ok: true, data: '\x13' })
	})

	test('parses Alt+Enter', () => {
		const parsed = parseComboInput('Alt+Enter')
		expect(parsed).toEqual({ ok: true, data: '\x1b\r' })
	})

	test('parses Ctrl bracket aliases', () => {
		const parsed = parseComboInput('Ctrl-[')
		expect(parsed).toEqual({ ok: true, data: '\x1b' })
	})

	test('parses Ctrl-minus', () => {
		const parsed = parseComboInput('C--')
		expect(parsed).toEqual({ ok: true, data: '\x1f' })
	})

	test('rejects unsupported Ctrl special keys', () => {
		const parsed = parseComboInput('Ctrl-Enter')
		expect(parsed.ok).toBe(false)
	})

	test('parses Shift+Tab as the terminal reverse-tab sequence', () => {
		expect(parseComboInput('S-Tab')).toEqual({ ok: true, data: '\x1b[Z' })
	})

	test('uppercases a single shifted letter after other supported modifiers', () => {
		expect(parseComboInput('S-a')).toEqual({ ok: true, data: 'A' })
		expect(parseComboInput('M-S-a')).toEqual({ ok: true, data: '\x1bA' })
	})

	test('picker sends Shift+Tab as reverse-tab', () => {
		const picker = createComboPicker()
		document.body.appendChild(picker.element)
		const sent: string[] = []
		picker.open({
			async sendText(data) {
				sent.push(data)
			},
			focusIfNeeded() {},
		})

		const input = picker.element.querySelector<HTMLInputElement>('input')
		const sendButton = picker.element.querySelector<HTMLButtonElement>('button:last-child')
		if (!input || !sendButton) throw new Error('combo picker controls are missing')
		input.value = 'S-Tab'
		sendButton.click()

		expect(sent).toEqual(['\x1b[Z'])
	})

	test.each(['C-S-Tab'])('rejects unsupported Shift combination %s', (value) => {
		expect(parseComboInput(value)).toEqual({
			ok: false,
			error: expect.stringContaining('Shift'),
		})
	})

	test('shows an unsupported Shift error in the picker without sending', async () => {
		const picker = createComboPicker()
		document.body.appendChild(picker.element)
		const sent: string[] = []
		picker.open({
			async sendText(data) {
				sent.push(data)
			},
			focusIfNeeded() {},
		})

		const input = picker.element.querySelector('input')
		const sendButton = picker.element.querySelector<HTMLButtonElement>('button:last-child')
		if (!input || !sendButton) throw new Error('combo picker controls are missing')
		input.value = 'S-Enter'
		sendButton.click()

		expect(picker.element.querySelector('.wt-combo-error')?.textContent).toContain(
			'hold ⏎ on the d-pad for a newline',
		)
		expect(sent).toEqual([])
		expect(picker.element.style.display).toBe('flex')
	})

	test('encodes M-Up as xterm CSI 1;3A instead of a double-ESC prefix', () => {
		expect(parseComboInput('M-Up')).toEqual({ ok: true, data: '\x1b[1;3A' })
	})

	test('encodes C-Home as CSI 1;5H', () => {
		expect(parseComboInput('C-Home')).toEqual({ ok: true, data: '\x1b[1;5H' })
	})

	test('encodes S-Up as CSI 1;2A', () => {
		expect(parseComboInput('S-Up')).toEqual({ ok: true, data: '\x1b[1;2A' })
	})

	test('encodes C-Left as CSI 1;5D', () => {
		expect(parseComboInput('C-Left')).toEqual({ ok: true, data: '\x1b[1;5D' })
	})

	test('encodes C-End as CSI 1;5F', () => {
		expect(parseComboInput('C-End')).toEqual({ ok: true, data: '\x1b[1;5F' })
	})

	test('encodes C-PgUp as CSI 5;5~', () => {
		expect(parseComboInput('C-PgUp')).toEqual({ ok: true, data: '\x1b[5;5~' })
	})

	test('encodes S-PgDn as CSI 6;2~', () => {
		expect(parseComboInput('S-PgDn')).toEqual({ ok: true, data: '\x1b[6;2~' })
	})

	test('encodes unmodified F1-F4 as SS3 and F5-F12 as CSI n~', () => {
		expect(parseComboInput('F1')).toEqual({ ok: true, data: '\x1bOP' })
		expect(parseComboInput('F4')).toEqual({ ok: true, data: '\x1bOS' })
		expect(parseComboInput('F5')).toEqual({ ok: true, data: '\x1b[15~' })
		expect(parseComboInput('F8')).toEqual({ ok: true, data: '\x1b[19~' })
		expect(parseComboInput('F12')).toEqual({ ok: true, data: '\x1b[24~' })
	})

	test('encodes modified F1-F4 as CSI 1;m P/Q/R/S and F5-F12 as CSI n;m~', () => {
		expect(parseComboInput('C-F1')).toEqual({ ok: true, data: '\x1b[1;5P' })
		expect(parseComboInput('M-F4')).toEqual({ ok: true, data: '\x1b[1;3S' })
		expect(parseComboInput('C-F8')).toEqual({ ok: true, data: '\x1b[19;5~' })
		expect(parseComboInput('S-F8')).toEqual({ ok: true, data: '\x1b[19;2~' })
	})

	test('S-Enter stays rejected and tells the user to long-press d-pad ⏎', () => {
		const parsed = parseComboInput('S-Enter')
		expect(parsed.ok).toBe(false)
		if (parsed.ok) throw new Error('expected S-Enter to stay rejected')
		expect(parsed.error).toContain('hold ⏎ on the d-pad for a newline')
	})

	test('single-character Alt and Ctrl encodings stay unchanged', () => {
		expect(parseComboInput('M-,')).toEqual({ ok: true, data: '\x1b,' })
		expect(parseComboInput('C-t')).toEqual({ ok: true, data: '\x14' })
	})
})
