import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultActionRegistry } from '../src/actions/registry'
import { defaultConfig, defineConfig } from '../src/config'
import { createAsrPreview } from '../src/controls/asr-preview'
import { createFloatingButtons } from '../src/controls/floating-buttons'
import { createHelpOverlay } from '../src/controls/help'
import type { MicController } from '../src/controls/mic-controller'
import { createDrawer } from '../src/drawer/drawer'
import { createHookRegistry } from '../src/hooks/registry'
import { createToolbar } from '../src/toolbar/toolbar'
import type { ControlButton } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('toolbar integration', () => {
	test('creates a single-row toolbar by default (empty row2 is not rendered)', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const drawer = createDrawer(term, defaultConfig.drawer.buttons, {
			hooks,
			appConfig: defaultConfig,
		})
		const { element: toolbar } = createToolbar(term, defaultConfig, drawer.open, hooks)

		document.body.appendChild(toolbar)

		expect(toolbar.id).toBe('wt-toolbar')
		expect(defaultConfig.toolbar.row2).toHaveLength(0)
		const rows = toolbar.querySelectorAll('.wt-row')
		expect(rows).toHaveLength(1)
		// The single row is both :first-child and :last-child — the landscape
		// wt-kb-open hide rule must not match it (guarded by :not(:first-child))
		expect(rows[0]?.matches('.wt-row:first-child:last-child')).toBe(true)
	})

	test('row1 renders every default button except voice-input without a micController', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const drawer = createDrawer(term, defaultConfig.drawer.buttons, {
			hooks,
			appConfig: defaultConfig,
		})
		const { element: toolbar } = createToolbar(term, defaultConfig, drawer.open, hooks)

		document.body.appendChild(toolbar)

		const row1 = toolbar.querySelector('.wt-row')
		const buttons = row1?.querySelectorAll('button')
		// voice-input is on default row1 but stays hidden until ASR is available
		expect(buttons?.length).toBe(defaultConfig.toolbar.row1.length - 1)
		expect(toolbar.querySelector('[data-herdweb-button-id="voice-input"]')).toBeNull()
	})

	test('row1 renders the voice-input button when a micController is wired', () => {
		const micController: MicController = {
			preview: createAsrPreview({ defaultTargetId: 'default' }),
			state: 'idle',
			attachComposerToggle() {},
			attachMicButton() {},
			setTarget() {},
			dispose() {},
		}
		const { element: toolbar } = createToolbar(
			mockTerminal(),
			defaultConfig,
			() => {},
			createHookRegistry(),
			undefined,
			undefined,
			micController,
		)

		document.body.appendChild(toolbar)

		const row1 = toolbar.querySelector('.wt-row')
		expect(row1?.querySelectorAll('button').length).toBe(defaultConfig.toolbar.row1.length)
		expect(toolbar.querySelector('[data-herdweb-button-id="voice-input"]')).not.toBeNull()
	})

	test('renders voice input as an icon button with the mic class', () => {
		const config = defineConfig({
			asr: { enabled: true, doubao: { apiKey: 'test-key' } },
			toolbar: {
				row1: [
					{
						id: 'mic',
						label: 'Mic',
						description: 'Tap to speak',
						action: { type: 'voice-input' },
					},
				],
			},
		})
		const micController: MicController = {
			preview: createAsrPreview({ defaultTargetId: 'default' }),
			state: 'idle',
			attachComposerToggle() {},
			attachMicButton() {},
			setTarget() {},
			dispose() {},
		}
		const { element: toolbar } = createToolbar(
			mockTerminal(),
			config,
			() => {},
			createHookRegistry(),
			undefined,
			undefined,
			micController,
		)

		const button = toolbar.querySelector('button')
		expect(button?.classList.contains('wt-mic')).toBe(true)
		expect(button?.querySelector('svg')).not.toBeNull()
		expect(button?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
		expect(button?.textContent).toBe('')
	})

	test('a non-empty row2 renders as a second row (empty rows are skipped)', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const config: typeof defaultConfig = {
			...defaultConfig,
			toolbar: {
				...defaultConfig.toolbar,
				row2: [
					{
						id: 'q',
						label: 'q',
						description: 'Send q key',
						action: { type: 'send', data: 'q' },
					},
				],
			},
		}
		const drawer = createDrawer(term, config.drawer.buttons, {
			hooks,
			appConfig: config,
		})
		const { element: toolbar } = createToolbar(term, config, drawer.open, hooks)

		document.body.appendChild(toolbar)

		const rows = toolbar.querySelectorAll('.wt-row')
		expect(rows).toHaveLength(2)
		const row2 = rows[1]
		expect(row2?.querySelectorAll('button')).toHaveLength(1)
	})
})

