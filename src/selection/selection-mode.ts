import type { XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

const TERMINAL_CONTAINER_SELECTOR = '#terminal-container'
const TERMINAL_ROWS_SELECTOR = '#terminal .xterm-rows'
const TERMINAL_SCROLLBAR_SELECTOR = '#terminal .xterm-scrollable-element .scrollbar.vertical'
const SELECTION_MODE_ID = 'wt-selection-mode'
const SNAPSHOT_ID = 'wt-selection-mode-snapshot'

interface ScrollState {
	readonly scrollbar: HTMLElement
	readonly slider: HTMLElement
	readonly rowHeight: number
	readonly visibleRows: number
	readonly trackTop: number
	readonly trackHeight: number
	readonly sliderHeight: number
	readonly sliderTop: number
	readonly maxSliderTop: number
	readonly maxOffset: number
}

export interface SelectionModeController {
	readonly mount: () => void
	readonly toggle: () => Promise<void>
	readonly close: () => void
	readonly isOpen: () => boolean
	readonly dispose: () => void
}

function terminalRows(): HTMLElement[] {
	const rows = document.querySelector(TERMINAL_ROWS_SELECTOR)
	if (!(rows instanceof HTMLElement)) {
		throw new Error('herdweb: terminal rows unavailable for selection mode')
	}
	return Array.from(rows.children).filter((row): row is HTMLElement => row instanceof HTMLElement)
}

function currentRenderedText(): string[] {
	return terminalRows().map((row) => row.textContent ?? '')
}

function getScrollState(): ScrollState | undefined {
	const rows = terminalRows()
	const firstRow = rows[0]
	const scrollbar = document.querySelector<HTMLElement>(TERMINAL_SCROLLBAR_SELECTOR)
	const slider = scrollbar?.querySelector<HTMLElement>('.slider')
	if (!firstRow || !scrollbar || !slider) return undefined

	const rowHeight = firstRow.getBoundingClientRect().height
	const track = scrollbar.getBoundingClientRect()
	const sliderRect = slider.getBoundingClientRect()
	const maxSliderTop = Math.max(0, track.height - sliderRect.height)
	if (rowHeight <= 0 || rows.length === 0 || maxSliderTop <= 0) return undefined

	// xterm's v6 scrollbar is custom-rendered: its slider ratio is the only
	// public DOM measure of the complete buffer length.
	const totalRows = Math.max(
		rows.length,
		Math.round((rows.length * track.height) / sliderRect.height),
	)
	return {
		scrollbar,
		slider,
		rowHeight,
		visibleRows: rows.length,
		trackTop: track.top,
		trackHeight: track.height,
		sliderHeight: sliderRect.height,
		sliderTop: sliderRect.top - track.top,
		maxSliderTop,
		maxOffset: Math.max(0, totalRows - rows.length),
	}
}

function renderedTextAtOffset(state: ScrollState): {
	readonly offset: number
	readonly lines: string[]
} {
	const current = getScrollState()
	const sliderTop = current?.sliderTop ?? state.sliderTop
	const offset = Math.round((sliderTop / state.maxSliderTop) * state.maxOffset)
	return { offset: Math.max(0, Math.min(state.maxOffset, offset)), lines: currentRenderedText() }
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
			return
		}
		window.setTimeout(resolve, 0)
	})
}

function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	clientY: number,
	buttons: number,
): void {
	if (typeof PointerEvent !== 'function') {
		throw new Error('herdweb: pointer events unavailable for terminal scrollback')
	}
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX,
			clientY,
			pointerId: 1,
			pointerType: 'mouse',
			isPrimary: true,
			button: 0,
			buttons,
		}),
	)
}

async function scrollToOffset(state: ScrollState, offset: number): Promise<void> {
	const sliderRect = state.slider.getBoundingClientRect()
	const startX = sliderRect.left + sliderRect.width / 2
	const startY = sliderRect.top + sliderRect.height / 2
	const targetTop = state.maxSliderTop * (offset / state.maxOffset)
	const targetY = state.trackTop + targetTop + state.sliderHeight / 2
	dispatchPointer(state.slider, 'pointerdown', startX, startY, 1)
	dispatchPointer(document, 'pointermove', startX, targetY, 1)
	dispatchPointer(document, 'pointerup', startX, targetY, 0)
	await nextFrame()
}

