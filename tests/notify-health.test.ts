import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	buildRestartEvent,
	buildSessionEndEvent,
	considerRestartAnnouncement,
	extractSessionKey,
	formatExitReason,
	shouldAnnounceRestart,
} from '../src/notify/health'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'
import { createSilenceDetector } from '../src/notify/silence'
import {
	readLastSessionStore,
	updateLastSessionEntry,
	writeLastSessionStore,
} from '../src/notify/state'

describe('extractSessionKey', () => {
	test.each([
		[['herdr', '--session', 'dev'], 'dev'],
		[['herdr', '--session=herdweb-dev'], 'herdweb-dev'],
		[['herdr', '--session'], 'default'],
		[['herdr'], 'default'],
		[['bash', '--norc'], 'default'],
		[['node', 'cli.ts', 'serve', '--', 'herdr', '--session', 'x'], 'x'],
		[['node', 'cli.ts', 'serve', '--', 'bash', '--norc'], 'default'],
		[undefined, 'default'],
	])('command %j → %s', (command, expected) => {
		expect(extractSessionKey(command)).toBe(expected)
	})
})

describe('shouldAnnounceRestart', () => {
	const prev = {
		sessionId: 'old-id',
		exitedAt: 1_000,
		exitCode: 0,
		signal: null,
	}

	test('returns false when no previous entry', () => {
		expect(shouldAnnounceRestart(undefined, 'new-id', 200_000)).toBe(false)
	})

	test('returns false when sessionId unchanged', () => {
		expect(shouldAnnounceRestart(prev, 'old-id', 200_000)).toBe(false)
	})

	test('returns false within 120s crash-loop window', () => {
		expect(shouldAnnounceRestart(prev, 'new-id', 100_000)).toBe(false)
	})

	test('returns true when sessionId changed and gap >120s', () => {
		expect(shouldAnnounceRestart(prev, 'new-id', 130_000)).toBe(true)
	})
})

describe('considerRestartAnnouncement', () => {
	const prev = {
		sessionId: 'old-id',
		exitedAt: 1_000,
		exitCode: 0,
		signal: null,
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('does not log when no previous entry', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const announce = vi.fn()
		considerRestartAnnouncement({
			prev: undefined,
			currentSessionId: 'new-id',
			now: 200_000,
			announce,
		})
		expect(announce).not.toHaveBeenCalled()
		expect(logSpy.mock.calls.map((args) => String(args[0]))).toEqual([])
	})

	test('does not log when sessionId is unchanged', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const announce = vi.fn()
		considerRestartAnnouncement({
			prev,
			currentSessionId: 'old-id',
			now: 200_000,
			announce,
		})
		expect(announce).not.toHaveBeenCalled()
		expect(logSpy.mock.calls.map((args) => String(args[0]))).toEqual([])
	})

	test('logs restart-gap skip when sessionId changed within 120s', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const announce = vi.fn()
		considerRestartAnnouncement({
			prev,
			currentSessionId: 'new-id',
			now: 100_000,
			announce,
		})
		expect(announce).not.toHaveBeenCalled()
		expect(logSpy.mock.calls.map((args) => String(args[0]))).toEqual([
			'herdweb: notify decision skipped kind=health reason=restart-gap remainingMs=21000',
		])
	})

	test('announces without skip log when sessionId changed and gap >120s', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const announce = vi.fn()
		considerRestartAnnouncement({
			prev,
			currentSessionId: 'new-id',
			now: 130_000,
			announce,
		})
		expect(announce).toHaveBeenCalledTimes(1)
		expect(logSpy.mock.calls.map((args) => String(args[0]))).toEqual([])
	})
})

