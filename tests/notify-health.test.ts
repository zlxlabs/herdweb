import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
	buildRestartEvent,
	buildSessionEndEvent,
	extractSessionKey,
	formatExitReason,
	shouldAnnounceRestart,
} from '../src/notify/health'
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
