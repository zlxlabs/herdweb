import { describe, expect, test, vi } from 'vitest'
import { isDoubleTap } from '../src/gestures/double-tap'
import { createGestureLock, resetLock, tryLock } from '../src/gestures/lock'
import { clampFontSize, touchDistance } from '../src/gestures/pinch'
import {
	attachScrollGesture,
	averageY,
	createScrollEngine,
	pageSeq,
	scrollSeq,
	terminalGrid,
	touchToCell,
} from '../src/gestures/scroll'
import { isValidSwipe } from '../src/gestures/swipe'
import { mockTerminal } from './fixtures'

describe('isValidSwipe', () => {
	const config = {
		enabled: true,
		threshold: 80,
		maxDuration: 400,
		left: '\x02n',
		right: '\x02p',
		leftLabel: 'Next herdr tab',
		rightLabel: 'Previous herdr tab',
	}

	test('detects right swipe', () => {
		expect(isValidSwipe(100, 10, 200, config)).toBe('right')
	})

	test('detects left swipe', () => {
		expect(isValidSwipe(-100, 10, 200, config)).toBe('left')
	})

	test('rejects swipe below threshold', () => {
		expect(isValidSwipe(50, 10, 200, config)).toBeNull()
	})

	test('rejects swipe that takes too long', () => {
		expect(isValidSwipe(100, 10, 500, config)).toBeNull()
	})

	test('rejects diagonal swipe (dy too large)', () => {
		expect(isValidSwipe(100, 80, 200, config)).toBeNull()
	})

	test('handles zero duration', () => {
		expect(isValidSwipe(100, 0, 0, config)).toBe('right')
	})

	test('respects custom threshold', () => {
		const strict = {
			enabled: true,
			threshold: 200,
			maxDuration: 400,
			left: '\x02n',
			right: '\x02p',
			leftLabel: 'Next herdr tab',
			rightLabel: 'Previous herdr tab',
		}
		expect(isValidSwipe(150, 10, 200, strict)).toBeNull()
		expect(isValidSwipe(250, 10, 200, strict)).toBe('right')
	})
})

describe('touchDistance', () => {
	test('calculates distance between two points', () => {
		const d = touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })
		expect(d).toBe(5)
	})

	test('handles same point', () => {
		const d = touchDistance({ clientX: 10, clientY: 20 }, { clientX: 10, clientY: 20 })
		expect(d).toBe(0)
	})

	test('handles negative coordinates', () => {
		const d = touchDistance({ clientX: -3, clientY: 0 }, { clientX: 0, clientY: 4 })
		expect(d).toBe(5)
	})
})

describe('clampFontSize', () => {
	test('clamps to minimum', () => {
		expect(clampFontSize(4, [8, 32])).toBe(8)
	})

	test('clamps to maximum', () => {
		expect(clampFontSize(40, [8, 32])).toBe(32)
	})

	test('passes through values in range', () => {
		expect(clampFontSize(16, [8, 32])).toBe(16)
	})

	test('handles boundary values', () => {
		expect(clampFontSize(8, [8, 32])).toBe(8)
		expect(clampFontSize(32, [8, 32])).toBe(32)
	})
})

describe('createGestureLock', () => {
	test('starts unclaimed', () => {
		const lock = createGestureLock()
		expect(lock.current).toBe('none')
	})
})

describe('tryLock', () => {
	test('claims when unclaimed', () => {
		const lock = createGestureLock()
		expect(tryLock(lock, 'scroll')).toBe(true)
		expect(lock.current).toBe('scroll')
	})

	test('rejects when already claimed', () => {
		const lock = createGestureLock()
		tryLock(lock, 'scroll')
		expect(tryLock(lock, 'pinch')).toBe(false)
		expect(lock.current).toBe('scroll')
	})

	test('rejects same type when already claimed', () => {
		const lock = createGestureLock()
		tryLock(lock, 'pinch')
		expect(tryLock(lock, 'pinch')).toBe(false)
	})
})

