import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	DONE_COALESCE_MS,
	type OutboundDecision,
	coalesceSessionKey,
	decideOutbound,
} from '../src/notify/attention-policy'
import type { NotifyEvent, NotifyKind, NotifyTaskRole } from '../src/notify/events'
import { parseNotifyEvent } from '../src/notify/events'
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
		session?: string
		id?: string
	} = {},
): NotifyEvent {
	return { ...BASE, kind, ...extra }
}

describe('DONE_COALESCE_MS', () => {
	test('is a 600s tumbling window', () => {
		expect(DONE_COALESCE_MS).toBe(600_000)
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
		['done', 'root', { action: 'send-now' }],
		['done', 'child', { action: 'withhold', reason: 'child-done' }],
		['done', undefined, { action: 'coalesce', reason: 'done-coalesced' }],
	] as const satisfies ReadonlyArray<
		readonly [NotifyKind, NotifyTaskRole | undefined, OutboundDecision]
	>)('kind=%s role=%s', (kind, role, expected) => {
		const extra = role === undefined ? {} : { role }
		expect(decideOutbound(event(kind, extra))).toEqual(expected)
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
	return parseNotifyEvent(JSON.stringify({ v: 1, title: 'T', ts: 1, ...input }))
}

function createOutboundHarness() {
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
