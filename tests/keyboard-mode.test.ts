import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultActionRegistry } from '../src/actions/registry'
import { defineConfig } from '../src/config'
import { assertValidConfigOverrides } from '../src/config-validate'
import { createFloatingButtons } from '../src/controls/floating-buttons'
import {
	createKeyboardController,
	keyboardToggleButton,
	reportKeyboardUnavailable,
	syncKeyboardIndicators,
	withKeyboardEscapeHatch,
} from '../src/controls/keyboard-controller'
import { createDrawer } from '../src/drawer/drawer'
import { createHookRegistry } from '../src/hooks/registry'
import { createToolbar } from '../src/toolbar/toolbar'
import type { ConnectionStatus, XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

// vitest runs from the project root; happy-dom rewrites import.meta.url
const css = readFileSync(resolve(process.cwd(), 'styles/base.css'), 'utf8')

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

/** Mock terminal with the keyboard suppression semantics of the client bridge */
function mockSuppressionTerm(): {
	term: XTerminal
	calls: string[]
	emitFocus: (focused: boolean) => void
} {
	const calls: string[] = []
	let focusHandler: ((focused: boolean) => void) | null = null
	return {
		calls,
		emitFocus(focused) {
			focusHandler?.(focused)
		},
		term: {
			options: { fontSize: 14 },
			input(_data: string, _wasUserInput: boolean) {},
			focus() {
				calls.push('focus')
			},
			blur() {
				calls.push('blur')
			},
			setKeyboardSuppressed(suppressed: boolean) {
				calls.push(suppressed ? 'suppress' : 'unsuppress')
			},
			onFocusChange(handler: (focused: boolean) => void) {
				focusHandler = handler
				return {
					dispose() {
						focusHandler = null
					},
				}
			},
			onData(_handler: (data: string) => void) {
				return { dispose() {} }
			},
			isConnected() {
				return true
			},
			onConnectionChange(_handler: (connected: boolean) => void) {
				return { dispose() {} }
			},
			getConnectionStatus() {
				return { state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null }
			},
			onConnectionStatusChange(handler: (status: ConnectionStatus) => void) {
				handler({ state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null })
				return { dispose() {} }
			},
			requestReconnect() {},
			getSessionId() {
				return 'test-session'
			},
			sendInputAction() {
				return true
			},
			onInputActionResult() {
				return { dispose() {} }
			},
		},
	}
}

/** Install a fake visualViewport with a controllable height */
function fakeVisualViewport(height: number): EventTarget & { height: number } {
	const vv = new EventTarget() as EventTarget & { height: number }
	vv.height = height
	Object.defineProperty(window, 'visualViewport', {
		value: vv,
		writable: true,
		configurable: true,
	})
	return vv
}

function setInnerHeight(height: number): void {
	Object.defineProperty(window, 'innerHeight', {
		value: height,
		writable: true,
		configurable: true,
	})
}

describe('keyboardMode config schema', () => {
	test('defaults to auto', () => {
		expect(defineConfig().mobile.keyboardMode).toBe('auto')
	})

	test('accepts manual via overrides', () => {
		expect(defineConfig({ mobile: { keyboardMode: 'manual' } }).mobile.keyboardMode).toBe('manual')
		expect(() => assertValidConfigOverrides({ mobile: { keyboardMode: 'manual' } })).not.toThrow()
	})

	test('rejects unknown keyboardMode values', () => {
		expect(() => assertValidConfigOverrides({ mobile: { keyboardMode: 'locked' } })).toThrow(
			/keyboardMode/,
		)
	})

	test('accepts keyboard-toggle buttons in config overrides', () => {
		expect(() =>
			assertValidConfigOverrides({
				toolbar: {
					row1: [
						{
							id: 'kb',
							label: '⌨',
							description: 'Toggle the soft keyboard',
							action: { type: 'keyboard-toggle' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('default row1 carries the keyboard-toggle button (before ☰)', () => {
		const row1 = defineConfig().toolbar.row1
		// row1 ends with ⌨, ☰ drawer-toggle
		expect(row1[row1.length - 2]).toEqual(keyboardToggleButton)
	})
})

describe('keyboard-toggle action dispatch', () => {
	test('calls the toggleKeyboard dep', async () => {
		const toggleKeyboard = vi.fn()
		const registry = createDefaultActionRegistry({ toggleKeyboard })
		const handled = await registry.execute(
			{ type: 'keyboard-toggle' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded: () => {},
				sendText: async () => {},
			},
		)
		expect(handled).toBe(true)
		expect(toggleKeyboard).toHaveBeenCalledTimes(1)
	})

	test('fails loud when no toggleKeyboard is wired', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const registry = createDefaultActionRegistry()
		await expect(
			registry.execute(
				{ type: 'keyboard-toggle' },
				{
					term: mockTerminal(),
					kbWasOpen: false,
					focusIfNeeded: () => {},
					sendText: async () => {},
				},
			),
		).rejects.toThrow(/toggleKeyboard/)
	})
})

describe('keyboard controller — manual mode transitions', () => {
	test('starts locked: suppression applied at creation, permission false', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		expect(calls).toEqual(['suppress'])
		expect(controller.hasInputPermission()).toBe(false)
		expect(controller.indicatorOn()).toBe(false)
		controller.dispose()
	})

	test('toggle unlocks: clears suppression, then focuses inside the gesture', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus'])
		expect(controller.hasInputPermission()).toBe(true)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('second toggle locks again', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		vi.setSystemTime(Date.now() + 400)
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus', 'suppress'])
		expect(controller.hasInputPermission()).toBe(false)
		expect(controller.indicatorOn()).toBe(false)
		controller.dispose()
	})

	test('★ system-gesture dismiss does not change permission ★', () => {
		const { term, emitFocus } = mockSuppressionTerm()
		setInnerHeight(800)
		const vv = fakeVisualViewport(800)
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		expect(controller.hasInputPermission()).toBe(true)

		// System gesture: textarea blurs and the viewport grows back — the lock
		// was never released, so permission must survive unchanged.
		emitFocus(false)
		vv.height = 800
		vv.dispatchEvent(new Event('resize'))

		expect(controller.hasInputPermission()).toBe(true)
		// Manual indicator follows permission, not visibility (V1)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('tracks textarea focus events without touching permission', () => {
		const { term, emitFocus } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		const seen: boolean[] = []
		controller.subscribe(() => seen.push(controller.indicatorOn()))
		emitFocus(true)
		emitFocus(false)
		expect(controller.hasInputPermission()).toBe(false)
		expect(seen).toEqual([false, false])
		controller.dispose()
	})

	test('debounces rapid toggles (~300ms)', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		controller.toggle()
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus'])
		expect(controller.hasInputPermission()).toBe(true)
		vi.setSystemTime(Date.now() + 301)
		controller.toggle()
		expect(controller.hasInputPermission()).toBe(false)
		controller.dispose()
	})

	test('unavailable mechanism: available=false and toggle throws (fail-loud)', () => {
		const controller = createKeyboardController(mockTerminal(), 'manual')
		expect(controller.available).toBe(false)
		expect(() => controller.toggle()).toThrow(/setKeyboardSuppressed/)
		controller.dispose()
	})
})

describe('keyboard controller — auto mode', () => {
	test('no permission concept; indicator follows keyboard visibility', () => {
		setInnerHeight(800)
		fakeVisualViewport(400) // keyboard open
		const { term } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.hasInputPermission()).toBe(true)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('auto indicator tracks viewport changes', () => {
		setInnerHeight(800)
		const vv = fakeVisualViewport(800)
		const { term } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.indicatorOn()).toBe(false)
		vv.height = 400
		vv.dispatchEvent(new Event('resize'))
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('momentary control: focus when unfocused, blur when focused', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls, emitFocus } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		controller.toggle()
		expect(calls).toEqual(['focus'])
		emitFocus(true)
		vi.setSystemTime(Date.now() + 400)
		controller.toggle()
		expect(calls).toEqual(['focus', 'blur'])
		controller.dispose()
	})

	test('event disorder: stale keyboardVisible never steers the transition (T-B)', () => {
		// Viewport says "open" (resize event delayed/lost) but the textarea is
		// not focused — the toggle must still choose focus, not blur.
		setInnerHeight(800)
		fakeVisualViewport(400) // keyboardVisible=true, possibly stale
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.indicatorOn()).toBe(true) // indicator follows visibility
		controller.toggle()
		expect(calls).toEqual(['focus']) // transition follows focus semantics only
		controller.dispose()
	})

	test('auto never applies suppression at creation', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(calls).toEqual([])
		controller.dispose()
	})
})

describe('escape hatch (V2)', () => {
	test('auto mode is returned unchanged', () => {
		const config = defineConfig()
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('manual with an existing keyboard-toggle is returned unchanged', () => {
		const config = defineConfig({ mobile: { keyboardMode: 'manual' } })
		// default row1 already includes ⌨
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('floating-buttons keyboard-toggle is directly reachable — no injection', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'keyboard-toggle') },
			floatingButtons: [{ position: 'top-left', buttons: [keyboardToggleButton] }],
		})
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('drawer-only ⌨ without a drawer-toggle is unreachable — inject into row1', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: {
				row1: (defaults) =>
					defaults.filter((b) => b.id !== 'keyboard-toggle' && b.action.type !== 'drawer-toggle'),
			},
			drawer: { buttons: [keyboardToggleButton] },
		})
		const patched = withKeyboardEscapeHatch(config)
		expect(patched).not.toBe(config)
		expect(patched.toolbar.row1[patched.toolbar.row1.length - 1]).toEqual(keyboardToggleButton)
	})

	test('drawer-only ⌨ with a reachable drawer-toggle counts as covered', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			// default row1 keeps drawer-toggle; drop only the ⌨
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'keyboard-toggle') },
			drawer: { buttons: [keyboardToggleButton] },
		})
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('manual without any keyboard-toggle injects the default into row1', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'keyboard-toggle') },
		})
		const before = config.toolbar.row1.length
		const patched = withKeyboardEscapeHatch(config)
		expect(patched).not.toBe(config)
		expect(patched.toolbar.row1).toHaveLength(before + 1)
		expect(patched.toolbar.row1[patched.toolbar.row1.length - 1]).toEqual(keyboardToggleButton)
		// Pure: the input config is untouched
		expect(config.toolbar.row1).toHaveLength(before)
		expect(config.toolbar.row1.some((b) => b.id === 'keyboard-toggle')).toBe(false)
	})
})

