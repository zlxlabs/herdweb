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

	test.each(['S-Enter', 'S-Up', 'S-F8', 'C-S-Tab'])(
		'rejects unsupported Shift combination %s',
		(value) => {
			expect(parseComboInput(value)).toEqual({
				ok: false,
				error: expect.stringContaining('Shift'),
			})
		},
	)

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

		expect(picker.element.querySelector('.wt-combo-error')?.textContent).toContain('Shift')
		expect(sent).toEqual([])
		expect(picker.element.style.display).toBe('flex')
	})
})