describe('resetLock', () => {
	test('clears to none', () => {
		const lock = createGestureLock()
		tryLock(lock, 'scroll')
		resetLock(lock)
		expect(lock.current).toBe('none')
	})

	test('allows re-claim after reset', () => {
		const lock = createGestureLock()
		tryLock(lock, 'scroll')
		resetLock(lock)
		expect(tryLock(lock, 'pinch')).toBe(true)
		expect(lock.current).toBe('pinch')
	})
})

describe('averageY', () => {
	test('calculates average of two Y values', () => {
		expect(averageY({ clientY: 100 }, { clientY: 200 })).toBe(150)
	})

	test('handles equal values', () => {
		expect(averageY({ clientY: 50 }, { clientY: 50 })).toBe(50)
	})

	test('handles negative values', () => {
		expect(averageY({ clientY: -10 }, { clientY: 30 })).toBe(10)
	})
})

describe('scrollSeq', () => {
	test('returns SGR mouse wheel up sequence', () => {
		expect(scrollSeq('up', 12, 8)).toBe('\x1b[<64;12;8M')
	})

	test('returns SGR mouse wheel down sequence', () => {
		expect(scrollSeq('down', 2, 3)).toBe('\x1b[<65;2;3M')
	})
})

describe('pageSeq', () => {
	test('returns page up sequence', () => {
		expect(pageSeq('up')).toBe('\x1b[5~')
	})

	test('returns page down sequence', () => {
		expect(pageSeq('down')).toBe('\x1b[6~')
	})

	test('uses natural scroll direction (positive pendingPx → up)', async () => {
		const { readFileSync } = await import('node:fs')
		const { resolve } = await import('node:path')
		const source = readFileSync(resolve(import.meta.dirname, '../src/gestures/scroll.ts'), 'utf-8')
		expect(source).toContain("pendingPx > 0 ? 'up' : 'down'")
	})

	test('source uses \\x3c instead of literal < in SGR sequences', async () => {
		const { readFileSync } = await import('node:fs')
		const { resolve } = await import('node:path')
		const source = readFileSync(resolve(import.meta.dirname, '../src/gestures/scroll.ts'), 'utf-8')
		// Source must use \x3c (hex escape) not literal < in SGR sequences
		// to avoid breaking HTML parsing when bundled into inline <script>
		expect(source).toContain('\\x3c${code};${x};${y}M')
	})
})

describe('terminalGrid', () => {
	test('returns cols/rows from terminal when available', () => {
		const term = { ...mockTerminal(), cols: 120, rows: 40 }
		const rect = { width: 800, height: 600 } as DOMRect
		expect(terminalGrid(rect, term)).toEqual({ cols: 120, rows: 40 })
	})

	test('rounds non-integer cols/rows', () => {
		const term = { ...mockTerminal(), cols: 79.6, rows: 23.4 }
		const rect = { width: 800, height: 600 } as DOMRect
		expect(terminalGrid(rect, term)).toEqual({ cols: 80, rows: 23 })
	})

	test('falls back to 80x24 when term has no cols/rows and no measure element', () => {
		const term = mockTerminal()
		const rect = { width: 800, height: 600 } as DOMRect
		expect(terminalGrid(rect, term)).toEqual({ cols: 80, rows: 24 })
	})

	test('falls back to 80x24 when cols/rows are zero', () => {
		const term = { ...mockTerminal(), cols: 0, rows: 0 }
		const rect = { width: 800, height: 600 } as DOMRect
		expect(terminalGrid(rect, term)).toEqual({ cols: 80, rows: 24 })
	})

	test('falls back to 80x24 when char measure element has zero dimensions', () => {
		// happy-dom doesn't compute real layout so getBoundingClientRect returns zeros,
		// which exercises the fallback path rather than the measure element path
		const term = mockTerminal()
		const rect = { width: 800, height: 480 } as DOMRect
		const measure = document.createElement('span')
		measure.className = 'xterm-char-measure-element'
		measure.style.width = '10px'
		measure.style.height = '20px'
		document.body.appendChild(measure)
		const result = terminalGrid(rect, term)
		expect(result.cols).toBeGreaterThan(0)
		expect(result.rows).toBeGreaterThan(0)

		document.body.removeChild(measure)
	})
})

