import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	DONE_COALESCE_MS,
	type NotifyTaskRole,
	type OutboundDecision,
	PRESENCE_DEFER_MS,
	coalesceSessionKey,
	decideOutbound,
} from '../src/notify/attention-policy'
import type { NotifyEvent, NotifyKind, NotifyLevel, NotifyPresence } from '../src/notify/events'
import { PRESENCE_FRESH_MS, parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'

const BASE = {
	v: 1 as const,
	id: 'evt-1',
	title: 'T',
	ts: 1,
}

function event(
	kind: NotifyKind,
	extra: {
		role?: NotifyTaskRole
		level?: NotifyLevel
		session?: string
		id?: string
		presence?: NotifyPresence
		presenceAt?: number
	} = {},
): NotifyEvent {
	return { ...BASE, kind, ...extra }
}

const OUTBOUND_MATRIX = [
	['act_now', 'asking', undefined, { action: 'send-now' }],
	['act_now', 'done', 'root', { action: 'send-now' }],
	['act_now', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['act_now', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['act_now', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
	['act_soon', 'asking', undefined, { action: 'send-now' }],
	['act_soon', 'done', 'root', { action: 'send-now' }],
	['act_soon', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['act_soon', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['act_soon', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
	['collect', 'asking', undefined, { action: 'send-now' }],
	['collect', 'done', 'root', { action: 'send-now' }],
	['collect', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['collect', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['collect', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
	['fyi', 'asking', undefined, { action: 'withhold', reason: 'fyi' }],
	['fyi', 'done', 'root', { action: 'withhold', reason: 'fyi' }],
	['fyi', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['fyi', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['fyi', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
	['missing', 'asking', undefined, { action: 'send-now' }],
	['missing', 'done', 'root', { action: 'send-now' }],
	['missing', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['missing', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['missing', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
	['unknown', 'asking', undefined, { action: 'send-now' }],
	['unknown', 'done', 'root', { action: 'send-now' }],
	['unknown', 'done', 'child', { action: 'withhold', reason: 'child-done' }],
	['unknown', 'patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
	['unknown', 'silence', undefined, { action: 'withhold', reason: 'not-attention' }],
] as const satisfies ReadonlyArray<
	readonly [
		'act_now' | 'act_soon' | 'collect' | 'fyi' | 'missing' | 'unknown',
		NotifyKind,
		NotifyTaskRole | undefined,
		OutboundDecision,
	]
>

describe('level × kind outbound matrix', () => {
	test.each(OUTBOUND_MATRIX)('%s × %s (%s)', (level, kind, role, expected) => {
		const base = event(kind, role === undefined ? {} : { role })
		const candidate =
			level === 'missing' ? base : { ...base, level: level === 'unknown' ? 'unexpected' : level }
		expect(decideOutbound(candidate as unknown as NotifyEvent, OPTS)).toEqual(expected)
	})
})

describe('missing or malformed level remains fail-open', () => {
	test('missing level remains send-now', () => {
		expect(decideOutbound(event('asking'), OPTS)).toEqual({ action: 'send-now' })
	})

	test('explicit undefined level remains send-now', () => {
		expect(decideOutbound({ ...event('asking'), level: undefined }, OPTS)).toEqual({
			action: 'send-now',
		})
	})

	test('unknown level remains send-now', () => {
		expect(
			decideOutbound({ ...event('asking'), level: 'unexpected' } as unknown as NotifyEvent, OPTS),
		).toEqual({ action: 'send-now' })
	})
})

describe('DONE_COALESCE_MS', () => {
	test('is a 600s sliding quiet period', () => {
		expect(DONE_COALESCE_MS).toBe(600_000)
	})
})

describe('PRESENCE_DEFER_MS', () => {
	test('is a 300s defer window', () => {
		expect(PRESENCE_DEFER_MS).toBe(300_000)
	})
})

describe('PRESENCE_FRESH_MS', () => {
	test('is a 120s freshness threshold', () => {
		expect(PRESENCE_FRESH_MS).toBe(120_000)
	})
})

describe('coalesceSessionKey', () => {
	test('uses session when present', () => {
		expect(coalesceSessionKey(event('done', { session: 'dev' }))).toBe('dev')
	})

	test('falls back to default when session is omitted', () => {
		expect(coalesceSessionKey(event('done'))).toBe('default')
	})
})

const NOW = 1_700_000_000_000
const OPTS = { awayMode: false, now: NOW } as const

describe('decideOutbound', () => {
	test.each([
		['asking', undefined, { action: 'send-now' }],
		['asking', 'child', { action: 'send-now' }],
		['asking', 'root', { action: 'send-now' }],
		['health', undefined, { action: 'send-now' }],
		['health', 'child', { action: 'send-now' }],
		['test', undefined, { action: 'send-now' }],
		['test', 'child', { action: 'send-now' }],
		['ci-red', undefined, { action: 'send-now' }],
		['ci-red', 'child', { action: 'send-now' }],
		['silence', undefined, { action: 'withhold', reason: 'not-attention' }],
		['silence', 'root', { action: 'withhold', reason: 'not-attention' }],
		['patrol', undefined, { action: 'withhold', reason: 'not-attention' }],
		['patrol', 'root', { action: 'withhold', reason: 'not-attention' }],
		['done', 'root', { action: 'send-now' }],
		['done', 'child', { action: 'withhold', reason: 'child-done' }],
		['done', undefined, { action: 'coalesce', reason: 'done-coalesced' }],
	] as const satisfies ReadonlyArray<
		readonly [NotifyKind, NotifyTaskRole | undefined, OutboundDecision]
	>)('kind=%s role=%s, no presence signal', (kind, role, expected) => {
		const extra = role === undefined ? {} : { role }
		expect(decideOutbound(event(kind, extra), OPTS)).toEqual(expected)
	})

	test.each([
		['asking', undefined],
		['health', undefined],
		['ci-red', undefined],
		['test', undefined],
		['done', 'root'],
		['done', undefined],
	] as const)('likely-present defers kind=%s role=%s', (kind, role) => {
		const extra = role === undefined ? {} : { role }
		expect(decideOutbound(event(kind, { ...extra, presence: 'likely-present' }), OPTS)).toEqual({
			action: 'defer',
			reason: 'user-present',
		})
	})

	test('likely-present does not change the silence withhold', () => {
		expect(decideOutbound(event('silence', { presence: 'likely-present' }), OPTS)).toEqual({
			action: 'withhold',
			reason: 'not-attention',
		})
	})

	test('likely-present does not change the patrol withhold', () => {
		expect(decideOutbound(event('patrol', { presence: 'likely-present' }), OPTS)).toEqual({
			action: 'withhold',
			reason: 'not-attention',
		})
	})

	test('patrol withholds as not-attention even in away mode', () => {
		expect(decideOutbound(event('patrol'), { awayMode: true, now: NOW })).toEqual({
			action: 'withhold',
			reason: 'not-attention',
		})
	})

	test('likely-present does not defer a child done', () => {
		expect(
			decideOutbound(event('done', { role: 'child', presence: 'likely-present' }), OPTS),
		).toEqual({ action: 'withhold', reason: 'child-done' })
	})

	test.each([
		['unknown', { action: 'send-now' }],
		['likely-away', { action: 'send-now' }],
	] as const satisfies ReadonlyArray<readonly [NotifyPresence, OutboundDecision]>)(
		'presence=%s asks follow the existing role rules',
		(presence, expected) => {
			expect(decideOutbound(event('asking', { presence }), OPTS)).toEqual(expected)
		},
	)

	test.each([
		['unknown', { action: 'coalesce', reason: 'done-coalesced' }],
		['likely-away', { action: 'coalesce', reason: 'done-coalesced' }],
	] as const satisfies ReadonlyArray<readonly [NotifyPresence, OutboundDecision]>)(
		'presence=%s unlabeled dones still coalesce',
		(presence, expected) => {
			expect(decideOutbound(event('done', { presence }), OPTS)).toEqual(expected)
		},
	)

	test('away mode skips the presence lane entirely', () => {
		const opts = { awayMode: true, now: NOW }
		expect(decideOutbound(event('asking', { presence: 'likely-present' }), opts)).toEqual({
			action: 'send-now',
		})
		expect(decideOutbound(event('done', { presence: 'likely-present' }), opts)).toEqual({
			action: 'coalesce',
			reason: 'done-coalesced',
		})
	})

	test('ignorePresence skips the defer lane for the release re-check', () => {
		const opts = { awayMode: false, now: NOW, ignorePresence: true }
		expect(decideOutbound(event('asking', { presence: 'likely-present' }), opts)).toEqual({
			action: 'send-now',
		})
		expect(decideOutbound(event('done', { presence: 'likely-present' }), opts)).toEqual({
			action: 'coalesce',
			reason: 'done-coalesced',
		})
	})
})

describe('presenceAt freshness', () => {
	const present = { presence: 'likely-present' } as const

	test('missing presenceAt trusts the current value', () => {
		expect(decideOutbound(event('asking', present), OPTS)).toEqual({
			action: 'defer',
			reason: 'user-present',
		})
	})

	test('presenceAt within the freshness window defers', () => {
		expect(
			decideOutbound(event('asking', { ...present, presenceAt: NOW - PRESENCE_FRESH_MS }), OPTS),
		).toEqual({ action: 'defer', reason: 'user-present' })
	})

	test('stale presenceAt downgrades presence to unknown', () => {
		expect(
			decideOutbound(
				event('asking', { ...present, presenceAt: NOW - PRESENCE_FRESH_MS - 1 }),
				OPTS,
			),
		).toEqual({ action: 'send-now' })
	})

	test('future presenceAt is treated as fresh', () => {
		expect(decideOutbound(event('asking', { ...present, presenceAt: NOW + 60_000 }), OPTS)).toEqual(
			{ action: 'defer', reason: 'user-present' },
		)
	})
})

interface CapturedRequest {
	readonly request: Request
	readonly body: string
}

function captureFetch(): CapturedRequest[] {
	const requests: CapturedRequest[] = []
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init)
			requests.push({ request, body: await request.text() })
			return new Response(null, { status: 204 })
		}),
	)
	return requests
}

function readJsonl(stateDir: string): unknown[] {
	const path = join(stateDir, 'events.jsonl')
	if (!existsSync(path)) return []
	return readFileSync(path, 'utf-8')
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as unknown)
}

function decisionLines(spy: ReturnType<typeof vi.spyOn>): string[] {
	return spy.mock.calls
		.map((args) => String(args[0]))
		.filter((line) => line.startsWith('herdweb: notify decision'))
}

function parsedEvent(input: Record<string, unknown>): NotifyEvent {
	return parseNotifyEvent(JSON.stringify({ v: 1, title: 'T', ts: 1_700_000_000_000, ...input }))
}

// Captured from ~/.local/state/herdweb/7681/events.jsonl and redacted for the fixture.
const REAL_PRODUCER_FYI_EVENT = parseNotifyEvent(
	JSON.stringify({
		v: 1,
		id: 'redacted-event-id',
		kind: 'asking',
		level: 'fyi',
		session: 'redacted-session-id',
		title: '⚪ 不用管 · agent-config #56 压缩阈值调整',
		body: '全量测试运行中待后续\nCI全量测试中，等结果自动推进；另两件拍板事项均不阻塞当前工作\n⏱️ 闲置 11 分钟 · 📋 卡 0/0 终局 · 🌿 main',
		contentMarkdown:
			'# ⚪ 不用管 · agent-config #56 压缩阈值调整\n**全量测试运行中待后续**——CI全量测试中，等结果自动推进；另两件拍板事项均不阻塞当前工作\n\n> 闲置 11 分钟\n\n<redacted-url>',
		ts: 1_788_572_562_258,
	}),
)

function createOutboundHarness(opts: { isAwayMode?: () => boolean } = {}) {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-attention-'))
	writeSubscriptions(stateDir, [
		{
			endpoint: 'https://push.example/device',
			keys: { p256dh: 'k', auth: 'a' },
			lastSuccessAt: 1,
		},
	])
	const sendPush = vi.fn().mockResolvedValue(undefined)
	const requests = captureFetch()
	const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
	const service = createNotifyService({
		stateDir,
		historyLimit: 200,
		sendPush,
		channels: [{ type: 'webhook', url: 'https://hook.example.com/events' }],
		...(opts.isAwayMode !== undefined ? { isAwayMode: opts.isAwayMode } : {}),
	})
	return { stateDir, sendPush, requests, logSpy, service }
}

describe('notify service outbound gate', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	test('asking writes history and POSTs immediately', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'ask-1', kind: 'asking' }))
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		expect(h.requests[0]?.request.method).toBe('POST')
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision accepted kind=asking id=ask-1',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('health still goes outbound', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'health-1', kind: 'health' }))
		await h.service.awaitInFlight(1000)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('test kind stays off disk and still pushes', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ kind: 'test' }))
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(0)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('ci-red is blocking and goes outbound immediately', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'ci-1', kind: 'ci-red' }))
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('real producer fyi fixture stays in history but never POSTs', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(REAL_PRODUCER_FYI_EVENT)
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toEqual([REAL_PRODUCER_FYI_EVENT])
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=asking id=redacted-event-id reason=fyi',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('silence writes history but does not POST', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'sil-1', kind: 'silence' }))
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=silence id=sil-1 reason=not-attention',
		)
		expect(
			decisionLines(h.logSpy).some((line) => line.includes('accepted') && line.includes('sil-1')),
		).toBe(false)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('patrol writes history but does not POST', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'patrol-1', kind: 'patrol' }))
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=patrol id=patrol-1 reason=not-attention',
		)
		expect(
			decisionLines(h.logSpy).some(
				(line) => line.includes('accepted') && line.includes('patrol-1'),
			),
		).toBe(false)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('done role=root POSTs immediately without waiting the window', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'root-1', kind: 'done', role: 'root' }))
		await h.service.awaitInFlight(1000)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision accepted kind=done id=root-1',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('done role=child writes history and never POSTs', async () => {
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'child-1', kind: 'done', role: 'child', parentId: 'root-1' }),
		)
		await h.service.awaitInFlight(1000)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=done id=child-1 reason=child-done',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('unlabeled dones coalesce: first stays on disk, last POSTs after 600s', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'done-1', kind: 'done', session: 'dev' }))
		h.service.dispatchEvent(parsedEvent({ id: 'done-2', kind: 'done', session: 'dev' }))
		await Promise.resolve()
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy).filter((line) => line.includes('done-coalesced'))).toEqual([
			'herdweb: notify decision skipped kind=done id=done-1 reason=done-coalesced',
			'herdweb: notify decision skipped kind=done id=done-2 reason=done-coalesced',
		])
		vi.advanceTimersByTime(DONE_COALESCE_MS - 1)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'done-2' })
		expect(h.requests).toHaveLength(1)
		expect(JSON.parse(h.requests[0]?.body ?? '{}')).toMatchObject({ id: 'done-2' })
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision accepted kind=done id=done-2',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('unlabeled done sliding quiet period resets on each new event', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'done-1', kind: 'done', session: 'dev' }))
		vi.advanceTimersByTime(400_000)
		h.service.dispatchEvent(parsedEvent({ id: 'done-2', kind: 'done', session: 'dev' }))
		vi.advanceTimersByTime(200_000)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		vi.advanceTimersByTime(400_000)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'done-2' })
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('unlabeled dones on different sessions do not swallow each other', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'a-1', kind: 'done', session: 'alpha' }))
		h.service.dispatchEvent(parsedEvent({ id: 'b-1', kind: 'done', session: 'beta' }))
		vi.advanceTimersByTime(DONE_COALESCE_MS)
		expect(h.sendPush).toHaveBeenCalledTimes(2)
		await h.service.awaitInFlight(1000)
		expect(h.requests).toHaveLength(2)
		const ids = h.sendPush.mock.calls.map(([, payload]) => JSON.parse(String(payload)).id).sort()
		expect(ids).toEqual(['a-1', 'b-1'])
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})
})

