import type { ButtonAction, ControlButton, XTerminal } from '../types'
import { el } from '../util/dom'
import { haptic } from '../util/haptic'
import { onAttachmentTap } from '../util/tap'
import { createAttachmentGuard, sendData } from '../util/terminal'
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

/**
 * Lifecycle state of one d-pad key press. Created on press start
 * (touchstart/mousedown), destroyed when the tap callback consumes the press
 * (or when a new press replaces an abnormally ended one). While no session
 * exists, press-scoped events (leave/cancel/close) are no-ops and bare
 * clicks dispatch directly — press state never outlives its press.
 */
interface PressSession {
	/** Re-checks the attachment generation captured at press start; false = the press's target changed mid-press */
	readonly stillCurrent: () => boolean
	/** True once the long-press/repeat fired — the release tap is then suppressed */
	holdFired: boolean
	/** True once the press was aborted (touchcancel/mouseleave/pad close) — a click trailing the abort must not dispatch */
	aborted: boolean
	/** Pending long-press / repeat-delay timer */
	delayTimer: ReturnType<typeof setTimeout> | undefined
	/** Active hold-to-repeat interval */
	intervalTimer: ReturnType<typeof setInterval> | undefined
}

/** Stop a press session's pending long-press/repeat-delay timer and hold-to-repeat interval */
const clearPressTimers = (session: PressSession): void => {
	if (session.delayTimer !== undefined) clearTimeout(session.delayTimer)
	session.delayTimer = undefined
	if (session.intervalTimer !== undefined) clearInterval(session.intervalTimer)
	session.intervalTimer = undefined
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

/** Read the persisted d-pad position; null when absent, corrupted, or storage is unavailable (e.g. iOS private mode) */
export function readDpadPosition(storage: Storage): DpadPosition | null {
	let raw: string | null
	try {
		raw = storage.getItem(DPAD_POSITION_STORAGE_KEY)
	} catch (error) {
		console.error('herdweb: failed to read d-pad position', error)
		return null
	}
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
 * Press lifecycle: every press (touchstart/mousedown) creates an explicit
 * PressSession that captures the attachment generation at press start and
 * carries holdFired/aborted/timers. Deferred sends (long-press callback,
 * repeat first shot and every tick) and the trailing mouse click all
 * re-check the generation — when the user switches target/attachment
 * mid-press, the press's timers stop and its release tap is suppressed, so
 * input never leaks into the newly attached session. The tap callback
 * consumes and destroys the session, so press state never outlives its
 * press: with no active press, leave/cancel/close events are no-ops and a
 * bare click (e.g. keyboard Tab+Enter activation) dispatches directly.
 * Abort paths (touchcancel, mouseleave, pad close via toggle) fail closed
 * while a press is active: timers stop and a residual click is suppressed.
 * Touch taps are guarded per-touch inside onAttachmentTap and keep their
 * existing semantics.
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
	// Pointer-only interaction — excluded from the Tab order.
	const handle = el(
		'button',
		{
			type: 'button',
			class: 'wt-dpad-handle',
			'aria-label': 'Drag to move pad, double-tap to dock',
			tabindex: '-1',
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
		try {
			localStorage.removeItem(DPAD_POSITION_STORAGE_KEY)
		} catch (error) {
			// Storage unavailable (e.g. iOS private mode): docking still works, the
			// stale persisted position simply stays until storage recovers
			console.error('herdweb: failed to clear d-pad position', error)
		}
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

	// Abort functions of in-flight key presses, so toggle() can stop their
	// deferred sends when the pad closes (a hidden pad must not keep sending)
	const activePressAborts = new Set<() => void>()

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

		// Per-press lifecycle state, carried by one explicit session object per
		// key. A press starts on touchstart/mousedown and captures the
		// attachment generation at that moment; every send derived from the
		// press (deferred callbacks AND the trailing mouse click) re-checks it
		// before dispatching. The tap callback after release consumes and
		// destroys the session, and every abort path (touchcancel, mouseleave,
		// pad close) only acts while a session exists — so with no active
		// press, leave/cancel/close are no-ops and a bare click dispatches
		// directly. No path combination carries state into the next tap.
		let press: PressSession | null = null

		/** Destroy the press session: stop its timers and detach it, so press-less events (bare clicks, late leave/cancel) see no leftover state */
		const destroyPress = (): void => {
			if (press !== null) clearPressTimers(press)
			press = null
			activePressAborts.delete(abortPress)
		}

		/** Gate a deferred send on the press-time attachment; a stale press stops ticking and its release tap is suppressed */
		const pressStillCurrent = (session: PressSession): boolean => {
			if (session.stillCurrent()) return true
			clearPressTimers(session)
			session.holdFired = true
			return false
		}

		/**
		 * Abort the active press (touchcancel / mouseleave / pad closed): stop
		 * its timers and fail closed — a click trailing the abort must not
		 * dispatch. No-op when no press is active: a leave/cancel arriving
		 * after the press completed must not leak abort state into the next
		 * press-less event (a bare click still dispatches).
		 */
		const abortPress = (): void => {
			const session = press
			if (session === null) return
			clearPressTimers(session)
			session.aborted = true
			activePressAborts.delete(abortPress)
		}

		/**
		 * End the press on release: stop timers, but keep the session (guard,
		 * holdFired, aborted) for the tap callback that follows (click /
		 * touchend) — the trailing mouse click still has to pass the
		 * press-time attachment check before it may dispatch.
		 */
		const releasePress = (): void => {
			if (press !== null) clearPressTimers(press)
			activePressAborts.delete(abortPress)
		}

		const startPress = (): void => {
			// Replace any leftover session from a previous, abnormally ended press
			destroyPress()
			const session: PressSession = {
				stillCurrent: createAttachmentGuard(term),
				holdFired: false,
				aborted: false,
				delayTimer: undefined,
				intervalTimer: undefined,
			}
			press = session
			activePressAborts.add(abortPress)
			const longPressAction = key.longPressAction
			if (longPressAction) {
				session.delayTimer = setTimeout(() => {
					session.delayTimer = undefined
					if (!pressStillCurrent(session)) return
					session.holdFired = true
					dispatch(longPressAction)
				}, DPAD_LONG_PRESS_MS)
			} else if (key.repeatOnHold) {
				session.delayTimer = setTimeout(() => {
					session.delayTimer = undefined
					if (!pressStillCurrent(session)) return
					session.holdFired = true
					// Haptic once when repeat engages, not on every 100ms tick
					dispatch(key.action)
					session.intervalTimer = setInterval(() => {
						if (!pressStillCurrent(session)) return
						dispatch(key.action, false)
					}, DPAD_REPEAT_INTERVAL_MS)
				}, DPAD_REPEAT_DELAY_MS)
			}
		}

		if (key.longPressAction) {
			// longPressAction and repeatOnHold are mutually exclusive — longPress
			// wins and repeat is never wired for this key.
			button.classList.add('wt-dpad-has-alt')
		}
		button.addEventListener('touchstart', startPress)
		button.addEventListener('touchend', releasePress)
		button.addEventListener('touchcancel', abortPress)
		button.addEventListener('mousedown', startPress)
		button.addEventListener('mouseup', releasePress)
		button.addEventListener('mouseleave', abortPress)

		onAttachmentTap(term, button, (event) => {
			// This tap consumes the press: destroy its session first, so press
			// state can never leak past this point. A tap with no session (e.g.
			// a keyboard-triggered bare click) dispatches directly — unchanged
			// pre-guard behaviour.
			const session = press
			destroyPress()
			if (session === null) {
				dispatch(key.action)
				return
			}
			if (session.holdFired) return
			// Touch taps (touchend) are already guarded per-touch with press-time
			// capture inside onAttachmentTap — skip re-checking here. Mouse clicks
			// are not covered there, so the trailing click re-checks the guard its
			// mousedown captured (mouseup keeps the session alive for exactly this
			// click). Fail closed: an aborted or stale press never dispatches.
			if (event.type === 'click' && (session.aborted || !session.stillCurrent())) return
			dispatch(key.action)
		})
		element.appendChild(button)
	}

	function toggle(): void {
		element.classList.toggle('open')
		if (!element.classList.contains('open')) {
			// Closing the pad aborts any in-flight press: stop its timers and
			// clear its hold state so a hidden pad never keeps sending.
			// Each abort removes itself from the set — safe mid-iteration.
			for (const abort of activePressAborts) abort()
			return
		}
		// Apply the persisted position on first open — only then is the pad
		// measurable, so the clamp can account for its real size.
		if (storedPositionApplied) return
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
