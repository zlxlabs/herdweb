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

/** localStorage key for the user-dragged d-pad position (same `herdweb:` prefix as herdweb:fontSize) */
export const DPAD_POSITION_STORAGE_KEY = 'herdweb:dpadPosition'

/** Drag distance (px) below which a handle press is a tap, not a drag */
const DPAD_DRAG_THRESHOLD_PX = 4

/** Double-tap window (ms) on the handle that docks the pad back to its default position */
const DPAD_DOCK_DOUBLE_TAP_MS = 300

/** Top-left corner of the pad in viewport pixels */
interface DpadPosition {
	readonly x: number
	readonly y: number
}

/** Clamp a d-pad position into the visible viewport (a pad larger than the viewport pins to 0) */
export function clampDpadPosition(
	position: DpadPosition,
	viewportWidth: number,
	viewportHeight: number,
	padWidth: number,
	padHeight: number,
): DpadPosition {
	return {
		x: Math.min(Math.max(0, position.x), Math.max(0, viewportWidth - padWidth)),
		y: Math.min(Math.max(0, position.y), Math.max(0, viewportHeight - padHeight)),
	}
}

/** Read the persisted d-pad position; null when absent or corrupted (corruption is treated as absent) */
export function readDpadPosition(storage: Storage): DpadPosition | null {
	const raw = storage.getItem(DPAD_POSITION_STORAGE_KEY)
	if (raw === null) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null) return null
	if (!('x' in parsed) || !('y' in parsed)) return null
	const { x, y } = parsed
	if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
		return null
	return { x, y }
}

/** Persist the d-pad position; returns false when storage rejects the write (e.g. iOS private mode) */
export function writeDpadPosition(storage: Storage, position: DpadPosition): boolean {
	try {
		storage.setItem(DPAD_POSITION_STORAGE_KEY, JSON.stringify(position))
		return true
	} catch (error) {
		console.error('herdweb: failed to persist d-pad position', error)
		return false
	}
}

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

	// Drag handle (slim full-width strip above the key grid): drag to move the
	// pad out of the way of bottom-of-terminal agent menus; double-tap docks it
	// back. The dragged position persists in localStorage and is applied
	// (viewport-clamped) on first open. Focus safety: like the keys, the handle
	// suppresses the synthesised mousedown, and desktop mousedown is
	// default-prevented, so dragging never steals terminal textarea focus.
	const handle = el(
		'button',
		{
			type: 'button',
			class: 'wt-dpad-handle',
			'aria-label': 'Drag to move pad, double-tap to dock',
		},
		'⠿',
	)
	suppressSynthesisedMouse(handle)
	handle.addEventListener('mousedown', (event) => event.preventDefault())
	element.appendChild(handle)

	let currentPosition: DpadPosition | null = null
	const applyPosition = (position: DpadPosition): void => {
		currentPosition = position
		element.classList.add('wt-dpad-floating')
		element.style.left = `${position.x}px`
		element.style.top = `${position.y}px`
	}
	const dock = (): void => {
		currentPosition = null
		element.classList.remove('wt-dpad-floating')
		element.style.left = ''
		element.style.top = ''
		localStorage.removeItem(DPAD_POSITION_STORAGE_KEY)
	}

	let dragStart: {
		readonly pointerX: number
		readonly pointerY: number
		readonly originX: number
		readonly originY: number
	} | null = null
	let dragMoved = false
	let lastHandleTapAt = 0

	handle.addEventListener('pointerdown', (event) => {
		handle.setPointerCapture(event.pointerId)
		const rect = element.getBoundingClientRect()
		dragStart = {
			pointerX: event.clientX,
			pointerY: event.clientY,
			originX: rect.left,
			originY: rect.top,
		}
		dragMoved = false
	})
	handle.addEventListener('pointermove', (event) => {
		if (!dragStart) return
		const dx = event.clientX - dragStart.pointerX
		const dy = event.clientY - dragStart.pointerY
		if (!dragMoved && Math.abs(dx) + Math.abs(dy) < DPAD_DRAG_THRESHOLD_PX) return
		dragMoved = true
		applyPosition({ x: dragStart.originX + dx, y: dragStart.originY + dy })
	})
	handle.addEventListener('pointerup', (event) => {
		if (!dragStart) return
		dragStart = null
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
		if (dragMoved) {
			const rect = element.getBoundingClientRect()
			const clamped = clampDpadPosition(
				currentPosition ?? { x: rect.left, y: rect.top },
				window.innerWidth,
				window.innerHeight,
				rect.width,
				rect.height,
			)
			applyPosition(clamped)
			writeDpadPosition(localStorage, clamped)
			return
		}
		// No movement: a quick second tap docks the pad back to its default position
		const now = Date.now()
		if (now - lastHandleTapAt < DPAD_DOCK_DOUBLE_TAP_MS) {
			lastHandleTapAt = 0
			dock()
		} else {
			lastHandleTapAt = now
		}
	})
	handle.addEventListener('pointercancel', () => {
		dragStart = null
	})

	let storedPositionApplied = false

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
		// Apply the persisted position on first open — only then is the pad
		// measurable, so the clamp can account for its real size.
		if (!element.classList.contains('open') || storedPositionApplied) return
		storedPositionApplied = true
		const stored = readDpadPosition(localStorage)
		if (!stored) return
		const rect = element.getBoundingClientRect()
		applyPosition(
			clampDpadPosition(stored, window.innerWidth, window.innerHeight, rect.width, rect.height),
		)
	}

	return { element, toggle }
}
