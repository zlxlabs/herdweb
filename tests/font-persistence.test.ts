import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
	FONT_SIZE_STORAGE_KEY,
	LEGACY_FONT_SIZE_STORAGE_KEY,
	readFontSizeFromStorage,
} from '../src/actions/registry'
import { defaultConfig, defineConfig } from '../src/config'
import { createGestureLock } from '../src/gestures/lock'
import { attachPinchGestures } from '../src/gestures/pinch'
import type { ConnectionStatus, HerdwebConfig, XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
	vi.restoreAllMocks()
})

function setInnerHeight(height: number): void {
	Object.defineProperty(window, 'innerHeight', {
		value: height,
		writable: true,
		configurable: true,
	})
}

/** Boot the overlay on a mock mobile terminal and return it once rendered */
async function bootOverlay(config: HerdwebConfig = defineConfig()): Promise<XTerminal> {
	Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true })
	// happy-dom lacks document.fonts
	Object.defineProperty(document, 'fonts', {
		value: { ready: Promise.resolve() },
		configurable: true,
	})
	setInnerHeight(800)

	const term: XTerminal = {
		options: { fontSize: 14 },
		input(_data: string, _wasUserInput: boolean) {},
		focus() {},
		blur() {},
		setKeyboardSuppressed(_suppressed: boolean) {},
		onFocusChange(_handler: (focused: boolean) => void) {
			return { dispose() {} }
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
	init({ ...config, targetCount: config.targets.length })

	await vi.waitFor(
		() => {
			expect(document.getElementById('wt-toolbar')).not.toBeNull()
		},
		{ timeout: 5000 },
	)
	return term
}

describe('font size persistence (localStorage herdweb:fontSize)', () => {
	test('no persisted value — config default (13) applies', async () => {
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
	})

	test('persisted value wins over the config default', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '20')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(20)
	})

	test('corrupt persisted value falls back to the config default', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'huge')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
	})

	test('empty string falls back to the config default (Number("") === 0 trap)', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
	})

	test('persisted value above the current sizeRange clamps to the upper bound', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '30')
		const term = await bootOverlay(defineConfig({ font: { sizeRange: [8, 20] } }))
		expect(term.options.fontSize).toBe(20)
	})

	test('persisted value below the current sizeRange clamps to the lower bound', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '2')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(8)
	})

	test('localStorage read failure (iOS private mode) — logs and uses the default', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError')
		})
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
		expect(errorSpy).toHaveBeenCalled()
	})

	test('migrates legacy font size key when new key is absent', () => {
		localStorage.setItem(LEGACY_FONT_SIZE_STORAGE_KEY, '18')
		expect(readFontSizeFromStorage()).toBe('18')
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('18')
		expect(localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY)).toBeNull()
	})

	test('legacy font size key is ignored when new key already has a value', () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '22')
		localStorage.setItem(LEGACY_FONT_SIZE_STORAGE_KEY, '18')
		expect(readFontSizeFromStorage()).toBe('22')
		expect(localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY)).toBe('18')
	})

	test('no legacy key — migration is a no-op', () => {
		expect(readFontSizeFromStorage()).toBeNull()
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull()
	})

	test('boot overlay migrates legacy font size from pre-rename key', async () => {
		localStorage.setItem(LEGACY_FONT_SIZE_STORAGE_KEY, '18')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(18)
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('18')
		expect(localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY)).toBeNull()
	})
})

describe('pinch gesture font persistence', () => {
	function setupPinch(): { screen: HTMLElement; term: XTerminal } {
		const screen = document.createElement('div')
		screen.className = 'xterm-screen'
		document.body.appendChild(screen)
		const term = mockTerminal()
		attachPinchGestures(term, defaultConfig.font, createGestureLock())
		return { screen, term }
	}

	function touch(x: number): { clientX: number; clientY: number } {
		return { clientX: x, clientY: 0 }
	}

	function dispatchPinch(screen: HTMLElement, startDist: number, moves: readonly number[]): void {
		screen.dispatchEvent(
			Object.assign(new Event('touchstart'), { touches: [touch(0), touch(startDist)] }),
		)
		for (const dist of moves) {
			screen.dispatchEvent(
				Object.assign(new Event('touchmove', { cancelable: true }), {
					touches: [touch(0), touch(dist)],
				}),
			)
		}
		screen.dispatchEvent(new Event('touchend'))
	}

	test('multiple moves, one touchend — persists the final size exactly once', () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem')
		const { screen, term } = setupPinch()

		dispatchPinch(screen, 100, [150, 200])

		expect(term.options.fontSize).toBe(28) // 14 * 2, within [8, 32]
		const writes = setItem.mock.calls.filter(([key]) => key === FONT_SIZE_STORAGE_KEY)
		expect(writes).toEqual([[FONT_SIZE_STORAGE_KEY, '28']])
	})

	test('gesture ending back at the base size writes nothing', () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem')
		const { screen, term } = setupPinch()

		dispatchPinch(screen, 100, [200, 100])

		expect(term.options.fontSize).toBe(14)
		expect(setItem.mock.calls.filter(([key]) => key === FONT_SIZE_STORAGE_KEY)).toEqual([])
	})

	test('write failure logs and continues — gesture still completes', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError')
		})
		const { screen, term } = setupPinch()

		dispatchPinch(screen, 100, [200])

		expect(term.options.fontSize).toBe(28)
		expect(errorSpy).toHaveBeenCalled()
	})
})
