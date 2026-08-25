import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetKeyboardHeightBaseline } from '../src/util/keyboard'
import {
	TERM_RESIZE_DEBOUNCE_MS,
	bottomChromeHeight,
	initHeightManager,
	keyboardInsetPx,
	lockDocumentHeight,
	viewportHeight,
} from '../src/viewport/height'
import { checkLandscapeKeyboard } from '../src/viewport/landscape'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('checkLandscapeKeyboard', () => {
	function makeToolbar(): HTMLDivElement {
		const toolbar = document.createElement('div')
		document.body.appendChild(toolbar)
		return toolbar
	}

	test('adds wt-kb-open class when keyboard open in landscape', () => {
		Object.defineProperty(window, 'innerHeight', {
			value: 400,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'innerWidth', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 200 },
			writable: true,
			configurable: true,
		})

		const toolbar = makeToolbar()
		checkLandscapeKeyboard(toolbar)
		expect(toolbar.classList.contains('wt-kb-open')).toBe(true)
	})

	test('removes class when keyboard closed', () => {
		Object.defineProperty(window, 'innerHeight', {
			value: 400,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'innerWidth', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 390 },
			writable: true,
			configurable: true,
		})

		const toolbar = makeToolbar()
		toolbar.classList.add('wt-kb-open')
		checkLandscapeKeyboard(toolbar)
		expect(toolbar.classList.contains('wt-kb-open')).toBe(false)
	})

	test('removes class in portrait even if keyboard open', () => {
		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'innerWidth', {
			value: 400,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 400 },
			writable: true,
			configurable: true,
		})

		const toolbar = makeToolbar()
		toolbar.classList.add('wt-kb-open')
		checkLandscapeKeyboard(toolbar)
		expect(toolbar.classList.contains('wt-kb-open')).toBe(false)
	})

	test('no-op when visualViewport is null', () => {
		Object.defineProperty(window, 'visualViewport', {
			value: null,
			writable: true,
			configurable: true,
		})

		const toolbar = makeToolbar()
		toolbar.classList.add('wt-kb-open')
		checkLandscapeKeyboard(toolbar)
		// Class untouched — function returned early
		expect(toolbar.classList.contains('wt-kb-open')).toBe(true)
	})
})

describe('viewportHeight', () => {
	test('uses visual viewport height plus offsetTop when keyboard is open', () => {
		const vp = { height: 500, offsetTop: 20 }
		expect(viewportHeight(vp, 900, true)).toBe(520)
	})

	test('uses visual viewport height only when keyboard is closed', () => {
		const vp = { height: 500, offsetTop: 20 }
		expect(viewportHeight(vp, 900, false)).toBe(500)
	})

	test('falls back to innerHeight when no visual viewport', () => {
		expect(viewportHeight(null, 900, false)).toBe(900)
	})
})

describe('bottomChromeHeight', () => {
	test.each([
		['composer replaces toolbar', true, 80, 160, 160],
		['toolbar is the default', false, 80, 160, 80],
	] as const)('%s', (_label, composerOpen, toolbarHeight, composerHeight, expected) => {
		expect(bottomChromeHeight(composerOpen, toolbarHeight, composerHeight)).toBe(expected)
	})

	test('no keyboard special case: visible chrome is always deducted', () => {
		// The keyboard used to force 0; now chrome lifts above the keyboard via
		// --kb-inset, so its height keeps being deducted to avoid overlap.
		expect(bottomChromeHeight(false, 80, 160)).toBe(80)
		expect(bottomChromeHeight(true, 80, 160)).toBe(160)
	})
})

describe('keyboardInsetPx', () => {
	test('returns 0 without a visual viewport', () => {
		expect(keyboardInsetPx(null, 800)).toBe(0)
	})

	test('returns 0 when the layout viewport resizes with the keyboard (resizes-content)', () => {
		expect(keyboardInsetPx({ height: 500, offsetTop: 0 }, 500)).toBe(0)
	})

	test('returns the keyboard mask height including offsetTop', () => {
		expect(keyboardInsetPx({ height: 500, offsetTop: 20 }, 800)).toBe(280)
	})

	test('never goes negative', () => {
		expect(keyboardInsetPx({ height: 900, offsetTop: 0 }, 800)).toBe(0)
	})
})

