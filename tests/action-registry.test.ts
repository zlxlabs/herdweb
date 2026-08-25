import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
	FONT_SIZE_STORAGE_KEY,
	createActionRegistry,
	createDefaultActionRegistry,
} from '../src/actions/registry'
import { defaultConfig } from '../src/config'
import type { ButtonAction, XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

describe('createActionRegistry', () => {
	test('fails loud for unregistered action', async () => {
		const registry = createActionRegistry()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(
			registry.execute(
				{ type: 'send', data: 'x' },
				{
					term: mockTerminal(),
					kbWasOpen: false,
					focusIfNeeded() {},
					async sendText(_data: string) {},
				},
			),
		).rejects.toThrow('herdweb: no handler registered for action type "send"')
		expect(errorSpy).toHaveBeenCalled()
	})

	test('runs registered handler', async () => {
		const registry = createActionRegistry()
		let handled = false
		registry.register('send', () => {
			handled = true
		})

		const executed = await registry.execute(
			{ type: 'send', data: 'x' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
			},
		)

		expect(executed).toBe(true)
		expect(handled).toBe(true)
	})

	test('serialises execution order for async handlers', async () => {
		const registry = createActionRegistry()
		const sent: string[] = []

		registry.register('send', async (action, context) => {
			if (action.type !== 'send') return
			if (action.data === 'q') {
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
			await context.sendText(action.data)
		})

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				sent.push(data)
			},
		}

		const first = registry.execute({ type: 'send', data: 'q' }, context)
		const second = registry.execute({ type: 'send', data: ' ' }, context)
		await Promise.all([first, second])

		expect(sent).toEqual(['q', ' '])
	})

	test('non-send actions do not block send actions', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		let resolveClipboard: ((value: string) => void) | undefined

		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: () =>
					new Promise<string>((resolve) => {
						resolveClipboard = resolve
					}),
			},
			configurable: true,
		})

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				sent.push(data)
			},
		}

		const pastePromise = registry.execute({ type: 'paste' }, context)
		await registry.execute({ type: 'send', data: 'q' }, context)

		expect(sent).toEqual(['q'])
		if (resolveClipboard) {
			resolveClipboard('abc')
		}
		await pastePromise
		expect(sent).toEqual(['q', 'abc'])
	})

	test('preserves click order when send is delayed and paste follows', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []

		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: async () => 'abc',
			},
			configurable: true,
		})

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				if (data === 'q') {
					await new Promise((resolve) => setTimeout(resolve, 10))
				}
				sent.push(data)
			},
			async sendRawText(data: string) {
				sent.push(data)
			},
		}

		const first = registry.execute({ type: 'send', data: 'q' }, context)
		const second = registry.execute({ type: 'paste' }, context)
		await Promise.all([first, second])

		expect(sent).toEqual(['q', 'abc'])
	})

	test('preserves order for consecutive paste actions', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		const pending: Array<(value: string) => void> = []

		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: () =>
					new Promise<string>((resolve) => {
						pending.push(resolve)
					}),
			},
			configurable: true,
		})

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				sent.push(data)
			},
		}

		const first = registry.execute({ type: 'paste' }, context)
		const second = registry.execute({ type: 'paste' }, context)
		for (let attempt = 0; attempt < 5 && pending.length < 2; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 0))
		}

		const firstResolver = pending[0]
		if (firstResolver) firstResolver('first')
		await new Promise((resolve) => setTimeout(resolve, 0))

		const secondResolver = pending[1]
		if (secondResolver) secondResolver('second')
		await Promise.all([first, second])

		expect(sent).toEqual(['first', 'second'])
	})

	test('paste execute resolves after clipboard send completes', async () => {
		const registry = createDefaultActionRegistry()
		let resolveClipboard: ((value: string) => void) | undefined
		let sent = ''

		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: () =>
					new Promise<string>((resolve) => {
						resolveClipboard = resolve
					}),
			},
			configurable: true,
		})

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				sent = data
			},
		}

		let done = false
		const pastePromise = registry.execute({ type: 'paste' }, context).then(() => {
			done = true
		})

		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(done).toBe(false)
		const resolver = resolveClipboard
		if (resolver) {
			resolver('abc')
		}
		await pastePromise
		expect(done).toBe(true)
		expect(sent).toBe('abc')
	})
})