describe('touchToCell', () => {
	function makeScreen(width: number, height: number): HTMLElement {
		const el = document.createElement('div')
		Object.defineProperty(el, 'getBoundingClientRect', {
			value: () => ({
				left: 0,
				top: 0,
				width,
				height,
				right: width,
				bottom: height,
				x: 0,
				y: 0,
				toJSON() {},
			}),
		})
		return el
	}

	function makeTouch(clientX: number, clientY: number): Touch {
		return { clientX, clientY } as Touch
	}

	test('touch at top-left returns cell (1, 1)', () => {
		const screen = makeScreen(800, 480)
		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		expect(touchToCell(makeTouch(0, 0), screen, term)).toEqual({ x: 1, y: 1 })
	})

	test('touch at bottom-right returns cell (cols, rows)', () => {
		const screen = makeScreen(800, 480)
		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		// Touch at the far edge — should map to last cell
		expect(touchToCell(makeTouch(799, 479), screen, term)).toEqual({ x: 80, y: 24 })
	})

	test('touch at centre returns middle cell', () => {
		const screen = makeScreen(800, 480)
		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		const cell = touchToCell(makeTouch(400, 240), screen, term)
		expect(cell.x).toBe(41)
		expect(cell.y).toBe(13)
	})

	test('clamps touch outside screen bounds', () => {
		const screen = makeScreen(800, 480)
		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		// Touch far below/right of screen
		expect(touchToCell(makeTouch(9999, 9999), screen, term)).toEqual({ x: 80, y: 24 })
		// Touch above/left of screen
		expect(touchToCell(makeTouch(-100, -100), screen, term)).toEqual({ x: 1, y: 1 })
	})
})

describe('isDoubleTap', () => {
	const maxInterval = 300
	const maxDistance = 50

	test('within interval and distance returns true', () => {
		expect(isDoubleTap(200, 30, maxInterval, maxDistance)).toBe(true)
	})

	test('exceeds interval returns false', () => {
		expect(isDoubleTap(400, 30, maxInterval, maxDistance)).toBe(false)
	})

	test('zero dt (simultaneous) returns false', () => {
		expect(isDoubleTap(0, 10, maxInterval, maxDistance)).toBe(false)
	})

	test('exact interval boundary returns true', () => {
		expect(isDoubleTap(300, 30, maxInterval, maxDistance)).toBe(true)
	})

	test('negative dt returns false', () => {
		expect(isDoubleTap(-100, 10, maxInterval, maxDistance)).toBe(false)
	})

	test('within distance returns true', () => {
		expect(isDoubleTap(200, 49, maxInterval, maxDistance)).toBe(true)
	})

	test('exceeds distance returns false', () => {
		expect(isDoubleTap(200, 60, maxInterval, maxDistance)).toBe(false)
	})

	test('exact distance boundary returns true', () => {
		expect(isDoubleTap(200, 50, maxInterval, maxDistance)).toBe(true)
	})

	test('within time but too far apart returns false', () => {
		expect(isDoubleTap(100, 80, maxInterval, maxDistance)).toBe(false)
	})

	test('close enough but too slow returns false', () => {
		expect(isDoubleTap(500, 10, maxInterval, maxDistance)).toBe(false)
	})
})

const defaultScrollConfig = {
	enabled: true,
	strategy: 'wheel' as const,
	speedMultiplier: 1,
	linesPerWheel: 1,
	momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
	maxLinesPerSend: 24,
	sendIntervalMs: 33,
}

const cell = { x: 5, y: 10 }

function countWheelLines(data: string | undefined, direction: 'up' | 'down'): number {
	if (!data) return 0
	const unit = scrollSeq(direction, cell.x, cell.y)
	let count = 0
	let idx = 0
	while (idx < data.length) {
		if (data.startsWith(unit, idx)) {
			count += 1
			idx += unit.length
			continue
		}
		break
	}
	return count
}

