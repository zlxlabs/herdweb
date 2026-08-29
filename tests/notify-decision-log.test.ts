import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	NOTIFY_DECISION_LOG_PREFIX,
	NOTIFY_DECISION_REASONS,
	type NotifyDecisionLog,
	type NotifyDecisionOutcome,
	type NotifyDecisionReason,
	logNotifyDecision,
} from '../src/notify/decision-log'

function loggedLines(): string[] {
	return logSpy.mock.calls.map((args) => String(args[0]))
}

let logSpy: ReturnType<typeof vi.spyOn>

describe('logNotifyDecision', () => {
	afterEach(() => {
		logSpy.mockRestore()
	})

	test('prefixes every line with the journal grep token', () => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const entry: NotifyDecisionLog = {
			outcome: 'accepted',
			kind: 'silence',
			id: 'silence:dev:3',
			reason: 'armed-quiet',
			bytes: 0,
		}
		logNotifyDecision(entry)
		expect(loggedLines()).toEqual([
			'herdweb: notify decision accepted kind=silence id=silence:dev:3 reason=armed-quiet bytes=0',
		])
		expect(loggedLines()[0]?.startsWith(NOTIFY_DECISION_LOG_PREFIX)).toBe(true)
	})

	test('formats skip, duplicate, and reject lines in stable field order', () => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const outcomes: readonly NotifyDecisionOutcome[] = ['skipped', 'duplicate', 'rejected']
		expect(outcomes).toEqual(['skipped', 'duplicate', 'rejected'])
		logNotifyDecision({
			outcome: 'skipped',
			kind: 'silence',
			reason: 'lane-cooldown',
			remainingMs: 420_000,
		})
		logNotifyDecision({
			outcome: 'duplicate',
			kind: 'done',
			id: 'dup',
			reason: 'duplicate',
		})
		logNotifyDecision({
			outcome: 'rejected',
			reason: 'unauthorized',
			status: 401,
		})
		expect(loggedLines()).toEqual([
			'herdweb: notify decision skipped kind=silence reason=lane-cooldown remainingMs=420000',
			'herdweb: notify decision duplicate kind=done id=dup reason=duplicate',
			'herdweb: notify decision rejected reason=unauthorized status=401',
		])
	})

	test('reason vocabulary is the closed set', () => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		expect(NOTIFY_DECISION_REASONS).toEqual([
			'armed-quiet',
			'session-end',
			'service-restart',
			'cooldown',
			'lane-cooldown',
			'restart-gap',
			'duplicate',
			'not-loopback',
			'unauthorized',
			'rate-limited',
			'invalid-event',
			'payload-too-large',
			'not-attention',
			'child-done',
			'done-coalesced',
			'user-present',
		])
		for (const reason of NOTIFY_DECISION_REASONS) {
			logNotifyDecision({ outcome: 'skipped', reason })
		}
		const reasons = loggedLines().map((line) => {
			const match = /reason=([a-z-]+)/.exec(line)
			return match?.[1]
		})
		expect(reasons).toEqual([...NOTIFY_DECISION_REASONS])
		expect(loggedLines().every((line) => line.startsWith(NOTIFY_DECISION_LOG_PREFIX))).toBe(true)
	})

	test('type union has no extra reasons beyond the closed list', () => {
		const check = (reason: NotifyDecisionReason): NotifyDecisionReason => {
			switch (reason) {
				case 'armed-quiet':
				case 'session-end':
				case 'service-restart':
				case 'cooldown':
				case 'lane-cooldown':
				case 'restart-gap':
				case 'duplicate':
				case 'not-loopback':
				case 'unauthorized':
				case 'rate-limited':
				case 'invalid-event':
				case 'payload-too-large':
				case 'not-attention':
				case 'child-done':
				case 'done-coalesced':
				case 'user-present':
					return reason
			}
		}
		expect(NOTIFY_DECISION_REASONS.map(check)).toEqual([...NOTIFY_DECISION_REASONS])
	})
})
