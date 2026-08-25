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
		repeatOnHold: true,
	},
	{
		id: 'dpad-up',
		label: '↑',
		description: 'Send Up arrow key',
		action: { type: 'send', data: '\x1b[A' },
		repeatOnHold: true,
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
		repeatOnHold: true,
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
		repeatOnHold: true,
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
		repeatOnHold: true,
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

/** Hold-to-repeat cadence, aligned with scroll-buttons: 300ms delay, then every 100ms */
const DPAD_REPEAT_DELAY_MS = 300
const DPAD_REPEAT_INTERVAL_MS = 100

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
 * Hold-to-repeat: a key with `repeatOnHold` starts repeating its tap action
 * after a 300ms hold (then every 100ms) until release; if any repeat fired,
 * the release tap is suppressed. Mutually exclusive with `longPressAction` —
 * longPress wins and repeat is not wired for that key.
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

		const dispatch = (action: ButtonAction, withHaptic = true): void => {
			if (withHaptic) haptic()
			if (action.type === 'send') {
				sendData(term, action.data)
			} else {
				deps.executeAction(action)
			}
		}

		let holdFired = false
		const longPressAction = key.longPressAction
		if (longPressAction) {
			// longPressAction and repeatOnHold are mutually exclusive — longPress
			// wins and repeat is never wired for this key.
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
					holdFired = true
					dispatch(longPressAction)
				}, DPAD_LONG_PRESS_MS)
			}
			button.addEventListener('touchstart', startLongPressTimer)
			button.addEventListener('touchend', cancelLongPressTimer)
			button.addEventListener('touchcancel', cancelLongPressTimer)
			button.addEventListener('mousedown', startLongPressTimer)
			button.addEventListener('mouseup', cancelLongPressTimer)
			button.addEventListener('mouseleave', cancelLongPressTimer)
		} else if (key.repeatOnHold) {
			let delayTimer: ReturnType<typeof setTimeout> | undefined
			let intervalTimer: ReturnType<typeof setInterval> | undefined
			const stopRepeat = (): void => {
				if (delayTimer !== undefined) clearTimeout(delayTimer)
				delayTimer = undefined
				if (intervalTimer !== undefined) clearInterval(intervalTimer)
				intervalTimer = undefined
			}
			const startRepeat = (): void => {
				stopRepeat()
				delayTimer = setTimeout(() => {
					delayTimer = undefined
					holdFired = true
					// Haptic once when repeat engages, not on every 100ms tick
					dispatch(key.action)
					intervalTimer = setInterval(() => dispatch(key.action, false), DPAD_REPEAT_INTERVAL_MS)
				}, DPAD_REPEAT_DELAY_MS)
			}
			button.addEventListener('touchstart', startRepeat)
			button.addEventListener('touchend', stopRepeat)
			button.addEventListener('touchcancel', stopRepeat)
			button.addEventListener('mousedown', startRepeat)
			button.addEventListener('mouseup', stopRepeat)
			button.addEventListener('mouseleave', stopRepeat)
		}

		onAttachmentTap(term, button, () => {
			if (holdFired) {
				holdFired = false
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