describe('createScrollEngine', () => {
	test('quantizes small deltas without line drift (linesPerWheel=1)', () => {
		const engine = createScrollEngine(defaultScrollConfig)
		const cellHeight = 20
		const deltas = [3, 4, 5, 3, 4, 5, 3, 4, 5]
		const totalPx = deltas.reduce((sum, dy) => sum + dy, 0)
		const expectedLines = Math.trunc((totalPx * defaultScrollConfig.speedMultiplier) / cellHeight)

		engine.onTouchStart(0)
		let lines = 0
		let t = 0
		for (const dy of deltas) {
			t += 16
			engine.onTouchMove(t, dy)
			const result = engine.tick(t, cellHeight, cell)
			if (result) {
				lines += countWheelLines(result.data, 'up')
			}
		}
		while (engine.isAnimationActive(cellHeight) && t < 10_000) {
			t += 16
			const result = engine.tick(t, cellHeight, cell)
			if (result) {
				lines += countWheelLines(result.data, 'up')
			}
		}

		expect(lines).toBe(expectedLines)
		expect(Math.abs(engine.pendingPx)).toBeLessThan(cellHeight)
	})

	test('touchstart preserves pendingPx remainder across gestures', () => {
		const engine = createScrollEngine(defaultScrollConfig)
		const cellHeight = 20

		engine.onTouchStart(0)
		engine.onTouchMove(16, 15)
		expect(engine.pendingPx).toBe(15)

		engine.onTouchEnd(32)
		engine.onTouchStart(100)
		expect(engine.pendingPx).toBe(15)

		const result = engine.tick(116, cellHeight, cell)
		expect(result).toBeNull()
		expect(engine.pendingPx).toBe(15)
	})

	test('reset clears a sub-cell remainder before the next attachment', () => {
		const engine = createScrollEngine(defaultScrollConfig)
		const cellHeight = 20

		engine.onTouchStart(0)
		engine.onTouchMove(16, 39)
		engine.tick(16, cellHeight, cell)
		expect(engine.pendingPx).toBe(19)

		engine.reset()
		engine.onTouchStart(100)
		engine.onTouchMove(116, 21)
		const result = engine.tick(116, cellHeight, cell)

		expect(result?.data).toBe(scrollSeq('up', cell.x, cell.y))
	})

	test('emits one batched sendData payload per send interval', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			sendIntervalMs: 0,
			linesPerWheel: 3,
			maxLinesPerSend: 24,
		})
		const cellHeight = 20
		const pxPerWheel = (cellHeight * 3) / 1
		const dy = pxPerWheel * 5

		engine.onTouchStart(0)
		engine.onTouchMove(16, dy)
		const result = engine.tick(16, cellHeight, cell)

		expect(result).not.toBeNull()
		const unit = scrollSeq('up', cell.x, cell.y)
		expect(result?.data).toBe(unit.repeat(5))
		expect(
			result?.data.match(new RegExp(unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
		).toHaveLength(5)
	})

	test('maxLinesPerSend clamps wheel events and leaves remainder in pendingPx', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			sendIntervalMs: 0,
			linesPerWheel: 3,
			maxLinesPerSend: 24,
		})
		const cellHeight = 20
		const pxPerWheel = (cellHeight * 3) / 1
		const maxEvents = Math.floor(24 / 3)
		const dy = pxPerWheel * (maxEvents + 3)

		engine.onTouchStart(0)
		engine.onTouchMove(16, dy)
		const result = engine.tick(16, cellHeight, cell)

		expect(result).not.toBeNull()
		const unit = scrollSeq('up', cell.x, cell.y)
		expect(result?.data).toBe(unit.repeat(maxEvents))
		expect(Math.abs(engine.pendingPx)).toBeCloseTo(pxPerWheel * 3, 5)
	})

	test('fling decays to minVelocity and stops scheduling', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			momentum: { enabled: true, friction: 0.5, minVelocity: 0.02 },
		})
		const cellHeight = 20

		engine.onTouchStart(0)
		for (let i = 1; i <= 5; i++) {
			engine.onTouchMove(i * 16, 40)
		}
		engine.onTouchEnd(80)
		expect(engine.isFlinging).toBe(true)

		let frames = 0
		let t = 80
		while (engine.isAnimationActive(cellHeight) && frames < 500) {
			t += 16
			engine.tick(t, cellHeight, cell)
			frames += 1
		}

		expect(engine.isFlinging).toBe(false)
		expect(engine.isAnimationActive(cellHeight)).toBe(false)
		expect(frames).toBeLessThan(500)
	})

	test('keys strategy does not fling on touch end', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			strategy: 'keys',
			linesPerWheel: 3,
		})
		const cellHeight = 20
		const pxPerWheel = (cellHeight * 3) / 1

		engine.onTouchStart(0)
		engine.onTouchMove(16, pxPerWheel)
		engine.onTouchEnd(32)
		expect(engine.isFlinging).toBe(false)
	})

	test('keys strategy emits at most one pageSeq per send', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			sendIntervalMs: 0,
			strategy: 'keys',
			linesPerWheel: 3,
			maxLinesPerSend: 24,
		})
		const cellHeight = 20
		const pxPerWheel = (cellHeight * 3) / 1

		engine.onTouchStart(0)
		engine.onTouchMove(16, pxPerWheel * 3)
		const result = engine.tick(16, cellHeight, cell)

		expect(result?.data).toBe(pageSeq('up'))
		expect(Math.abs(engine.pendingPx)).toBeCloseTo(pxPerWheel * 2, 5)
	})

	test('stopFling cancels inertial scroll', () => {
		const engine = createScrollEngine({
			...defaultScrollConfig,
			momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
		})
		const cellHeight = 20

		engine.onTouchStart(0)
		for (let i = 1; i <= 5; i++) {
			engine.onTouchMove(i * 16, 40)
		}
		engine.onTouchEnd(80)
		expect(engine.isFlinging).toBe(true)

		const pendingBeforeStop = engine.pendingPx

		engine.stopFling()
		expect(engine.isFlinging).toBe(false)

		engine.tick(96, cellHeight, cell)
		const pendingAfterStoppedTick = engine.pendingPx

		const flinging = createScrollEngine({
			...defaultScrollConfig,
			momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
		})
		flinging.onTouchStart(0)
		for (let i = 1; i <= 5; i++) {
			flinging.onTouchMove(i * 16, 40)
		}
		flinging.onTouchEnd(80)
		expect(flinging.isFlinging).toBe(true)
		flinging.tick(96, cellHeight, cell)
		const pendingAfterFlingTick = flinging.pendingPx

		expect(pendingAfterStoppedTick - pendingBeforeStop).toBeLessThan(
			pendingAfterFlingTick - pendingBeforeStop,
		)
	})

	function countSendsOverDuration(
		config: typeof defaultScrollConfig,
		cellHeight: number,
		dyPerFrame: number,
		frameMs: number,
		durationMs: number,
	): { sendCount: number; totalLines: number } {
		const engine = createScrollEngine(config)
		let sendCount = 0
		let totalLines = 0
		let t = 0

		engine.onTouchStart(0)
		for (t = frameMs; t <= durationMs; t += frameMs) {
			engine.onTouchMove(t, dyPerFrame)
			const result = engine.tick(t, cellHeight, cell)
			if (result) {
				sendCount += 1
				totalLines += countWheelLines(result.data, 'up')
			}
		}
		while (engine.isAnimationActive(cellHeight) && t < durationMs + 10_000) {
			t += frameMs
			const result = engine.tick(t, cellHeight, cell)
			if (result) {
				sendCount += 1
				totalLines += countWheelLines(result.data, 'up')
			}
		}

		return { sendCount, totalLines }
	}

	function countFlingEndFrame(config: typeof defaultScrollConfig, cellHeight: number): number {
		const engine = createScrollEngine(config)

		engine.onTouchStart(0)
		for (let i = 1; i <= 5; i++) {
			engine.onTouchMove(i * 16, 40)
		}
		engine.onTouchEnd(80)

		let frames = 0
		let t = 80
		while (engine.isFlinging && frames < 500) {
			t += 16
			engine.tick(t, cellHeight, cell)
			frames += 1
		}
		return frames
	}

	test('sendIntervalMs throttles wheel sends to ~30Hz without losing displacement', () => {
		const cellHeight = 20
		const frameMs = 1000 / 60
		const durationMs = 1000
		const pxPerWheel =
			(cellHeight * defaultScrollConfig.linesPerWheel) / defaultScrollConfig.speedMultiplier
		const dyPerFrame = pxPerWheel
		const frameCount = Math.floor((durationMs - frameMs) / frameMs) + 1
		const totalPx = dyPerFrame * frameCount
		const expectedLines = Math.trunc(
			(totalPx * defaultScrollConfig.speedMultiplier) /
				cellHeight /
				defaultScrollConfig.linesPerWheel,
		)

		const throttled = countSendsOverDuration(
			defaultScrollConfig,
			cellHeight,
			dyPerFrame,
			frameMs,
			durationMs,
		)
		const unthrottled = countSendsOverDuration(
			{ ...defaultScrollConfig, sendIntervalMs: 0 },
			cellHeight,
			dyPerFrame,
			frameMs,
			durationMs,
		)

		expect(unthrottled.sendCount).toBe(frameCount)
		expect(throttled.sendCount).toBeGreaterThanOrEqual(29)
		expect(throttled.sendCount).toBeLessThanOrEqual(31)
		expect(throttled.totalLines).toBe(expectedLines)
		expect(unthrottled.totalLines).toBe(expectedLines)
		expect(throttled.totalLines).toBe(unthrottled.totalLines)
	})

	test('sendIntervalMs: 0 sends every frame with redeemable pending', () => {
		const cellHeight = 20
		const frameMs = 16
		const pxPerWheel =
			(cellHeight * defaultScrollConfig.linesPerWheel) / defaultScrollConfig.speedMultiplier
		const engine = createScrollEngine({ ...defaultScrollConfig, sendIntervalMs: 0 })

		engine.onTouchStart(0)
		let sendCount = 0
		for (let frame = 1; frame <= 60; frame += 1) {
			const t = frame * frameMs
			engine.onTouchMove(t, pxPerWheel)
			const result = engine.tick(t, cellHeight, cell)
			if (result) sendCount += 1
		}

		expect(sendCount).toBe(60)
	})

	test('fling physics duration is unchanged by send throttling', () => {
		const cellHeight = 20
		const throttledFrames = countFlingEndFrame(defaultScrollConfig, cellHeight)
		const unthrottledFrames = countFlingEndFrame(
			{ ...defaultScrollConfig, sendIntervalMs: 0 },
			cellHeight,
		)

		expect(throttledFrames).toBe(unthrottledFrames)
	})
})

