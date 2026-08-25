import type { ButtonAction, ControlButton, XTerminal } from '../types'
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

/** Default d-pad keys in 3×3 grid order; null = empty cell (moshi-style cluster shape) */
export const defaultDpadKeys: readonly (ControlButton | null)[] = [
	{
		id: 'dpad-backspace',
		label: '⌫',
		description: 'Send Backspace key',
		action: { type: 'send', data: '\x7f' },
	},
	{
		id: 'dpad-up',
		label: '↑',
		description: 'Send Up arrow key',
		action: { type: 'send', data: '\x1b[A' },
	},
	{
		// Paste sits in the high-frequency cluster (issue #99) — one tap from the
		// d-pad, no drawer round trip.
		id: 'dpad-paste',
		label: '📋',
		description: 'Paste clipboard contents',
		action: { type: 'paste' },
	},
	{
		id: 'dpad-left',
		label: '←',
		description: 'Send Left arrow key',
		action: { type: 'send', data: '\x1b[D' },
	},
	{
		// Hold ⏎ for "newline without submit" (issue #98): '\n' (Ctrl+J) is the
		// agent-agnostic sequence — Claude Code, Codex, pi and OpenCode all accept
		// it, and it needs no kitty keyboard-protocol forwarding through
		// herdr/tmux. Users on kitty-protocol agents can override via
		// `longPressAction: { type: 'send', data: '\x1b[13;2u' }`.
		id: 'dpad-enter',
		label: '⏎',
		description: 'Enter — hold to insert newline (no submit)',
		action: { type: 'send', data: '\r' },
		longPressAction: { type: 'send', data: '\n' },
	},
	{
		id: 'dpad-right',
		label: '→',
		description: 'Send Right arrow key',
		action: { type: 'send', data: '\x1b[C' },
	},
	{
		id: 'dpad-tab',
		label: '⇥',
		description: 'Send Tab key',
		action: { type: 'send', data: '\t' },
	},
	{
		id: 'dpad-down',
		label: '↓',
		description: 'Send Down arrow key',
		action: { type: 'send', data: '\x1b[B' },
	},
	{
		id: 'dpad-shift-tab',
		label: '⇧⇥',
		description: 'Send Shift+Tab key',
		action: { type: 'send', data: '\x1b[Z' },
	},
]

/** Hold time (ms) before a key's longPressAction fires instead of its tap action */
const DPAD_LONG_PRESS_MS = 500

/** Dependencies injected into the d-pad by the app wiring layer */
interface DpadDeps {
	/**
	 * Dispatch a non-send key action through the action registry (e.g. async
	 * paste). `send` keys bypass this and go straight to sendData.
	 */
	readonly executeAction: (action: ButtonAction) => void
}

/**
 * moshi-style floating d-pad: a nine-key cluster (⌫ ↑ 📋 / ← ⏎ → / ⇥ ↓ ⇧⇥) that
 * pops up above the toolbar via the ✥ dpad-toggle button. The key layout comes
 * from config (`dpad.keys`); `send` keys emit bytes directly via sendData (the
 * same path as typed input), any other action type is handed to
 * `deps.executeAction` (the action registry).
 *
 * Long press: a key with `longPressAction` starts a 500ms timer on
 * touchstart/mousedown; when it fires, the longPressAction is dispatched
 * (haptic included) and the pending tap is suppressed, so the normal action
 * never double-fires. Releasing before the threshold is a plain tap.
 *
 * Focus safety (hard requirement): every key suppresses the synthesised
 * mousedown after touchend, so tapping a key never steals focus from the
 * terminal textarea — the soft-keyboard state (and the manual-mode input
 * lock) is untouched.
 */
export function createDpad(
	term: XTerminal,
	keys: readonly (ControlButton | null)[],
	deps: DpadDeps,
): {
	readonly element: HTMLDivElement
	readonly toggle: () => void
} {
	const element = el('div', { id: 'wt-dpad' })

	for (const key of keys) {
		if (key === null) {
			element.appendChild(el('div', { class: 'wt-dpad-spacer' }))
			continue
		}
		const button = el('button')
		button.textContent = key.label
		button.setAttribute('aria-label', key.description)
		suppressSynthesisedMouse(button)

		const dispatch = (action: ButtonAction): void => {
			haptic()
			if (action.type === 'send') {
				sendData(term, action.data)
			} else {
				deps.executeAction(action)
			}
		}

		let longPressFired = false
		const longPressAction = key.longPressAction
		if (longPressAction) {
			button.classList.add('wt-dpad-has-alt')
			let longPressTimer: ReturnType<typeof setTimeout> | undefined
			const cancelLongPressTimer = (): void => {
				if (longPressTimer !== undefined) clearTimeout(longPressTimer)
				longPressTimer = undefined
			}
			const startLongPressTimer = (): void => {
				cancelLongPressTimer()
				longPressTimer = setTimeout(() => {
					longPressTimer = undefined
					longPressFired = true
					dispatch(longPressAction)
				}, DPAD_LONG_PRESS_MS)
			}
			button.addEventListener('touchstart', startLongPressTimer)
			button.addEventListener('touchend', cancelLongPressTimer)
			button.addEventListener('touchcancel', cancelLongPressTimer)
			button.addEventListener('mousedown', startLongPressTimer)
			button.addEventListener('mouseup', cancelLongPressTimer)
			button.addEventListener('mouseleave', cancelLongPressTimer)
		}

		onAttachmentTap(term, button, () => {
			if (longPressFired) {
				longPressFired = false
				return
			}
			dispatch(key.action)
		})
		element.appendChild(button)
	}

	function toggle(): void {
		element.classList.toggle('open')
	}

	return { element, toggle }
}
