import type { XTerminal } from '../types'
import { haptic } from '../util/haptic'
import { createAttachmentGuard, sendData } from '../util/terminal'
import type { GestureLock } from './lock'
import { resetLock, tryLock } from './lock'
import { touchToCell } from './scroll'

/** Hold time (ms) before emitting SGR right-click. Aligned with `src/controls/dpad.ts:88` `DPAD_LONG_PRESS_MS`. */
export const LONG_PRESS_MS = 500

/** Movement (px) that cancels a pending long-press. Aligned with `src/gestures/double-tap.ts:5` `MAX_TAP_MOVEMENT`. */
const MAX_TAP_MOVEMENT = 10

/** SGR button code 2 = right mouse button */
const SGR_RIGHT_BUTTON = 2

function sgrRightClick(col: number, row: number, down: boolean): string {
	const kind = down ? 'M' : 'm'
	return `\x1b[\x3c${SGR_RIGHT_BUTTON};${col};${row}${kind}`
}

function preventContextMenu(e: Event): void {
	e.preventDefault()
}

/** Attach long-press → SGR right-click on the xterm screen */
export function attachLongPressGesture(term: XTerminal, lock: GestureLock): void {
	let timer: ReturnType<typeof setTimeout> | null = null
	let startX = 0
	let startY = 0
	let startTouch: Touch | null = null
	let screenEl: HTMLElement | null = null
	let guard: (() => boolean) | null = null
	let claimed = false

	function clearTimer(): void {
		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}
	}

	function abort(): void {
		clearTimer()
		startTouch = null
		guard = null
		if (claimed) {
			resetLock(lock)
			claimed = false
		}
	}

	function fire(): void {
		timer = null
		const sessionGuard = guard
		const touch = startTouch
		const screen = screenEl
		if (!sessionGuard || !sessionGuard()) return
		if (!touch || !screen) return
		if (!tryLock(lock, 'long-press')) return
		claimed = true
		const cell = touchToCell(touch, screen, term)
		sendData(term, sgrRightClick(cell.x, cell.y, true))
		sendData(term, sgrRightClick(cell.x, cell.y, false))
		haptic()
	}

	function onTouchStart(e: Event): void {
		if (!(e instanceof TouchEvent)) return
		abort()
		if (e.touches.length !== 1) return
		const touch = e.touches[0]
		if (!touch) return
		startX = touch.clientX
		startY = touch.clientY
		startTouch = touch
		guard = createAttachmentGuard(term)
		timer = setTimeout(fire, LONG_PRESS_MS)
	}

	function onTouchMove(e: Event): void {
		if (!(e instanceof TouchEvent)) return
		if (timer === null) return
		if (e.touches.length > 1) {
			abort()
			return
		}
		const touch = e.touches[0]
		if (!touch) return
		const dx = touch.clientX - startX
		const dy = touch.clientY - startY
		if (Math.sqrt(dx * dx + dy * dy) > MAX_TAP_MOVEMENT) {
			abort()
		}
	}

	function onTouchEnd(): void {
		abort()
	}

	function onTouchCancel(): void {
		abort()
	}

	function attach(): void {
		const screen = document.querySelector('.xterm-screen')
		if (!(screen instanceof HTMLElement)) {
			setTimeout(attach, 200)
			return
		}
		screenEl = screen
		screen.addEventListener('touchstart', onTouchStart, { passive: true })
		screen.addEventListener('touchmove', onTouchMove, { passive: true })
		screen.addEventListener('touchend', onTouchEnd, { passive: true })
		screen.addEventListener('touchcancel', onTouchCancel, { passive: true })
		screen.addEventListener('contextmenu', preventContextMenu, { passive: false })
	}

	attach()
}