async function readRenderedScrollback(): Promise<{
	readonly text: string
	readonly offset: number
}> {
	const state = getScrollState()
	if (!state || state.maxOffset === 0) {
		return { text: currentRenderedText().join('\n'), offset: 0 }
	}

	const lines = new Array<string>(state.maxOffset + state.visibleRows).fill('')
	const step = Math.max(1, state.visibleRows - 1)
	const offsets: number[] = []
	for (let offset = 0; offset <= state.maxOffset; offset += step) offsets.push(offset)
	if (offsets.at(-1) !== state.maxOffset) offsets.push(state.maxOffset)

	const originalOffset = renderedTextAtOffset(state).offset
	for (const offset of offsets) {
		await scrollToOffset(state, offset)
		const rendered = renderedTextAtOffset(state)
		for (let row = 0; row < rendered.lines.length; row++) {
			const lineIndex = rendered.offset + row
			if (lineIndex < lines.length) lines[lineIndex] = rendered.lines[row] ?? ''
		}
	}
	await scrollToOffset(state, originalOffset)

	return { text: lines.join('\n'), offset: originalOffset }
}

function copyTerminalTypography(snapshot: HTMLElement): void {
	const rows = document.querySelector<HTMLElement>(TERMINAL_ROWS_SELECTOR)
	if (!rows) return
	const style = getComputedStyle(rows)
	snapshot.style.fontFamily = style.fontFamily
	snapshot.style.fontSize = style.fontSize
	snapshot.style.lineHeight = style.lineHeight
	snapshot.style.letterSpacing = style.letterSpacing
}

function createOverlay(
	term: XTerminal,
	text: string,
	initialOffset: number,
	rowHeight: number,
	close: () => void,
): HTMLDivElement {
	const overlay = el('div', {
		id: SELECTION_MODE_ID,
		role: 'dialog',
		'aria-label': 'Terminal text selection mode',
	})
	const bar = el('div', { class: 'wt-selection-mode-bar' })
	const title = el('span', { class: 'wt-selection-mode-title' })
	title.textContent = '显示已冻结'
	const closeButton = el('button', {
		class: 'wt-selection-mode-close',
		id: 'wt-selection-mode-close',
		'aria-label': '退出选择模式',
		type: 'button',
	})
	closeButton.textContent = '退出'
	bar.appendChild(title)
	bar.appendChild(closeButton)

	const snapshot = el('pre', {
		id: SNAPSHOT_ID,
		tabindex: '0',
		'aria-label': 'Terminal output snapshot',
	})
	snapshot.textContent = text
	copyTerminalTypography(snapshot)
	if (term.options.theme?.background) snapshot.style.backgroundColor = term.options.theme.background
	if (term.options.theme?.foreground) snapshot.style.color = term.options.theme.foreground
	if (rowHeight > 0) snapshot.style.setProperty('--wt-selection-row-height', `${rowHeight}px`)

	overlay.appendChild(bar)
	overlay.appendChild(snapshot)
	onTap(closeButton, (event) => {
		event.stopPropagation()
		close()
	})

	const container = document.querySelector<HTMLElement>(TERMINAL_CONTAINER_SELECTOR)
	if (!container) throw new Error('herdweb: missing #terminal-container for selection mode')
	container.appendChild(overlay)
	snapshot.scrollTop = initialOffset * rowHeight
	snapshot.focus({ preventScroll: true })
	return overlay
}

export function createSelectionMode(term: XTerminal): SelectionModeController {
	let overlay: HTMLDivElement | undefined
	let mounted = false
	let opening = false

	function close(): void {
		overlay?.remove()
		overlay = undefined
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (!overlay || event.key !== 'Escape') return
		event.preventDefault()
		event.stopPropagation()
		close()
	}

	function mount(): void {
		if (mounted) return
		document.addEventListener('keydown', onKeyDown, true)
		mounted = true
	}

	async function toggle(): Promise<void> {
		if (opening) return
		if (overlay) {
			close()
			return
		}

		opening = true
		try {
			const state = getScrollState()
			const snapshot = await readRenderedScrollback()
			overlay = createOverlay(term, snapshot.text, snapshot.offset, state?.rowHeight ?? 0, close)
		} finally {
			opening = false
		}
	}

	function isOpen(): boolean {
		return overlay !== undefined
	}

	function dispose(): void {
		close()
		if (!mounted) return
		document.removeEventListener('keydown', onKeyDown, true)
		mounted = false
	}

	return { mount, toggle, close, isOpen, dispose }
}