describe('health event builders', () => {
	test('buildSessionEndEvent includes exit reason', () => {
		const event = buildSessionEndEvent({
			sessionKey: 'dev',
			startTime: 100,
			exitCode: 0,
			signal: null,
			ts: 200,
		})
		expect(event.kind).toBe('health')
		expect(event.id).toBe('health:dev:100')
		expect(event.title).toBe('herdweb · dev 会话结束')
		expect(event.reason).toBe('exit 0')
	})

	test('buildSessionEndEvent formats signal', () => {
		const event = buildSessionEndEvent({
			sessionKey: 'dev',
			startTime: 100,
			exitCode: 1,
			signal: 15,
			ts: 200,
		})
		expect(event.reason).toBe('signal 15')
		expect(formatExitReason(1, 15)).toBe('signal 15')
	})

	test('buildRestartEvent', () => {
		const event = buildRestartEvent({ sessionKey: 'dev', startTime: 500, ts: 600 })
		expect(event.title).toBe('herdweb · dev 服务已重启')
		expect(event.id).toBe('health:dev:500')
	})

	test('dispatching session-end and restart logs accepted decisions', () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-decision-'))
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const service = createNotifyService({ stateDir, historyLimit: 200 })
		service.dispatchEvent(
			buildSessionEndEvent({
				sessionKey: 'dev',
				startTime: 100,
				exitCode: 0,
				signal: null,
				ts: 200,
			}),
		)
		service.dispatchEvent(buildRestartEvent({ sessionKey: 'dev', startTime: 500, ts: 600 }))
		const decision = logSpy.mock.calls
			.map((args) => String(args[0]))
			.filter((line) => line.startsWith('herdweb: notify decision'))
		expect(decision).toEqual([
			'herdweb: notify decision accepted kind=health id=health:dev:100 reason=session-end',
			'herdweb: notify decision accepted kind=health id=health:dev:500 reason=service-restart',
		])
		service.dispose()
		rmSync(stateDir, { recursive: true, force: true })
		logSpy.mockRestore()
	})

	test('explicit restart and exit same-id producers preserve targetId in push bytes', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-push-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 1,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const service = createNotifyService({
			stateDir,
			historyLimit: 200,
			targetMode: 'explicit',
			targetIds: ['a', 'b'],
			sendPush,
		})
		for (const event of [
			buildRestartEvent({
				sessionKey: 'dev',
				startTime: 1,
				ts: 2,
				targetMode: 'explicit',
				targetId: 'a',
			}),
			buildSessionEndEvent({
				sessionKey: 'dev',
				startTime: 1,
				exitCode: 0,
				signal: null,
				ts: 3,
				targetMode: 'explicit',
				targetId: 'b',
			}),
		])
			service.dispatchEvent(event)
		expect(
			sendPush.mock.calls.map(([, payload]) => JSON.parse(payload as string).targetId),
		).toEqual(['a', 'b'])
		expect([service.lastEventAt('a', 'dev'), service.lastEventAt('b', 'dev')]).toEqual([2, 3])
		vi.useFakeTimers()
		let nowMs = 0
		let busy = true
		const detector = createSilenceDetector({
			sessionKey: 'silence-dev',
			targetMode: 'explicit',
			targetId: 'b',
			config: { enabled: true, busyMs: 30_000, quietMs: 180_000, cooldownMs: 600_000 },
			bytesInWindow: () => (busy ? 1500 : 0),
			lastOutputAt: () => 0,
			dispatch: (event) => service.dispatchEvent(event),
			lastEventAt: (targetId, sessionKey) => service.lastEventAt(targetId, sessionKey),
			now: () => nowMs,
			setIntervalMs: 30_000,
		})
		nowMs = 30_000
		vi.advanceTimersByTime(30_000)
		busy = false
		nowMs = 210_000
		vi.advanceTimersByTime(180_000)
		await service.awaitInFlight(1000)
		expect(
			sendPush.mock.calls.map(([, payload]) => JSON.parse(payload as string).targetId),
		).toEqual(['a', 'b'])
		expect(readFileSync(join(stateDir, 'events.jsonl'), 'utf-8')).toContain('"kind":"silence"')
		detector.dispose()
		service.dispose()
		rmSync(stateDir, { recursive: true, force: true })
		vi.useRealTimers()
		vi.restoreAllMocks()
	})
})

describe('last-session store', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
		stateDir = undefined
	})

	test('read returns empty object when file missing', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-'))
		expect(readLastSessionStore(stateDir)).toEqual({})
	})

	test('updateLastSessionEntry persists keyed entry', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-'))
		updateLastSessionEntry(stateDir, 'dev', {
			sessionId: 'sid-1',
			exitedAt: 1000,
			exitCode: 0,
			signal: null,
		})
		const store = readLastSessionStore(stateDir)
		expect(store.dev?.sessionId).toBe('sid-1')
		const raw = readFileSync(join(stateDir, 'last-session.json'), 'utf-8')
		expect(raw).toContain('"dev"')
	})

	test('writeLastSessionStore round-trips multiple keys', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-'))
		writeLastSessionStore(stateDir, {
			default: { sessionId: 'a', exitedAt: 1, exitCode: 0, signal: null },
			dev: { sessionId: 'b', exitedAt: 2, exitCode: 1, signal: null },
		})
		expect(readLastSessionStore(stateDir).dev?.exitCode).toBe(1)
	})
})
