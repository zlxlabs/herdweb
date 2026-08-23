import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { NotifyEventError, parseNotifyEvent } from '../src/notify/events'
import { appendEventLine, resolveNotifyStateDir, writeJsonFileAtomic } from '../src/notify/state'

const validBase = {
	v: 1,
	id: 'evt-1',
	kind: 'asking',
	title: 'Need input',
	ts: 1_700_000_000,
} as const

describe('parseNotifyEvent', () => {
	test.each([
		['asking', 'asking'],
		['done', 'done'],
		['ci-red', 'ci-red'],
		['silence', 'silence'],
		['health', 'health'],
		['test', 'test'],
	])('accepts kind=%s', (kind, expected) => {
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, kind }))
		expect(event.kind).toBe(expected)
	})

	test.each([
		['failed kind', { ...validBase, kind: 'failed' }],
		['unknown kind', { ...validBase, kind: 'unknown' }],
		['tool field', { ...validBase, tool: 'grep' }],
		['unknown field', { ...validBase, extra: true }],
		['wrong version', { ...validBase, v: 2 }],
		['missing id for non-test', { v: 1, kind: 'asking', title: 'T', ts: 1 }],
	])('rejects %s with 400', (_label, payload) => {
		expect(() => parseNotifyEvent(JSON.stringify(payload))).toThrow(NotifyEventError)
		try {
			parseNotifyEvent(JSON.stringify(payload))
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
		}
	})

	test('truncates title/body/reason', () => {
		const event = parseNotifyEvent(
			JSON.stringify({
				...validBase,
				title: 't'.repeat(200),
				body: 'b'.repeat(300),
				reason: 'r'.repeat(200),
			}),
		)
		expect(event.title).toHaveLength(120)
		expect(event.body).toHaveLength(200)
		expect(event.reason).toHaveLength(120)
	})

	test('rejects raw payload over 4 KiB with 413', () => {
		const huge = JSON.stringify({ ...validBase, body: 'x'.repeat(5000) })
		expect(() => parseNotifyEvent(huge)).toThrow(NotifyEventError)
		try {
			parseNotifyEvent(huge)
		} catch (error) {
			expect((error as NotifyEventError).statusCode).toBe(413)
		}
	})

	test('allows test without id', () => {
		const event = parseNotifyEvent(JSON.stringify({ v: 1, kind: 'test', title: 'T', ts: 1 }))
		expect(event.id).toBe('')
	})
})

describe('notify state', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
		stateDir = undefined
	})

	test('resolveNotifyStateDir uses port segment', () => {
		expect(resolveNotifyStateDir(7781)).toContain(`${join('herdweb', '7781')}`)
	})

	test('appendEventLine skips test kind and trims when over 2x limit', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-state-'))
		for (let i = 0; i < 25; i++) {
			appendEventLine(stateDir, { ...validBase, id: `e${i}`, kind: 'done', title: `t${i}` }, 10)
		}
		await new Promise<void>((resolve) => setImmediate(resolve))
		const lines = readFileSync(join(stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(lines).toHaveLength(10)
		appendEventLine(stateDir, { ...validBase, kind: 'test', title: 'skip' }, 10)
		await new Promise<void>((resolve) => setImmediate(resolve))
		const afterTest = readFileSync(join(stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(afterTest).toHaveLength(10)
	})

	test('writeJsonFileAtomic preserves explicit file mode from tmp write', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-state-'))
		const path = join(stateDir, 'sample.json')
		writeJsonFileAtomic(path, { ok: true }, 0o600)
		const mode = statSync(path).mode & 0o777
		expect(mode).toBe(0o600)
		expect(readFileSync(path, 'utf-8')).toContain('"ok":true')
	})

	test('appendEventLine defers trim via setImmediate', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-state-'))
		for (let i = 0; i < 25; i++) {
			appendEventLine(stateDir, { ...validBase, id: `e${i}`, kind: 'done', title: `t${i}` }, 10)
		}
		const beforeTrim = readFileSync(join(stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(beforeTrim).toHaveLength(25)
		await new Promise<void>((resolve) => setImmediate(resolve))
		const afterTrim = readFileSync(join(stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(afterTrim).toHaveLength(10)
	})
})
