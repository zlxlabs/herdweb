import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NotifyEvent } from '../src/notify/events'
import { createSilenceDetector } from '../src/notify/silence'

const BASE_CONFIG = {
	enabled: true,
	busyMs: 30_000,
	quietMs: 180_000,
	cooldownMs: 600_000,
}

function makeHarness(
	overrides: {
		bytesInWindow?: (windowMs: number) => number
		lastOutputAt?: () => number | undefined
		lastEventAt?: (sessionKey: string) => number | undefined
		enabled?: boolean
	} = {},
) {
	const dispatched: NotifyEvent[] = []
	let nowMs = 0
	const bytesInWindow = overrides.bytesInWindow ?? (() => 0)
	const lastOutputAt = overrides.lastOutputAt
	const lastEventAt = overrides.lastEventAt ?? (() => undefined)

	const detector = createSilenceDetector({
		sessionKey: 'dev',
		config: { ...BASE_CONFIG, enabled: overrides.enabled ?? true },
		bytesInWindow,
		...(lastOutputAt !== undefined ? { lastOutputAt } : {}),
		dispatch: (event) => dispatched.push(event),
		lastEventAt,
		now: () => nowMs,
		setIntervalMs: 30_000,
	})

	return {
		dispatched,
		advance(ms: number) {
			nowMs += ms
			vi.advanceTimersByTime(ms)
		},
		dispose: () => detector.dispose(),
	}
}

describe('createSilenceDetector', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('never busy — never triggers', () => {
		const h = makeHarness({ bytesInWindow: () => 512 })
		h.advance(600_000)
		expect(h.dispatched).toHaveLength(0)
		h.dispose()
	})

	test('busy then 180s quiet — triggers once', () => {
		let busy = true
		let lastOut = 0
		const h = makeHarness({
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => (busy ? lastOut : lastOut),
		})
		h.advance(30_000)
		busy = false
		lastOut = 0
		h.advance(180_000)
		expect(h.dispatched).toHaveLength(1)
		expect(h.dispatched[0]?.kind).toBe('silence')
		expect(h.dispatched[0]?.title).toBe('herdweb · dev 可能完工/卡住')
		expect(h.dispatched[0]?.body).toBe('已 180 秒无输出')
		expect(h.dispatched[0]?.session).toBe('dev')
		h.dispose()
	})

	test('after trigger — no re-trigger within cooldown without new busy', () => {
		let busy = true
		const lastOut = 0
		const h = makeHarness({
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => lastOut,
		})
		h.advance(30_000)
		busy = false
		h.advance(180_000)
		expect(h.dispatched).toHaveLength(1)
		h.advance(600_000)
		expect(h.dispatched).toHaveLength(1)
		h.dispose()
	})

	test('cooldown reset on new busy — can trigger again', () => {
		let busy = true
		let lastOut = 0
		const h = makeHarness({
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => lastOut,
		})
		h.advance(30_000)
		busy = false
		h.advance(180_000)
		expect(h.dispatched).toHaveLength(1)
		const firstTs = h.dispatched[0]?.ts ?? 0

		busy = true
		lastOut = firstTs + 30_000
		h.advance(30_000)
		busy = false
		lastOut = firstTs + 30_000
		h.advance(180_000)
		expect(h.dispatched).toHaveLength(2)
		h.dispose()
	})

	test('yields when other lane event within cooldown window', () => {
		let busy = true
		const lastOut = 0
		const h = makeHarness({
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => lastOut,
			lastEventAt: () => 0,
		})
		h.advance(30_000)
		busy = false
		h.advance(180_000)
		expect(h.dispatched).toHaveLength(0)
		h.dispose()
	})

	test('enabled=false — never arms', () => {
		const h = makeHarness({ enabled: false, bytesInWindow: () => 9999 })
		h.advance(600_000)
		expect(h.dispatched).toHaveLength(0)
		h.dispose()
	})

	test('silence id uses minute bucket', () => {
		let busy = true
		const h = makeHarness({
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => (busy ? 0 : 0),
		})
		h.advance(30_000)
		busy = false
		h.advance(180_000)
		expect(h.dispatched[0]?.id).toBe('silence:dev:3')
		h.dispose()
	})
})