describe('drawer integration', () => {
	test('renders all commands as buttons', () => {
		const term = mockTerminal()
		const { drawer } = createDrawer(term, defaultConfig.drawer.buttons, {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
		})

		document.body.appendChild(drawer)

		const grid = drawer.querySelector('#wt-drawer-grid')
		const buttons = grid?.querySelectorAll('button')
		expect(buttons?.length).toBe(defaultConfig.drawer.buttons.length)
	})

	test('open/close toggles state', () => {
		const term = mockTerminal()
		const result = createDrawer(term, defaultConfig.drawer.buttons, {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
		})

		document.body.appendChild(result.backdrop)
		document.body.appendChild(result.drawer)

		expect(result.isOpen()).toBe(false)

		result.open()
		expect(result.isOpen()).toBe(true)
		expect(result.drawer.classList.contains('open')).toBe(true)

		result.close()
		expect(result.isOpen()).toBe(false)
		expect(result.drawer.classList.contains('open')).toBe(false)
	})

	test('has no tab bar', () => {
		const term = mockTerminal()
		const { drawer } = createDrawer(term, defaultConfig.drawer.buttons, {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
		})

		document.body.appendChild(drawer)

		const tabs = drawer.querySelector('#wt-drawer-tabs')
		expect(tabs).toBeNull()
	})
})