describe('initHeightManager', () => {
	function fakeViewport(
		height: number,
		offsetTop = 0,
	): EventTarget & { height: number; offsetTop: number } {
		const vv = new EventTarget() as EventTarget & { height: number; offsetTop: number }
		vv.height = height
		vv.offsetTop = offsetTop
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

	function makeToolbar(): HTMLDivElement {
		const toolbar = document.createElement('div')
		document.body.appendChild(toolbar)
		return toolbar
	}

	beforeEach(() => {
		vi.useFakeTimers()
		// Drive rAF through fake timers so updates are flushed synchronously in tests
		Object.defineProperty(window, 'requestAnimationFrame', {
			value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
			writable: true,
			configurable: true,
		})
		resetKeyboardHeightBaseline()
	})

	afterEach(() => {
		window.__herdwebResize = undefined
		vi.useRealTimers()
	})

	test('writes --kb-inset from innerHeight minus viewport height and offsetTop', () => {
		setInnerHeight(800)
		fakeViewport(500, 20)

		initHeightManager(makeToolbar())
		vi.advanceTimersByTime(1) // flush the rAF-scheduled update

		expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('280px')
	})

	test('writes the measured toolbar height for fixed bottom consumers', () => {
		setInnerHeight(800)
		fakeViewport(800)
		const toolbar = makeToolbar()
		Object.defineProperty(toolbar, 'offsetHeight', { value: 132, configurable: true })

		initHeightManager(toolbar)
		vi.advanceTimersByTime(1)

		expect(document.documentElement.style.getPropertyValue('--wt-toolbar-height')).toBe('132px')
	})

	test('deducts visible chrome from the locked height while the keyboard is open', () => {
		setInnerHeight(800)
		fakeViewport(500, 20) // keyboard open (baseline 800 taken from innerHeight)

		initHeightManager(makeToolbar())
		vi.advanceTimersByTime(1)

		// 500 + 20 (offsetTop) - 90 (toolbar fallback height, offsetHeight is 0 in happy-dom)
		expect(document.documentElement.style.getPropertyValue('height')).toBe('430px')
	})

	test('debounces a burst of viewport resizes into a single terminal resize', () => {
		setInnerHeight(800)
		const vv = fakeViewport(800)
		const resizeSpy = vi.fn()
		window.__herdwebResize = resizeSpy

		initHeightManager(makeToolbar())
		vi.advanceTimersByTime(1 + TERM_RESIZE_DEBOUNCE_MS)
		expect(resizeSpy).toHaveBeenCalledTimes(1)

		// Keyboard animation: one frame every 50ms, viewport shrinking each frame
		for (let frame = 1; frame <= 5; frame++) {
			vv.height = 800 - frame * 50
			vv.dispatchEvent(new Event('resize'))
			vi.advanceTimersByTime(50)
		}
		expect(resizeSpy).toHaveBeenCalledTimes(1) // no refit mid-animation

		vi.advanceTimersByTime(TERM_RESIZE_DEBOUNCE_MS + 1)
		expect(resizeSpy).toHaveBeenCalledTimes(2) // exactly one refit after settle
	})
})

describe('lockDocumentHeight', () => {
	test('locks document and body styles to prevent page scroll', () => {
		lockDocumentHeight('480px')

		expect(document.documentElement.style.getPropertyValue('height')).toBe('480px')
		expect(document.documentElement.style.getPropertyValue('overflow')).toBe('hidden')
		expect(document.documentElement.style.getPropertyValue('overscroll-behavior')).toBe('none')

		expect(document.body.style.getPropertyValue('height')).toBe('480px')
		expect(document.body.style.getPropertyValue('max-height')).toBe('480px')
		expect(document.body.style.getPropertyValue('overflow')).toBe('hidden')
		expect(document.body.style.getPropertyValue('overscroll-behavior')).toBe('none')
	})
})
