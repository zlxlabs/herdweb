import type { XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

const TERMINAL_CONTAINER_SELECTOR = '#terminal-container'
const TERMINAL_ROWS_SELECTOR = '#terminal .xterm-rows'
const SELECTION_MODE_ID = 'wt-selection-mode'
const SNAPSHOT_ID = 'wt-selection-mode-snapshot'

interface SelectionModeController {
	readonly mount: () => void
	readonly toggle: () => Promise<void>
	readonly close: () => void
	readonly isOpen: () => boolean
	readonly dispose: () => void
}

interface BufferSnapshot {
	readonly text: string
	readonly viewportY: number
}

function readBufferSnapshot(term: XTerminal): BufferSnapshot {
	const active = term.buffer?.active
	if (!active || active.length === undefined || typeof active.getLine !== 'function') {
		throw new Error('herdweb: terminal buffer unavailable for selection mode')
	}

	const lines: string[] = []
	for (let index = 0; index < active.length; index += 1) {
		const line = active.getLine(index)
		if (!line) throw new Error(`herdweb: terminal buffer row ${index} unavailable`)
		lines.push(line.translateToString(true))
	}

	return { text: lines.join('\n'), viewportY: active.viewportY ?? 0 }
}

function copyTerminalTypography(snapshot: HTMLElement): number {
	const rows = document.querySelector<HTMLElement>(TERMINAL_ROWS_SELECTOR)
	if (!rows) return 0
	const style = getComputedStyle(rows)
	snapshot.style.fontFamily = style.fontFamily
	snapshot.style.fontSize = style.fontSize
	snapshot.style.lineHeight = style.lineHeight
	snapshot.style.letterSpacing = style.letterSpacing
	return rows.getBoundingClientRect().height
}

function createOverlay(
	term: XTerminal,
	text: string,
	viewportY: number,
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
	const rowHeight = copyTerminalTypography(snapshot)
	if (term.options.theme?.background) snapshot.style.backgroundColor = term.options.theme.background
	if (term.options.theme?.foreground) snapshot.style.color = term.options.theme.foreground

	overlay.appendChild(bar)
	overlay.appendChild(snapshot)
	onTap(closeButton, (event) => {
		event.stopPropagation()
		close()
	})

	const container = document.querySelector<HTMLElement>(TERMINAL_CONTAINER_SELECTOR)
	if (!container) throw new Error('herdweb: missing #terminal-container for selection mode')
	container.appendChild(overlay)
	snapshot.scrollTop = viewportY * rowHeight
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
			const snapshot = readBufferSnapshot(term)
			overlay = createOverlay(term, snapshot.text, snapshot.viewportY, close)
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