describe('createDefaultActionRegistry', () => {
	test('send action forwards data then focuses', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		let focused = false
		const action: ButtonAction = { type: 'send', data: 'abc' }

		await registry.execute(action, {
			term: mockTerminal(),
			kbWasOpen: true,
			focusIfNeeded() {
				focused = true
			},
			async sendText(data: string) {
				sent.push(data)
			},
		})

		expect(sent).toEqual(['abc'])
		expect(focused).toBe(true)
	})

	test('drawer-toggle calls openDrawer when available', async () => {
		const registry = createDefaultActionRegistry()
		let opened = false

		await registry.execute(
			{ type: 'drawer-toggle' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
				openDrawer() {
					opened = true
				},
			},
		)

		expect(opened).toBe(true)
	})

	test('ctrl-modifier falls back to focus when toggle unavailable', async () => {
		const registry = createDefaultActionRegistry()
		let focused = false

		await registry.execute(
			{ type: 'ctrl-modifier' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {
					focused = true
				},
				async sendText(_data: string) {},
			},
		)

		expect(focused).toBe(true)
	})

	test('paste failure surfaces a toast and restores focus (fail-loud, not silent)', async () => {
		const toasts: string[] = []
		const registry = createDefaultActionRegistry()
		let focused = false
		let sent = false

		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: async () => {
					throw new Error('Permission denied')
				},
			},
			configurable: true,
		})

		await expect(
			registry.execute(
				{ type: 'paste' },
				{
					term: mockTerminal(),
					kbWasOpen: true,
					focusIfNeeded() {
						focused = true
					},
					async sendText(_data: string) {
						sent = true
					},
					showToast(message: string) {
						toasts.push(message)
					},
				},
			),
		).resolves.toBe(true)

		expect(toasts).toEqual(['Paste failed — clipboard read was denied.'])
		expect(focused).toBe(true)
		expect(sent).toBe(false)
	})

	test('paste without clipboard API surfaces a toast and restores focus', async () => {
		const toasts: string[] = []
		const registry = createDefaultActionRegistry()
		let focused = false

		Object.defineProperty(navigator, 'clipboard', {
			value: undefined,
			configurable: true,
		})

		await registry.execute(
			{ type: 'paste' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {
					focused = true
				},
				async sendText(_data: string) {},
				showToast(message: string) {
					toasts.push(message)
				},
			},
		)

		expect(toasts).toEqual(['Paste unavailable — no clipboard access in this browser.'])
		expect(focused).toBe(true)
	})

	test('paste falls back to the registry-deps toast when the context has none', async () => {
		const toasts: string[] = []
		const registry = createDefaultActionRegistry({
			showToast(message: string) {
				toasts.push(message)
			},
		})

		Object.defineProperty(navigator, 'clipboard', {
			value: undefined,
			configurable: true,
		})

		await registry.execute(
			{ type: 'paste' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
			},
		)

		expect(toasts).toEqual(['Paste unavailable — no clipboard access in this browser.'])
	})

	test('empty clipboard stays silent (no toast, no send, focus restored)', async () => {
		const toasts: string[] = []
		const registry = createDefaultActionRegistry()
		let focused = false
		let sent = false

		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => '' },
			configurable: true,
		})

		await registry.execute(
			{ type: 'paste' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {
					focused = true
				},
				async sendText(_data: string) {
					sent = true
				},
				showToast(message: string) {
					toasts.push(message)
				},
			},
		)

		expect(toasts).toEqual([])
		expect(sent).toBe(false)
		expect(focused).toBe(true)
	})

	test('combo-picker opens picker with raw sender when available', async () => {
		const registry = createDefaultActionRegistry()
		let opened = false
		let sent = ''

		await registry.execute(
			{ type: 'combo-picker' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(data: string) {
					sent = `normal:${data}`
				},
				async sendRawText(data: string) {
					sent = `raw:${data}`
				},
				openComboPicker(options) {
					opened = true
					void options.sendText('abc')
				},
			},
		)

		expect(opened).toBe(true)
		expect(sent).toBe('raw:abc')
	})

	test('prefix action sends data then opens combo picker', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		let pickerOptions: { title?: string; description?: string } | null = null

		await registry.execute(
			{ type: 'prefix', data: '\x02' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(data: string) {
					sent.push(data)
				},
				openComboPicker(options) {
					pickerOptions = options
				},
			},
		)

		expect(sent).toEqual(['\x02'])
		expect(pickerOptions).toMatchObject({
			title: expect.stringContaining('Ctrl-B'),
			description: expect.stringContaining('C-x = Ctrl+x'),
		})
	})

	test('prefix action falls back to focus when picker unavailable', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		let focused = false

		await registry.execute(
			{ type: 'prefix', data: '\x02' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {
					focused = true
				},
				async sendText(data: string) {
					sent.push(data)
				},
			},
		)

		expect(sent).toEqual(['\x02'])
		expect(focused).toBe(true)
	})

	test('prefix action serialises with send queue', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				if (data === '\x02') {
					await new Promise((resolve) => setTimeout(resolve, 10))
				}
				sent.push(data)
			},
			openComboPicker() {},
		}

		const first = registry.execute({ type: 'prefix', data: '\x02' }, context)
		const second = registry.execute({ type: 'send', data: 'q' }, context)
		await Promise.all([first, second])

		expect(sent).toEqual(['\x02', 'q'])
	})

	test('prefix combo follow-up uses raw sender', async () => {
		const registry = createDefaultActionRegistry()
		let sent = ''
		let comboPromise: Promise<void> | null = null

		await registry.execute(
			{ type: 'prefix', data: '\x02' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
				async sendRawText(data: string) {
					sent = `raw:${data}`
				},
				openComboPicker(options) {
					comboPromise = options.sendText('r')
				},
			},
		)

		if (comboPromise) {
			await comboPromise
		}
		expect(sent).toBe('raw:r')
	})

	test('combo-picker falls back to focus when picker unavailable', async () => {
		const registry = createDefaultActionRegistry()
		let focused = false

		await registry.execute(
			{ type: 'combo-picker' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {
					focused = true
				},
				async sendText(_data: string) {},
			},
		)

		expect(focused).toBe(true)
	})

	test('combo-picker queued sends preserve existing send order', async () => {
		const registry = createDefaultActionRegistry()
		const sent: string[] = []
		let comboPromise: Promise<void> | null = null

		const context = {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(data: string) {
				if (data === 'q') {
					await new Promise((resolve) => setTimeout(resolve, 10))
				}
				sent.push(data)
			},
			openComboPicker(options: { sendText: (data: string) => Promise<void> }) {
				comboPromise = options.sendText('x')
			},
		}

		const first = registry.execute({ type: 'send', data: 'q' }, context)
		await registry.execute({ type: 'combo-picker' }, context)
		if (comboPromise) {
			await comboPromise
		}
		await first

		expect(sent).toEqual(['q', 'x'])
	})
})

