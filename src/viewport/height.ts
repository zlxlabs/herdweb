import type { AsrPreview } from '../controls/asr-preview'
import { isKeyboardOpen, resetKeyboardHeightBaseline } from '../util/keyboard'
import { resizeTerm } from '../util/terminal'
import { checkLandscapeKeyboard } from './landscape'

export function viewportHeight(
	vp: Pick<VisualViewport, 'height' | 'offsetTop'> | null,
	fallbackHeight: number,
	includeOffsetTop: boolean,
): number {
	if (!vp) return fallbackHeight
	return includeOffsetTop ? vp.height + vp.offsetTop : vp.height
}

export function lockDocumentHeight(height: string): void {
	document.documentElement.style.setProperty('height', height, 'important')
	document.documentElement.style.setProperty('max-height', height, 'important')
	document.documentElement.style.setProperty('overflow', 'hidden', 'important')
	document.documentElement.style.setProperty('overscroll-behavior', 'none', 'important')

	document.body.style.setProperty('min-height', '0', 'important')
	document.body.style.setProperty('height', height, 'important')
	document.body.style.setProperty('max-height', height, 'important')
	document.body.style.setProperty('overflow', 'hidden', 'important')
	document.body.style.setProperty('overscroll-behavior', 'none', 'important')
}

/**
 * Height of the visible bottom chrome (voice composer replaces the toolbar when open).
 * The soft keyboard is intentionally not special-cased: bottom chrome lifts above
 * the keyboard via the --kb-inset CSS variable, so its height is always deducted
 * from the terminal to keep terminal / chrome / keyboard stacked without overlap.
 */
export function bottomChromeHeight(
	composerOpen: boolean,
	toolbarHeight: number,
	composerHeight: number,
): number {
	return composerOpen ? composerHeight : toolbarHeight
}

/**
 * Pixels of the layout viewport covered by the soft keyboard, written to the
 * --kb-inset CSS variable that lifts bottom-fixed chrome above the keyboard.
 * Always 0 where interactive-widget=resizes-content shrinks the layout viewport
 * with the keyboard (Android Chrome 108+); on iOS it equals the keyboard mask height.
 */
export function keyboardInsetPx(
	vp: Pick<VisualViewport, 'height' | 'offsetTop'> | null,
	innerHeight: number,
): number {
	if (!vp) return 0
	return Math.max(0, innerHeight - vp.height - vp.offsetTop)
}

/** Debounce window for terminal refits — keyboard-animation frames coalesce into one fit + one WS resize after settle */
export const TERM_RESIZE_DEBOUNCE_MS = 150

/**
 * Manage terminal height to account for the toolbar and virtual keyboard.
 * Uses visualViewport API when available for accurate keyboard detection.
 * Per-frame work is cheap (lock document height, write --kb-inset, landscape
 * class); the expensive resizeTerm (fit + WS resize) is debounced so a
 * keyboard animation produces a single refit once it settles.
 */
export function initHeightManager(
	toolbar: HTMLDivElement,
	composer?: Pick<AsrPreview, 'element' | 'isOpen'>,
): () => void {
	let pendingResize = 0
	let termResizeTimer: ReturnType<typeof setTimeout> | null = null
	let lastLockedHeight = ''

	function scheduleTermResize(): void {
		if (termResizeTimer !== null) clearTimeout(termResizeTimer)
		termResizeTimer = setTimeout(() => {
			termResizeTimer = null
			resizeTerm()
		}, TERM_RESIZE_DEBOUNCE_MS)
	}

	function updateHeight(): void {
		pendingResize = 0
		const vp = window.visualViewport

		// All layout reads first, then all writes — interleaving them forces synchronous layout.
		const toolbarH = toolbar.offsetHeight || 90
		const composerH = composer?.element.offsetHeight ?? 0
		const kbOpen = isKeyboardOpen()

		const vh = viewportHeight(vp, window.innerHeight, kbOpen)
		const chromeH = bottomChromeHeight(composer?.isOpen() ?? false, toolbarH, composerH)
		const h = `${vh - chromeH}px`

		checkLandscapeKeyboard(toolbar)
		lockDocumentHeight(h)
		document.documentElement.style.setProperty('--wt-toolbar-height', `${toolbarH}px`)
		document.documentElement.style.setProperty(
			'--kb-inset',
			`${keyboardInsetPx(vp, window.innerHeight)}px`,
		)

		// Refit only when the locked height actually changed; the debounce then
		// coalesces a burst of animation frames into one resizeTerm after settle.
		if (h !== lastLockedHeight) {
			lastLockedHeight = h
			scheduleTermResize()
		}
	}

	function scheduleResize(): void {
		if (!pendingResize) {
			pendingResize = requestAnimationFrame(updateHeight)
		}
	}

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', scheduleResize)
		window.visualViewport.addEventListener('scroll', scheduleResize)
	}
	window.addEventListener('resize', scheduleResize)
	window.addEventListener('orientationchange', () => {
		resetKeyboardHeightBaseline()
		setTimeout(scheduleResize, 200)
	})

	scheduleResize()
	return scheduleResize
}
