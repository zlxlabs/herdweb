import { describe, expect, test } from 'vitest'
import {
	DONE_COALESCE_MS,
	type OutboundDecision,
	coalesceSessionKey,
	decideOutbound,
} from '../src/notify/attention-policy'
import type { NotifyEvent, NotifyKind, NotifyTaskRole } from '../src/notify/events'

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