describe('renderer wiring (toolbar / drawer / floating)', () => {
	function manualConfig() {
		return defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row1: [], row2: [keyboardToggleButton] },
		})
	}

	function drawerWithToggle() {
		const config = manualConfig()
		const { drawer } = createDrawer(mockTerminal(), [keyboardToggleButton], {
			hooks: createHookRegistry(),
			appConfig: config,
		})
		return drawer
	}

	function floatingWithToggle() {
		const config = manualConfig()
		const { elements } = createFloatingButtons(
			mockTerminal(),
			[{ position: 'top-left', buttons: [keyboardToggleButton] }],
			config,
			createHookRegistry(),
			createDefaultActionRegistry({ toggleKeyboard: () => {} }),
		)
		return elements[0] as HTMLDivElement
	}

	test('all three renderers decorate keyboard-toggle buttons (class + touchend guard)', () => {
		const { element: toolbar } = createToolbar(
			mockTerminal(),
			manualConfig(),
			() => {},
			createHookRegistry(),
		)
		const drawer = drawerWithToggle()
		const floating = floatingWithToggle()

		for (const root of [toolbar, drawer, floating]) {
			const toggle = root.querySelector('.wt-keyboard-toggle')
			expect(toggle, 'marker class missing').not.toBeNull()
			// 探针③ race guard: synthesised mouse events must be suppressed so the
			// unlock focus is not stolen back by the button.
			const event = new Event('touchend', { cancelable: true })
			toggle?.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(true)
		}

		// Plain buttons keep the default synthesised-mouse behaviour
		const plainConfig = defineConfig({
			toolbar: {
				row1: [
					{ id: 'q', label: 'q', description: 'Send q key', action: { type: 'send', data: 'q' } },
				],
			},
		})
		const { element: plainToolbar } = createToolbar(
			mockTerminal(),
			plainConfig,
			() => {},
			createHookRegistry(),
		)
		const plain = plainToolbar.querySelector('button')
		const plainEvent = new Event('touchend', { cancelable: true })
		plain?.dispatchEvent(plainEvent)
		expect(plainEvent.defaultPrevented).toBe(false)
	})

	test('indicator syncs across toolbar, drawer, and floating buttons', () => {
		const { term } = mockSuppressionTerm()
		const keyboard = createKeyboardController(term, 'manual')
		document.body.appendChild(
			createToolbar(mockTerminal(), manualConfig(), () => {}, createHookRegistry()).element,
		)
		document.body.appendChild(drawerWithToggle())
		document.body.appendChild(floatingWithToggle())

		// Mirrors the index.ts wiring
		syncKeyboardIndicators(keyboard, document)
		keyboard.subscribe(() => syncKeyboardIndicators(keyboard, document))

		expect(document.querySelectorAll('.wt-keyboard-toggle')).toHaveLength(3)
		for (const button of document.querySelectorAll('.wt-keyboard-toggle')) {
			expect(button.classList.contains('wt-kb-active')).toBe(false)
		}
		keyboard.toggle()
		for (const button of document.querySelectorAll('.wt-keyboard-toggle')) {
			expect(button.classList.contains('wt-kb-active')).toBe(true)
		}
		keyboard.dispose()
	})

	test('fail-loud: unavailable controller marks every ⌨ button and shows an overlay', () => {
		const keyboard = createKeyboardController(mockTerminal(), 'manual')
		document.body.appendChild(
			createToolbar(mockTerminal(), manualConfig(), () => {}, createHookRegistry()).element,
		)
		document.body.appendChild(drawerWithToggle())
		document.body.appendChild(floatingWithToggle())

		reportKeyboardUnavailable(keyboard)
		expect(document.getElementById('wt-keyboard-unavailable')).not.toBeNull()
		const toggles = document.querySelectorAll('.wt-keyboard-toggle')
		expect(toggles).toHaveLength(3)
		for (const button of toggles) {
			expect(button.classList.contains('wt-action-error')).toBe(true)
		}
		keyboard.dispose()
	})
})