describe('presence defer lane (service)', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	test('likely-present asking writes history, defers 300s, then sends', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(parsedEvent({ id: 'p-1', kind: 'asking', presence: 'likely-present' }))
		await Promise.resolve()
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=asking id=p-1 reason=user-present',
		)
		vi.advanceTimersByTime(PRESENCE_DEFER_MS - 1)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(h.requests).toHaveLength(1)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision accepted kind=asking id=p-1',
		)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a fresh likely-present event on the same session resets the 300s timer', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		vi.advanceTimersByTime(200_000)
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-2', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		vi.advanceTimersByTime(200_000)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		vi.advanceTimersByTime(100_000)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'p-2' })
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a likely-away event flushes the pending defer before its own outbound', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		expect(h.sendPush).not.toHaveBeenCalled()
		h.service.dispatchEvent(
			parsedEvent({
				id: 'p-2',
				kind: 'done',
				role: 'root',
				session: 'dev',
				presence: 'likely-away',
			}),
		)
		expect(h.sendPush).toHaveBeenCalledTimes(2)
		await h.service.awaitInFlight(1000)
		const ids = h.sendPush.mock.calls.map(([, payload]) => JSON.parse(String(payload)).id)
		expect(ids).toEqual(['p-1', 'p-2'])
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a stale presenceAt flushes the pending defer and sends immediately', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		expect(h.sendPush).not.toHaveBeenCalled()
		h.service.dispatchEvent(
			parsedEvent({
				id: 'p-2',
				kind: 'asking',
				session: 'dev',
				presence: 'likely-present',
				presenceAt: Date.now() - PRESENCE_FRESH_MS - 1,
			}),
		)
		expect(h.sendPush).toHaveBeenCalledTimes(2)
		await h.service.awaitInFlight(1000)
		const ids = h.sendPush.mock.calls.map(([, payload]) => JSON.parse(String(payload)).id)
		expect(ids).toEqual(['p-1', 'p-2'])
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('an unlabeled likely-present done defers, then enters the 600s coalesce window', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'd-1', kind: 'done', session: 'dev', presence: 'likely-present' }),
		)
		await Promise.resolve()
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=done id=d-1 reason=user-present',
		)
		vi.advanceTimersByTime(PRESENCE_DEFER_MS)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=done id=d-1 reason=done-coalesced',
		)
		vi.advanceTimersByTime(DONE_COALESCE_MS - 1)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'd-1' })
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a likely-present silence withholds without flushing the pending defer', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		h.service.dispatchEvent(
			parsedEvent({ id: 's-1', kind: 'silence', session: 'dev', presence: 'likely-present' }),
		)
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=silence id=s-1 reason=not-attention',
		)
		vi.advanceTimersByTime(PRESENCE_DEFER_MS)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'p-1' })
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a silence event without presence does not flush the pending defer', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		// Internal producers (silence detector) never attach presence.
		h.service.dispatchEvent(parsedEvent({ id: 's-1', kind: 'silence', session: 'dev' }))
		await Promise.resolve()
		expect(h.sendPush).not.toHaveBeenCalled()
		expect(h.requests).toHaveLength(0)
		expect(decisionLines(h.logSpy)).toContain(
			'herdweb: notify decision skipped kind=silence id=s-1 reason=not-attention',
		)
		vi.advanceTimersByTime(PRESENCE_DEFER_MS)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'p-1' })
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('a plain event without presence does not flush the pending defer', async () => {
		vi.useFakeTimers()
		const h = createOutboundHarness()
		h.service.dispatchEvent(
			parsedEvent({ id: 'p-1', kind: 'asking', session: 'dev', presence: 'likely-present' }),
		)
		h.service.dispatchEvent(parsedEvent({ id: 'p-2', kind: 'asking', session: 'dev' }))
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'p-2' })
		vi.advanceTimersByTime(PRESENCE_DEFER_MS)
		expect(h.sendPush).toHaveBeenCalledTimes(2)
		await h.service.awaitInFlight(1000)
		expect(JSON.parse(String(h.sendPush.mock.calls[1]?.[1]))).toMatchObject({ id: 'p-1' })
		expect(readJsonl(h.stateDir)).toHaveLength(2)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})

	test('away mode sends likely-present events immediately', async () => {
		const h = createOutboundHarness({ isAwayMode: () => true })
		h.service.dispatchEvent(parsedEvent({ id: 'p-9', kind: 'asking', presence: 'likely-present' }))
		await h.service.awaitInFlight(1000)
		expect(h.sendPush).toHaveBeenCalledTimes(1)
		expect(h.requests).toHaveLength(1)
		expect(readJsonl(h.stateDir)).toHaveLength(1)
		h.service.dispose()
		rmSync(h.stateDir, { recursive: true, force: true })
	})
})