describe('drawer close behaviour', () => {
	beforeEach(() => {
		_resetTouchGuard()
	})

	function openDrawerWith(buttons: readonly ControlButton[]) {
		const term = mockTerminal()
		const actions = createDefaultActionRegistry({
			font: defaultConfig.font,
			openHelp: () => {},
		})
		const result = createDrawer(term, buttons, {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
			actions,
		})
		document.body.appendChild(result.backdrop)
		document.body.appendChild(result.drawer)
		result.open()
		expect(result.isOpen()).toBe(true)
		return result
	}

	async function tapGridButton(drawer: HTMLElement, index: number): Promise<void> {
		const button = drawer.querySelectorAll('#wt-drawer-grid button')[index]
		button?.dispatchEvent(new Event('touchend', { bubbles: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	test('font-size actions keep the drawer open (repeat taps)', async () => {
		window.__herdwebResize = () => {}
		const result = openDrawerWith([
			{
				id: 'font-decrease',
				label: 'Font −',
				description: 'Decrease font size',
				action: { type: 'font-size', delta: -2 },
			},
			{
				id: 'font-increase',
				label: 'Font +',
				description: 'Increase font size',
				action: { type: 'font-size', delta: 2 },
			},
		])

		await tapGridButton(result.drawer, 0)
		expect(result.isOpen()).toBe(true)
		await tapGridButton(result.drawer, 1)
		expect(result.isOpen()).toBe(true)

		window.__herdwebResize = undefined
	})

	test('help action keeps the drawer open', async () => {
		const result = openDrawerWith([
			{
				id: 'guide',
				label: 'Guide',
				description: 'Open the herdweb help guide',
				action: { type: 'help' },
			},
		])

		await tapGridButton(result.drawer, 0)
		expect(result.isOpen()).toBe(true)
	})

	test('send actions still close the drawer', async () => {
		const result = openDrawerWith([
			{
				id: 'zoom',
				label: 'Zoom',
				description: 'Toggle pane zoom',
				action: { type: 'send', data: '\x02z' },
			},
		])

		await tapGridButton(result.drawer, 0)
		expect(result.isOpen()).toBe(false)
	})
})

describe('help overlay integration', () => {
	beforeEach(() => {
		_resetTouchGuard()
	})

	test('creates help overlay', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig)

		document.body.appendChild(element)

		expect(element.id).toBe('wt-help')
		expect(element.innerHTML).toContain('Drawer Buttons')
		expect(element.innerHTML).toContain('Gestures')
	})

	test('shows version when provided', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig, '1.2.3')

		document.body.appendChild(element)

		const versionEl = element.querySelector('.wt-help-version')
		expect(versionEl).not.toBeNull()
		expect(versionEl?.textContent).toBe('herdweb v1.2.3')
	})

	test('shows dev version with hash', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig, '0.2.6-dev+abc1234')

		expect(element.innerHTML).toContain('herdweb v0.2.6-dev+abc1234')
	})

	test('omits version when not provided', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig)

		expect(element.querySelector('.wt-help-version')).toBeNull()
	})

	test('help action in drawer opens the overlay', async () => {
		const term = mockTerminal()
		const { element: overlay, open } = createHelpOverlay(term, defaultConfig)
		document.body.appendChild(overlay)

		const actions = createDefaultActionRegistry({ font: defaultConfig.font, openHelp: open })
		const guideButton: ControlButton = {
			id: 'guide',
			label: 'Guide',
			description: 'Open the herdweb help guide',
			action: { type: 'help' },
		}
		const { backdrop, drawer } = createDrawer(term, [guideButton], {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
			actions,
		})
		document.body.appendChild(backdrop)
		document.body.appendChild(drawer)

		const button = drawer.querySelector('#wt-drawer-grid button')
		expect(button?.textContent).toBe('Guide')
		button?.dispatchEvent(new Event('touchend', { bubbles: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(overlay.style.display).toBe('block')
	})

	test('failed action marks the drawer button with an error state', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const term = mockTerminal()
		// No openHelp dep — executing the help action must fail loud
		const actions = createDefaultActionRegistry({ font: defaultConfig.font })
		const guideButton: ControlButton = {
			id: 'guide',
			label: 'Guide',
			description: 'Open the herdweb help guide',
			action: { type: 'help' },
		}
		const { backdrop, drawer } = createDrawer(term, [guideButton], {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
			actions,
		})
		document.body.appendChild(backdrop)
		document.body.appendChild(drawer)

		const button = drawer.querySelector('#wt-drawer-grid button')
		expect(button?.classList.contains('wt-action-error')).toBe(false)
		button?.dispatchEvent(new Event('touchend', { bubbles: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(errorSpy).toHaveBeenCalled()
		expect(button?.classList.contains('wt-action-error')).toBe(true)
		errorSpy.mockRestore()
	})

	test('synthesised click after touchend does not immediately close overlay', async () => {
		const term = mockTerminal()
		const { element: overlay, open } = createHelpOverlay(term, defaultConfig)
		document.body.appendChild(overlay)

		const actions = createDefaultActionRegistry({ font: defaultConfig.font, openHelp: open })
		const guideButton: ControlButton = {
			id: 'guide',
			label: 'Guide',
			description: 'Open the herdweb help guide',
			action: { type: 'help' },
		}
		const { backdrop, drawer } = createDrawer(term, [guideButton], {
			hooks: createHookRegistry(),
			appConfig: defaultConfig,
			actions,
		})
		document.body.appendChild(backdrop)
		document.body.appendChild(drawer)

		// Simulate touch on the Guide button — touchend opens the overlay
		const button = drawer.querySelector('#wt-drawer-grid button')
		button?.dispatchEvent(new Event('touchend', { bubbles: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(overlay.style.display).toBe('block')

		// Browser synthesises click ~4ms later. On a real device the overlay
		// (higher z-index) now covers the Guide button area, so hit-testing targets
		// the overlay element itself. Simulate this by dispatching click on the
		// overlay with target === overlay.
		overlay.dispatchEvent(new Event('click', { bubbles: true }))

		// Overlay should still be open — the synthesised click must be ignored
		expect(overlay.style.display).toBe('block')
	})

	test('renders configured button descriptions and no stale Claude section', () => {
		const term = mockTerminal()
		const config = {
			...defaultConfig,
			toolbar: {
				...defaultConfig.toolbar,
				row1: [
					{
						id: 'custom-esc',
						label: '<Esc>',
						description: 'Custom escape label',
						action: { type: 'send' as const, data: '\x1b' },
					},
				],
			},
		}
		const { element } = createHelpOverlay(term, config)

		expect(element.innerHTML).toContain('Custom escape label')
		expect(element.innerHTML).toContain('&lt;Esc&gt;')
		expect(element.innerHTML).not.toContain('Claude Drawer Commands')
	})

	test('no longer renders a Top-Right Controls section', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig)

		expect(element.innerHTML).not.toContain('Top-Right Controls')
		// The drawer table covers the moved controls instead
		expect(element.innerHTML).toContain('Guide')
		expect(element.innerHTML).toContain('Decrease font size')
	})

	test('side scroll button rows follow scrollButtons.enabled', () => {
		const term = mockTerminal()

		const off = createHelpOverlay(term, defaultConfig)
		expect(off.element.innerHTML).not.toContain('Side \u25B2')

		const on = createHelpOverlay(term, { ...defaultConfig, scrollButtons: { enabled: true } })
		expect(on.element.innerHTML).toContain('Side \u25B2')
	})
})

describe('build output', () => {
	test('inline script contains no HTML-breaking < chars', async () => {
		const { renderClientHtml } = await import('../build')
		const js = 'var x = "\\x1b[<64;1;1M"; var y = "</script>"'
		const result = renderClientHtml(js, '', defaultConfig, 'test-nonce')

		const scriptMatch = result.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)
		const scriptContent = scriptMatch?.[1] ?? ''
		// No < followed by a letter or / inside the script (would break HTML parsing)
		const dangerousLt = scriptContent.match(/<(?=[a-zA-Z/])/g)
		expect(dangerousLt).toBeNull()
	})

	test('JS containing $& is not corrupted by replacement patterns', async () => {
		const { renderClientHtml } = await import('../build')
		const js = 'String.fromCharCode($&31)'
		const result = renderClientHtml(js, '', defaultConfig, 'test-nonce')

		expect(result).toContain('String.fromCharCode($&31)')
	})

	test('renderClientHtml produces valid HTML with terminal shell', async () => {
		const { renderClientHtml } = await import('../build')
		const js = 'console.log("test")'
		const css = 'body { color: red; }'

		const result = renderClientHtml(js, css, defaultConfig, 'test-nonce')

		expect(result).toContain('<style>')
		expect(result).toContain('<script nonce="test-nonce">')
		expect(result).toContain('viewport')
		expect(result).toContain('jetbrainsmono-nfm.css')
		expect(result).toContain('<link rel="stylesheet"')
		expect(result).toContain('id="terminal-container"')
		expect(result).toContain('id="terminal"')
	})

	test('renderClientHtml includes PWA tags when pwa.enabled', async () => {
		const { renderClientHtml } = await import('../build')

		const result = renderClientHtml('', '', defaultConfig, 'test-nonce')

		expect(result).toContain('rel="manifest"')
		expect(result).toContain('href="/manifest.json"')
		expect(result).toContain('apple-touch-icon')
		expect(result).toContain('theme-color')
	})

	test('renderClientHtml injects prefixed PWA and websocket bootstrap URLs', async () => {
		const { renderClientHtml } = await import('../build')
		const result = renderClientHtml('', '', defaultConfig, 'test-nonce', '/proxy')

		expect(result).toContain('href="/proxy/manifest.json"')
		expect(result).toContain('href="/proxy/apple-touch-icon.png"')
	})

	test('renderClientHtml omits PWA tags when pwa.enabled is false', async () => {
		const { renderClientHtml } = await import('../build')
		const { defineConfig } = await import('../src/config')
		const config = defineConfig({ pwa: { enabled: false } })

		const result = renderClientHtml('', '', config, 'test-nonce')

		expect(result).not.toContain('rel="manifest"')
		expect(result).not.toContain('apple-touch-icon')
	})
})

describe('floating buttons integration', () => {
	test('renders one element per group, buttons within each group', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const actions = createDefaultActionRegistry()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-left' as const,
					buttons: [
						{
							id: 'zoom',
							label: 'Zoom',
							description: 'Toggle pane zoom',
							action: { type: 'send' as const, data: '\x02z' },
						},
						{
							id: 'next',
							label: '›',
							description: 'Next pane',
							action: { type: 'send' as const, data: '\x02]' },
						},
					],
				},
			],
		}

		const { elements } = createFloatingButtons(term, config.floatingButtons, config, hooks, actions)
		expect(elements).toHaveLength(1)
		const el = elements[0] as HTMLDivElement
		document.body.appendChild(el)

		expect(el.classList.contains('wt-floating-group')).toBe(true)
		expect(el.classList.contains('wt-floating-top-left')).toBe(true)
		const buttons = el.querySelectorAll('button')
		expect(buttons).toHaveLength(2)
		expect(buttons[0]?.textContent).toBe('Zoom')
		expect(buttons[1]?.textContent).toBe('›')
	})

	test('multiple groups produce multiple elements', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const actions = createDefaultActionRegistry()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-left' as const,
					buttons: [
						{
							id: 'zoom',
							label: 'Zoom',
							description: 'Toggle pane zoom',
							action: { type: 'send' as const, data: '\x02z' },
						},
					],
				},
				{
					position: 'bottom-right' as const,
					direction: 'column' as const,
					buttons: [
						{
							id: 'next',
							label: '›',
							description: 'Next pane',
							action: { type: 'send' as const, data: '\x02]' },
						},
					],
				},
			],
		}

		const { elements } = createFloatingButtons(term, config.floatingButtons, config, hooks, actions)
		expect(elements).toHaveLength(2)
		expect(elements[0]?.classList.contains('wt-floating-top-left')).toBe(true)
		expect(elements[1]?.classList.contains('wt-floating-bottom-right')).toBe(true)
		expect(elements[1]?.classList.contains('wt-floating-column')).toBe(true)
	})

	test('group without direction has no column class', () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const actions = createDefaultActionRegistry()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-right' as const,
					buttons: [],
				},
			],
		}

		const { elements } = createFloatingButtons(term, config.floatingButtons, config, hooks, actions)
		expect(elements[0]?.classList.contains('wt-floating-column')).toBe(false)
	})

	test('drawer-toggle button calls openDrawer', async () => {
		const term = mockTerminal()
		const hooks = createHookRegistry()
		const actions = createDefaultActionRegistry()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-left' as const,
					buttons: [
						{
							id: 'more',
							label: '☰',
							description: 'Open drawer',
							action: { type: 'drawer-toggle' as const },
						},
					],
				},
			],
		}

		let drawerOpened = false
		const openDrawer = () => {
			drawerOpened = true
		}

		const { elements } = createFloatingButtons(
			term,
			config.floatingButtons,
			config,
			hooks,
			actions,
			openDrawer,
		)
		document.body.appendChild(elements[0] as HTMLDivElement)

		const button = elements[0]?.querySelector('button') as HTMLButtonElement
		button.click()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(drawerOpened).toBe(true)
	})

	test('single group shows "Floating Buttons" in help overlay', () => {
		const term = mockTerminal()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-left' as const,
					buttons: [
						{
							id: 'zoom',
							label: 'Zoom',
							description: 'Toggle pane zoom',
							action: { type: 'send' as const, data: '\x02z' },
						},
					],
				},
			],
		}
		const { element } = createHelpOverlay(term, config)

		expect(element.innerHTML).toContain('Floating Buttons')
		expect(element.innerHTML).not.toContain('(top-left)')
		expect(element.innerHTML).toContain('Toggle pane zoom')
	})

	test('multiple groups show position label in help overlay', () => {
		const term = mockTerminal()
		const config = {
			...defaultConfig,
			floatingButtons: [
				{
					position: 'top-left' as const,
					buttons: [
						{
							id: 'zoom',
							label: 'Zoom',
							description: 'Toggle pane zoom',
							action: { type: 'send' as const, data: '\x02z' },
						},
					],
				},
				{
					position: 'bottom-right' as const,
					buttons: [
						{
							id: 'next',
							label: '›',
							description: 'Next pane',
							action: { type: 'send' as const, data: '\x02]' },
						},
					],
				},
			],
		}
		const { element } = createHelpOverlay(term, config)

		expect(element.innerHTML).toContain('Floating Buttons (top-left)')
		expect(element.innerHTML).toContain('Floating Buttons (bottom-right)')
	})

	test('help overlay has no floating buttons section when unconfigured', () => {
		const term = mockTerminal()
		const { element } = createHelpOverlay(term, defaultConfig)

		expect(element.innerHTML).not.toContain('Floating Buttons')
	})
})