describe('dpad-toggle action', () => {
	function makeContext() {
		return {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(_data: string) {},
		}
	}

	test('calls the injected toggleDpad callback (registry deps)', async () => {
		const toggleDpad = vi.fn()
		const registry = createDefaultActionRegistry({ toggleDpad })

		const executed = await registry.execute({ type: 'dpad-toggle' }, makeContext())

		expect(executed).toBe(true)
		expect(toggleDpad).toHaveBeenCalledTimes(1)
	})

	test('context.toggleDpad takes precedence over registry deps', async () => {
		const depsToggle = vi.fn()
		const contextToggle = vi.fn()
		const registry = createDefaultActionRegistry({ toggleDpad: depsToggle })

		await registry.execute({ type: 'dpad-toggle' }, { ...makeContext(), toggleDpad: contextToggle })

		expect(contextToggle).toHaveBeenCalledTimes(1)
		expect(depsToggle).not.toHaveBeenCalled()
	})

	test('fails loud when no toggleDpad callback is available', async () => {
		const registry = createDefaultActionRegistry()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(registry.execute({ type: 'dpad-toggle' }, makeContext())).rejects.toThrow(
			'herdweb: dpad-toggle action requires a toggleDpad callback',
		)
		expect(errorSpy).toHaveBeenCalled()
	})
})