describe('attachScrollGesture', () => {
	function makeScreen(getHeight: () => number): {
		element: HTMLElement
		measureSpy: ReturnType<typeof vi.fn>
	} {
		const measureSpy = vi.fn(() => {
			const height = getHeight()
			return {
				left: 0,
				top: 0,
				width: 800,
				height,
				right: 800,
				bottom: height,
				x: 0,
				y: 0,
				toJSON() {},
			}
		})
		const el = document.createElement('div')
		el.className = 'xterm-screen'
		Object.defineProperty(el, 'getBoundingClientRect', { value: measureSpy })
		return { element: el, measureSpy }
	}

	function makeTouch(screen: HTMLElement, clientY: number): Touch {
		return {
			identifier: 0,
			target: screen,
			clientX: 400,
			clientY,
			force: 1,
			radiusX: 1,
			radiusY: 1,
			rotationAngle: 0,
			pageX: 400,
			pageY: clientY,
			screenX: 400,
			screenY: clientY,
		} as Touch
	}

	function dispatchGesture(screen: HTMLElement, startY: number, endY: number): void {
		screen.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, startY)],
			}),
		)
		screen.dispatchEvent(
			new TouchEvent('touchmove', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, endY)],
			}),
		)
		screen.dispatchEvent(
			new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }),
		)
	}

	test('adapter calls sendData once per animation frame with batched payload', () => {
		const sent: string[] = []
		const term = {
			...mockTerminal(),
			cols: 80,
			rows: 24,
			input(data: string) {
				sent.push(data)
			},
		}
		const lock = createGestureLock()
		const { element: screen } = makeScreen(() => 480)
		const scrollConfig = {
			...defaultScrollConfig,
			sendIntervalMs: 0,
			linesPerWheel: 3,
			maxLinesPerSend: 24,
		}
		const wheelCount = 5
		const pxPerWheel = (480 / 24) * scrollConfig.linesPerWheel

		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(16)
			return 1
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())

		document.body.appendChild(screen)
		attachScrollGesture(term, scrollConfig, lock, () => false)

		screen.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, 100)],
			}),
		)
		sent.length = 0
		screen.dispatchEvent(
			new TouchEvent('touchmove', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, 100 + wheelCount * pxPerWheel)],
			}),
		)

		expect(sent.length).toBe(1)
		const { x, y } = touchToCell(makeTouch(screen, 100), screen, term)
		expect(sent[0]).toBe(scrollSeq('up', x, y).repeat(wheelCount))

		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})

	test('touchmove hot path does not call layout APIs in attachScrollGesture', () => {
		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		const lock = createGestureLock()
		const { element: screen, measureSpy } = makeScreen(() => 480)

		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(16)
			return 1
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())

		document.body.appendChild(screen)
		attachScrollGesture(term, defaultScrollConfig, lock, () => false)

		screen.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, 100)],
			}),
		)
		const measureCallsAfterStart = measureSpy.mock.calls.length

		for (let i = 1; i <= 5; i++) {
			screen.dispatchEvent(
				new TouchEvent('touchmove', {
					bubbles: true,
					cancelable: true,
					touches: [makeTouch(screen, 100 + i * 30)],
				}),
			)
		}

		expect(measureSpy.mock.calls.length).toBe(measureCallsAfterStart)

		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})

	test('touchcancel stops fling and cancels scheduled rAF', () => {
		const cancelSpy = vi.fn()
		let pendingRafId: number | null = null
		vi.stubGlobal('requestAnimationFrame', () => {
			pendingRafId = 1
			return pendingRafId
		})
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			cancelSpy(id)
			pendingRafId = null
		})

		const term = { ...mockTerminal(), cols: 80, rows: 24 }
		const lock = createGestureLock()

		const { element: screen } = makeScreen(() => 480)
		document.body.appendChild(screen)

		attachScrollGesture(term, defaultScrollConfig, lock, () => false)

		screen.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, 100)],
			}),
		)
		screen.dispatchEvent(
			new TouchEvent('touchmove', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(screen, 200)],
			}),
		)
		expect(pendingRafId).not.toBeNull()

		screen.dispatchEvent(
			new TouchEvent('touchcancel', { bubbles: true, cancelable: true, touches: [] }),
		)

		expect(cancelSpy).toHaveBeenCalledWith(1)
		expect(pendingRafId).toBeNull()

		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})

	test('touchstart remeasures cellHeight on every gesture', () => {
		let screenHeight = 480
		const sent: string[] = []
		const term = {
			...mockTerminal(),
			cols: 80,
			rows: 24,
			input(data: string) {
				sent.push(data)
			},
		}
		const lock = createGestureLock()
		const { element: screen, measureSpy } = makeScreen(() => screenHeight)

		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(16)
			return 1
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())

		document.body.appendChild(screen)
		attachScrollGesture(term, defaultScrollConfig, lock, () => false)

		const callsBeforeFirst = measureSpy.mock.calls.length
		dispatchGesture(screen, 100, 160)
		const callsAfterFirst = measureSpy.mock.calls.length
		expect(callsAfterFirst).toBeGreaterThan(callsBeforeFirst)

		screenHeight = 600
		sent.length = 0
		const callsBeforeSecond = measureSpy.mock.calls.length
		dispatchGesture(screen, 100, 170)
		const callsAfterSecond = measureSpy.mock.calls.length
		expect(callsAfterSecond).toBeGreaterThan(callsBeforeSecond)
		expect(sent.length).toBe(0)

		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})
})