describe('base.css keyboard rules', () => {
	test('landscape wt-kb-open hides only a true second row, exempting the keyboard-toggle (F1)', () => {
		// Single-row toolbar: the only row is :first-of-type and must stay visible
		expect(css).toContain(
			'#wt-toolbar.wt-kb-open .wt-row:not(:first-of-type):last-child button:not(.wt-keyboard-toggle)',
		)
		// The unguarded last-child hide (would blank the single-row toolbar) must be gone
		expect(css).not.toMatch(
			/#wt-toolbar\.wt-kb-open \.wt-row:last-child button:not\(\.wt-keyboard-toggle\)/,
		)
		// The old whole-row hide must be gone
		expect(css).not.toMatch(/#wt-toolbar\.wt-kb-open \.wt-row:last-child \{/)
	})

	test('row2 scrolls horizontally on narrow screens with 44px minimum targets (V2)', () => {
		const rowBlock = css.match(/#wt-toolbar \.wt-row:last-child \{([^}]*)\}/)
		expect(rowBlock?.[1]).toContain('overflow-x: auto')
		const buttonBlock = css.match(/#wt-toolbar \.wt-row:last-child button \{([^}]*)\}/)
		expect(buttonBlock?.[1]).toContain('min-width: 44px')
	})

	test('keyboard indicator style exists', () => {
		expect(css).toContain('#wt-toolbar button.wt-keyboard-toggle.wt-kb-active')
	})

	test('fixed bottom consumers use toolbar height without duplicating bottom safe-area', () => {
		const dpadBlock = css.match(/#wt-dpad\s*\{([^}]*)\}/)?.[1] ?? ''
		const imageDropBlock = css.match(/#wt-image-drop\s*\{([^}]*)\}/)?.[1] ?? ''
		expect(dpadBlock).toContain('var(--wt-toolbar-height, 64px)')
		expect(dpadBlock).not.toContain('safe-area-inset-bottom')
		expect(imageDropBlock).toContain('var(--wt-toolbar-height, 64px)')
		expect(imageDropBlock).not.toContain('safe-area-inset-bottom')
	})
})

describe('init lifecycle (P2-1)', () => {
	test('dispose consumes keyboard.dispose — old controller stops receiving events', async () => {
		Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true })
		// happy-dom lacks document.fonts
		Object.defineProperty(document, 'fonts', {
			value: { ready: Promise.resolve() },
			configurable: true,
		})
		setInnerHeight(800)
		fakeVisualViewport(800)

		const focusDispose = vi.fn()
		let focusHandler: ((focused: boolean) => void) | null = null
		const term: XTerminal = {
			options: { fontSize: 14 },
			input(_data: string, _wasUserInput: boolean) {},
			focus() {},
			blur() {},
			setKeyboardSuppressed(_suppressed: boolean) {},
			onFocusChange(handler: (focused: boolean) => void) {
				focusHandler = handler
				return { dispose: focusDispose }
			},
			onData(_handler: (data: string) => void) {
				return { dispose() {} }
			},
			isConnected() {
				return true
			},
			onConnectionChange(_handler: (connected: boolean) => void) {
				return { dispose() {} }
			},
			getConnectionStatus() {
				return { state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null }
			},
			onConnectionStatusChange(handler: (status: ConnectionStatus) => void) {
				handler({ state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null })
				return { dispose() {} }
			},
			requestReconnect() {},
			getSessionId() {
				return 'test-session'
			},
			sendInputAction() {
				return true
			},
			onInputActionResult() {
				return { dispose() {} }
			},
		}
		window.term = term

		const { init } = await import('../src/index')
		const config = defineConfig({ mobile: { keyboardMode: 'manual' } })
		init({ ...config, targetCount: config.targets.length })

		// Wait until init has rendered the toolbar (controller created before it)
		await vi.waitFor(
			() => {
				expect(document.getElementById('wt-toolbar')).not.toBeNull()
			},
			{ timeout: 5000 },
		)
		expect(focusHandler).not.toBeNull()

		// pagehide/beforeunload path → dispose → keyboard.dispose()
		window.dispatchEvent(new Event('beforeunload'))
		expect(focusDispose).toHaveBeenCalledTimes(1)
	})
})