describe('font-size action', () => {
	function makeContext(term: XTerminal, focused: { value: boolean }) {
		return {
			term,
			kbWasOpen: true,
			focusIfNeeded() {
				focused.value = true
			},
			async sendText(_data: string) {},
		}
	}

	test('applies delta, resizes and restores focus', async () => {
		const registry = createDefaultActionRegistry({ font: defaultConfig.font })
		const term = mockTerminal()
		const focused = { value: false }
		const resizeSpy = vi.fn()
		window.__herdwebResize = resizeSpy

		const executed = await registry.execute(
			{ type: 'font-size', delta: 2 },
			makeContext(term, focused),
		)

		expect(executed).toBe(true)
		expect(term.options.fontSize).toBe(16)
		expect(resizeSpy).toHaveBeenCalledTimes(1)
		expect(focused.value).toBe(true)
		// Persisted so a reload keeps the adjusted size
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('16')

		window.__herdwebResize = undefined
	})

	test('does not write localStorage when the size is unchanged (clamped)', async () => {
		const registry = createDefaultActionRegistry({ font: defaultConfig.font })
		const term = mockTerminal()
		term.options.fontSize = 32
		const focused = { value: false }
		window.__herdwebResize = () => {}

		await registry.execute({ type: 'font-size', delta: 2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(32)
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull()

		window.__herdwebResize = undefined
	})

	test('survives localStorage write failures (iOS private mode) — logs and continues', async () => {
		const registry = createDefaultActionRegistry({ font: defaultConfig.font })
		const term = mockTerminal()
		const focused = { value: false }
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError')
		})
		window.__herdwebResize = () => {}

		await registry.execute({ type: 'font-size', delta: 2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(16)
		expect(errorSpy).toHaveBeenCalled()

		window.__herdwebResize = undefined
	})

	test('clamps at sizeRange upper bound and stops resizing at the cap', async () => {
		const registry = createDefaultActionRegistry({ font: defaultConfig.font })
		const term = mockTerminal()
		term.options.fontSize = 31
		const focused = { value: false }
		const resizeSpy = vi.fn()
		window.__herdwebResize = resizeSpy

		await registry.execute({ type: 'font-size', delta: 2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(32)
		expect(resizeSpy).toHaveBeenCalledTimes(1)

		await registry.execute({ type: 'font-size', delta: 2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(32)
		expect(resizeSpy).toHaveBeenCalledTimes(1)

		window.__herdwebResize = undefined
	})

	test('clamps at sizeRange lower bound and stops resizing at the floor', async () => {
		const registry = createDefaultActionRegistry({ font: defaultConfig.font })
		const term = mockTerminal()
		term.options.fontSize = 9
		const focused = { value: false }
		const resizeSpy = vi.fn()
		window.__herdwebResize = resizeSpy

		await registry.execute({ type: 'font-size', delta: -2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(8)
		expect(resizeSpy).toHaveBeenCalledTimes(1)

		await registry.execute({ type: 'font-size', delta: -2 }, makeContext(term, focused))
		expect(term.options.fontSize).toBe(8)
		expect(resizeSpy).toHaveBeenCalledTimes(1)

		window.__herdwebResize = undefined
	})

	test('context.font takes precedence over registry deps', async () => {
		const depsFont = { ...defaultConfig.font, sizeRange: [20, 24] as readonly [number, number] }
		const registry = createDefaultActionRegistry({ font: depsFont })
		const term = mockTerminal()
		term.options.fontSize = 10
		const focused = { value: false }
		window.__herdwebResize = () => {}

		await registry.execute(
			{ type: 'font-size', delta: 2 },
			{ ...makeContext(term, focused), font: defaultConfig.font },
		)

		// context.font range [8, 32] applies — deps range [20, 24] would clamp to 20
		expect(term.options.fontSize).toBe(12)

		window.__herdwebResize = undefined
	})

	test('fails loud when no font config is available', async () => {
		const registry = createDefaultActionRegistry()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const focused = { value: false }

		await expect(
			registry.execute({ type: 'font-size', delta: 2 }, makeContext(mockTerminal(), focused)),
		).rejects.toThrow('herdweb: font-size action requires a FontConfig')
		expect(errorSpy).toHaveBeenCalled()
		expect(focused.value).toBe(false)
	})
})

describe('image-upload action', () => {
	function makeContext() {
		return {
			term: mockTerminal(),
			kbWasOpen: false,
			focusIfNeeded() {},
			async sendText(_data: string) {},
		}
	}

	test('calls the injected openImageDrop callback (registry deps)', async () => {
		const openImageDrop = vi.fn()
		const registry = createDefaultActionRegistry({ openImageDrop })

		const executed = await registry.execute({ type: 'image-upload' }, makeContext())

		expect(executed).toBe(true)
		expect(openImageDrop).toHaveBeenCalledTimes(1)
	})

	test('fails loud when no openImageDrop callback is available', async () => {
		const registry = createDefaultActionRegistry()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(registry.execute({ type: 'image-upload' }, makeContext())).rejects.toThrow(
			'herdweb: image-upload action requires an openImageDrop callback',
		)
		expect(errorSpy).toHaveBeenCalled()
	})
})

describe('help action', () => {
	test('calls the injected openHelp callback', async () => {
		const openHelp = vi.fn()
		const registry = createDefaultActionRegistry({ openHelp })

		const executed = await registry.execute(
			{ type: 'help' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
			},
		)

		expect(executed).toBe(true)
		expect(openHelp).toHaveBeenCalledTimes(1)
	})

	test('context.openHelp takes precedence over registry deps', async () => {
		const depsOpenHelp = vi.fn()
		const contextOpenHelp = vi.fn()
		const registry = createDefaultActionRegistry({ openHelp: depsOpenHelp })

		await registry.execute(
			{ type: 'help' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded() {},
				async sendText(_data: string) {},
				openHelp: contextOpenHelp,
			},
		)

		expect(contextOpenHelp).toHaveBeenCalledTimes(1)
		expect(depsOpenHelp).not.toHaveBeenCalled()
	})

	test('fails loud when no openHelp callback is available', async () => {
		const registry = createDefaultActionRegistry()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(
			registry.execute(
				{ type: 'help' },
				{
					term: mockTerminal(),
					kbWasOpen: false,
					focusIfNeeded() {},
					async sendText(_data: string) {},
				},
			),
		).rejects.toThrow('herdweb: help action requires an openHelp callback')
		expect(errorSpy).toHaveBeenCalled()
	})
})
