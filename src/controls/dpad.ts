import type { ControlButton, XTerminal } from '../types'
import { el } from '../util/dom'
import { haptic } from '../util/haptic'
import { onAttachmentTap } from '../util/tap'
import { sendData } from '../util/terminal'
import { suppressSynthesisedMouse } from './keyboard-controller'

/** Default dpad-toggle button (toolbar row1, between ⏎ and ⌨) */
export const dpadToggleButton: ControlButton = {
	id: 'dpad-toggle',
	label: '✥',
	description: 'Toggle the floating arrow-key pad',
	action: { type: 'dpad-toggle' },
}

/** D-pad keys in 3×3 grid order; null = empty cell (moshi-style cluster shape) */
const DPAD_KEYS: ReadonlyArray<{
	readonly label: string
	readonly data: string
	readonly description: string
} | null> = [
	{ label: '⌫', data: '\x7f', description: 'Send Backspace key' },
	{ label: '↑', data: '\x1b[A', description: 'Send Up arrow key' },
	null,
	{ label: '←', data: '\x1b[D', description: 'Send Left arrow key' },
	{ label: '⏎', data: '\r', description: 'Send Enter/Return key' },
	{ label: '→', data: '\x1b[C', description: 'Send Right arrow key' },
	{ label: '⇥', data: '\t', description: 'Send Tab key' },
	{ label: '↓', data: '\x1b[B', description: 'Send Down arrow key' },
	{ label: '⇧⇥', data: '\x1b[Z', description: 'Send Shift+Tab key' },
]

/**
 * moshi-style floating d-pad: an eight-key arrow cluster (← ↑ ↓ → ⌫ ⏎ ⇥ ⇧⇥) that
 * pops up above the toolbar via the ✥ dpad-toggle button.
 *
 * Focus safety (hard requirement): every key suppresses the synthesised
 * mousedown after touchend, so tapping a key never steals focus from the
 * terminal textarea — the soft-keyboard state (and the manual-mode input
 * lock) is untouched. Keys send via term.input (sendData), the same path
 * as typed input, so keyboard suppression semantics do not apply.
 */
export function createDpad(term: XTerminal): {
	readonly element: HTMLDivElement
	readonly toggle: () => void
} {
	const element = el('div', { id: 'wt-dpad' })

	for (const key of DPAD_KEYS) {
		if (key === null) {
			element.appendChild(el('div', { class: 'wt-dpad-spacer' }))
			continue
		}
		const button = el('button')
		button.textContent = key.label
		button.setAttribute('aria-label', key.description)
		suppressSynthesisedMouse(button)
		const data = key.data
		onAttachmentTap(term, button, () => {
			haptic()
			sendData(term, data)
		})
		element.appendChild(button)
	}

	function toggle(): void {
		element.classList.toggle('open')
	}

	return { element, toggle }
}
