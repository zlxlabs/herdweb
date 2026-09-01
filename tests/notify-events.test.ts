// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NOTIFY_TS_MIN_MS, NotifyEventError, parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { SlidingWindowRateLimiter } from '../src/notify/rate-limit'
import { registerNotifyRoutes } from '../src/notify/routes'
import { createNotifyService } from '../src/notify/service'
import { buildSecurityHeaders, isAllowedOrigin, withSecurityHeaders } from '../src/serve'

function routeVariants(basePath: string, path: string): readonly string[] {
	return basePath === '/' ? [path] : [path, `${basePath}${path}`]
}

function decisionLines(spy: ReturnType<typeof vi.spyOn>): string[] {
	return spy.mock.calls
		.map((args) => String(args[0]))
		.filter((line) => line.startsWith('herdweb: notify decision'))
}

interface TestHarness {
	readonly port: number
	readonly stateDir: string
	readonly notifyService: ReturnType<typeof createNotifyService>
	readonly fetchApp: (request: Request) => Response | Promise<Response>
	close(): void
}

async function createHarness(
	token?: string,
	targetMode: 'single' | 'explicit' = 'single',
	targetIds: readonly string[] = ['default'],
): Promise<TestHarness> {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-events-'))
	const notifyService = createNotifyService({ stateDir, historyLimit: 200, targetMode, targetIds })
	const app = new Hono()
	const securityHeaders = buildSecurityHeaders('127.0.0.1:0', '127.0.0.1', 0, 'nonce')
	registerNotifyRoutes(app, {
		basePath: '/',
		notifyService,
		stateDir,
		targetMode,
		targetIds,
		token,
		securityHeadersForRequest: () => securityHeaders,
		routeVariants,
		withSecurityHeaders,
		isAllowedOrigin,
	})

	return await new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
			resolve({
				port: info.port,
				stateDir,
				notifyService,
				fetchApp: (request) => app.fetch(request),
				close() {
					server.close()
					notifyService.dispose()
					rmSync(stateDir, { recursive: true, force: true })
				},
			})
		})
	})
}

const validBase = {
	v: 1,
	id: 'evt-1',
	kind: 'asking',
	title: 'Need input',
	ts: 1_700_000_000_000,
} as const

describe('parseNotifyEvent', () => {
	test.each([
		['asking', 'asking'],
		['done', 'done'],
		['ci-red', 'ci-red'],
		['silence', 'silence'],
		['health', 'health'],
		['test', 'test'],
		['patrol', 'patrol'],
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
		['missing id for non-test', { v: 1, kind: 'asking', title: 'T', ts: 1_700_000_000_000 }],
	])('rejects %s with 400', (_label, payload) => {
		try {
			parseNotifyEvent(JSON.stringify(payload))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
		}
	})

	test.each(['root', 'child'] as const)('accepts role=%s', (role) => {
		const parsed = parseNotifyEvent(JSON.stringify({ ...validBase, role }))
		expect(parsed.role).toBe(role)
	})

	test('accepts optional parentId and startedAt', () => {
		const parsed = parseNotifyEvent(
			JSON.stringify({
				...validBase,
				role: 'child',
				parentId: 'root-1',
				startedAt: 1_700_000_000,
			}),
		)
		expect(parsed.parentId).toBe('root-1')
		expect(parsed.startedAt).toBe(1_700_000_000)
	})

	test.each(['likely-present', 'likely-away', 'unknown'] as const)(
		'accepts presence=%s',
		(presence) => {
			const parsed = parseNotifyEvent(JSON.stringify({ ...validBase, presence }))
			expect(parsed.presence).toBe(presence)
		},
	)

	test('accepts optional presenceAt as epoch ms', () => {
		const parsed = parseNotifyEvent(
			JSON.stringify({ ...validBase, presence: 'likely-present', presenceAt: 1_700_000_000_000 }),
		)
		expect(parsed.presence).toBe('likely-present')
		expect(parsed.presenceAt).toBe(1_700_000_000_000)
	})

	test.each([
		['role=parent', { ...validBase, role: 'parent' }],
		['empty parentId', { ...validBase, parentId: '' }],
		['non-string parentId', { ...validBase, parentId: 1 }],
		['non-finite startedAt', { ...validBase, startedAt: Number.POSITIVE_INFINITY }],
		['NaN startedAt', { ...validBase, startedAt: Number.NaN }],
		['string startedAt', { ...validBase, startedAt: '1' }],
		['unknown field foo', { ...validBase, foo: 'x' }],
		['invalid presence value', { ...validBase, presence: 'present' }],
		['non-string presence', { ...validBase, presence: 1 }],
		['string presenceAt', { ...validBase, presenceAt: '1700000000000' }],
		['NaN presenceAt', { ...validBase, presenceAt: Number.NaN }],
		['non-finite presenceAt', { ...validBase, presenceAt: Number.POSITIVE_INFINITY }],
		['non-string task_id', { ...validBase, task_id: 1 }],
		['non-string dispatch_id', { ...validBase, dispatch_id: 1 }],
		['non-string drift', { ...validBase, drift: 1 }],
		['non-string contentMarkdown', { ...validBase, contentMarkdown: 123 }],
		['array contentMarkdown', { ...validBase, contentMarkdown: ['markdown'] }],
		['object contentMarkdown', { ...validBase, contentMarkdown: { text: 'markdown' } }],
		['boolean contentMarkdown', { ...validBase, contentMarkdown: true }],
	])('rejects %s with 400', (_label, payload) => {
		try {
			parseNotifyEvent(JSON.stringify(payload))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
		}
	})

	test('accepts contentMarkdown verbatim from serialized JSON', () => {
		const raw =
			'{"v":1,"id":"md-1","kind":"done","title":"Done","ts":1700000000000,"contentMarkdown":"## Build succeeded\\n\\n- lint: pass\\n- test: pass"}'
		const event = parseNotifyEvent(raw)
		expect(event.contentMarkdown).toBe('## Build succeeded\n\n- lint: pass\n- test: pass')
	})

	test('accepts contentMarkdown with multi-byte characters and emojis', () => {
		const md = '【巡查·正常】构建完成 🚀 状态：全部就绪'
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, contentMarkdown: md }))
		expect(event.contentMarkdown).toBe(md)
	})

	test('truncates contentMarkdown over 4096 UTF-8 bytes and preserves valid UTF-8', () => {
		const asciiHuge = 'a'.repeat(5000)
		const asciiEvent = parseNotifyEvent(
			JSON.stringify({ ...validBase, contentMarkdown: asciiHuge }),
		)
		expect(asciiEvent.contentMarkdown).toHaveLength(4096)
		expect(Buffer.byteLength(asciiEvent.contentMarkdown!, 'utf8')).toBe(4096)

		// 3-byte Chinese characters: 4094 ASCII bytes + 1 Chinese char (3 bytes) + extra
		// Boundary at 4096 cuts through the 3-byte character, so it should be truncated to 4094 bytes.
		const chineseBoundary = 'a'.repeat(4094) + '中' + 'extra'
		const chineseEvent = parseNotifyEvent(
			JSON.stringify({ ...validBase, contentMarkdown: chineseBoundary }),
		)
		expect(chineseEvent.contentMarkdown).toBe('a'.repeat(4094))
		expect(Buffer.byteLength(chineseEvent.contentMarkdown!, 'utf8')).toBe(4094)
		expect(chineseEvent.contentMarkdown).not.toContain('\uFFFD')

		// 4-byte Emoji: 4095 ASCII bytes + 1 emoji (4 bytes) + extra
		// Boundary at 4096 cuts through the 4-byte emoji, so it should be truncated to 4095 bytes.
		const emojiBoundary = 'a'.repeat(4095) + '🚀' + 'extra'
		const emojiEvent = parseNotifyEvent(
			JSON.stringify({ ...validBase, contentMarkdown: emojiBoundary }),
		)
		expect(emojiEvent.contentMarkdown).toBe('a'.repeat(4095))
		expect(Buffer.byteLength(emojiEvent.contentMarkdown!, 'utf8')).toBe(4095)
		expect(emojiEvent.contentMarkdown).not.toContain('\uFFFD')

		// Entirely Chinese characters: 2000 chars * 3 bytes = 6000 bytes.
		// 4096 / 3 = 1365 chars (4095 bytes).
		const allChinese = '中'.repeat(2000)
		const allChineseEvent = parseNotifyEvent(
			JSON.stringify({ ...validBase, contentMarkdown: allChinese }),
		)
		expect(allChineseEvent.contentMarkdown).toBe('中'.repeat(1365))
		expect(Buffer.byteLength(allChineseEvent.contentMarkdown!, 'utf8')).toBe(4095)
		expect(allChineseEvent.contentMarkdown).not.toContain('\uFFFD')
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

	test('rejects raw payload over 16 KiB with 413 and accepts up to 16 KiB', () => {
		const accepted = JSON.stringify({
			...validBase,
			contentMarkdown: 'x'.repeat(4000),
			body: 'b'.repeat(200),
		})
		expect(parseNotifyEvent(accepted).contentMarkdown).toHaveLength(4000)

		const huge = JSON.stringify({ ...validBase, contentMarkdown: 'x'.repeat(17 * 1024) })
		try {
			parseNotifyEvent(huge)
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(413)
		}
	})

	test.each([
		['Unix-second sample', 1_788_090_200],
		['placeholder 1', 1],
		['just below millisecond lower bound', NOTIFY_TS_MIN_MS - 1],
	])('rejects %s ts with 400', (_label, ts) => {
		try {
			parseNotifyEvent(JSON.stringify({ ...validBase, ts }))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
			expect((error as NotifyEventError).message).toMatch(/milliseconds|epoch ms/i)
		}
	})

	test('accepts ts at the millisecond lower bound', () => {
		expect(NOTIFY_TS_MIN_MS).toBe(1_000_000_000_000)
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, ts: NOTIFY_TS_MIN_MS }))
		expect(event.ts).toBe(NOTIFY_TS_MIN_MS)
	})

	test('accepts Date.now() magnitude', () => {
		const ts = Date.now()
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, ts }))
		expect(event.ts).toBe(ts)
	})

	test.each([
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['string', '1'],
		['null', null],
	])('rejects non-finite ts (%s) with 400', (_label, ts) => {
		try {
			parseNotifyEvent(JSON.stringify({ ...validBase, ts }))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
			expect((error as NotifyEventError).message).toBe('ts must be a finite number')
		}
	})
})

describe('parseNotifyEvent patrol producer fields', () => {
	// issue #127 measured producer payload; ts is epoch ms after the ingress lock (#129).
	const AGENT_CONFIG_PATROL_PAYLOAD =
		'{"v":1,"id":"overflow:1788090200","kind":"patrol","title":"【巡查·超限】","ts":1788090200000,"task_id":"overflow","drift":"overflow","body":"truncated lost=0 stalled=0 stranded=13"}'

	test('accepts the agent-config patrol producer payload verbatim', () => {
		const event = parseNotifyEvent(AGENT_CONFIG_PATROL_PAYLOAD)
		expect(event.kind).toBe('patrol')
		expect(event.id).toBe('overflow:1788090200')
		expect(event.task_id).toBe('overflow')
		expect(event.drift).toBe('overflow')
	})

	test('accepts task_id alone without 400', () => {
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, task_id: 'overflow' }))
		expect(event.task_id).toBe('overflow')
		expect(event.kind).toBe('asking')
	})

	test('accepts dispatch_id alone without 400', () => {
		const event = parseNotifyEvent(
			JSON.stringify({ ...validBase, dispatch_id: 'dlg-20260830-121041-afb841' }),
		)
		expect(event.dispatch_id).toBe('dlg-20260830-121041-afb841')
	})

	test('accepts drift alone without 400', () => {
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, drift: 'lost' }))
		expect(event.drift).toBe('lost')
	})

	test('accepts a drift value outside the current producer set', () => {
		const event = parseNotifyEvent(
			JSON.stringify({ ...validBase, kind: 'patrol', drift: 'future-kind' }),
		)
		expect(event.kind).toBe('patrol')
		expect(event.drift).toBe('future-kind')
	})

	test('accepts kind=patrol with no optional producer fields', () => {
		const event = parseNotifyEvent(JSON.stringify({ ...validBase, kind: 'patrol' }))
		expect(event.kind).toBe('patrol')
		expect(event.task_id).toBeUndefined()
		expect(event.dispatch_id).toBeUndefined()
		expect(event.drift).toBeUndefined()
	})
})

describe('POST /api/events', () => {
	let harness: TestHarness

	afterEach(() => {
		harness?.close()
	})

	test('accepts valid event with 202 and persists', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				v: 1,
				id: 'persist-1',
				kind: 'done',
				title: 'Done',
				ts: 1_700_000_000_000,
			}),
		})
		expect(response.status).toBe(202)
		const lines = readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim()
		expect(lines).toContain('persist-1')
		expect(decisionLines(logSpy)).toContain(
			'herdweb: notify decision skipped kind=done id=persist-1 reason=done-coalesced',
		)
		logSpy.mockRestore()
	})

	test('rejects Unix-second ts over HTTP with 400 and does not persist', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				v: 1,
				id: 'sec-1',
				kind: 'done',
				title: 'Done',
				ts: 1_788_090_200,
			}),
		})
		expect(response.status).toBe(400)
		expect(await response.text()).toMatch(/milliseconds|epoch ms/i)
		expect(existsSync(join(harness.stateDir, 'events.jsonl'))).toBe(false)
		expect(decisionLines(logSpy)).toContain(
			'herdweb: notify decision rejected reason=invalid-event status=400',
		)
		logSpy.mockRestore()
	})

	test('accepts Date.now() ts over HTTP with 202 and persists', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const ts = Date.now()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ v: 1, id: 'persist-ms', kind: 'done', title: 'Done', ts }),
		})
		expect(response.status).toBe(202)
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim(),
		) as { id?: string; ts?: number }
		expect(stored).toMatchObject({ id: 'persist-ms', ts })
		logSpy.mockRestore()
	})

	test('accepts the agent-config patrol producer payload over HTTP', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const body =
			'{"v":1,"id":"overflow:1788090200","kind":"patrol","title":"【巡查·超限】","ts":1788090200000,"task_id":"overflow","drift":"overflow","body":"truncated lost=0 stalled=0 stranded=13"}'
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
		})
		expect(response.status).toBe(202)
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim(),
		) as { kind?: string; task_id?: string; drift?: string }
		expect(stored).toMatchObject({
			kind: 'patrol',
			task_id: 'overflow',
			drift: 'overflow',
		})
		logSpy.mockRestore()
	})

	test('persists optional role parentId startedAt into jsonl', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				v: 1,
				id: 'child-1',
				kind: 'done',
				title: 'Child done',
				ts: 1_700_000_000_000,
				role: 'child',
				parentId: 'root-1',
				startedAt: 99,
			}),
		})
		expect(response.status).toBe(202)
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim(),
		) as {
			role?: string
			parentId?: string
			startedAt?: number
		}
		expect(stored).toMatchObject({ role: 'child', parentId: 'root-1', startedAt: 99 })
		logSpy.mockRestore()
	})

	test('persists presence fields into jsonl', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				v: 1,
				id: 'presence-1',
				kind: 'asking',
				title: 'Need input',
				ts: 1_700_000_000_000,
				presence: 'likely-present',
				presenceAt: 1_700_000_000_000,
			}),
		})
		expect(response.status).toBe(202)
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim(),
		) as {
			presence?: string
			presenceAt?: number
		}
		expect(stored).toMatchObject({ presence: 'likely-present', presenceAt: 1_700_000_000_000 })
		logSpy.mockRestore()
	})

	test('rejects invalid presence over HTTP with 400', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...validBase, id: 'presence-bad', presence: 'definitely-here' }),
		})
		expect(response.status).toBe(400)
		expect(decisionLines(logSpy)).toContain(
			'herdweb: notify decision rejected reason=invalid-event status=400',
		)
		logSpy.mockRestore()
	})

	test('requires bearer token when configured', async () => {
		harness = await createHarness('secret')
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const deniedBody = JSON.stringify({
			v: 1,
			id: 'auth-1',
			kind: 'done',
			title: 'T',
			ts: 1_700_000_000_000,
		})
		const denied = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: deniedBody,
		})
		expect(denied.status).toBe(401)
		expect(decisionLines(logSpy)).toEqual([
			'herdweb: notify decision rejected reason=unauthorized status=401',
		])
		expect(decisionLines(logSpy).join('\n')).not.toContain(deniedBody)
		expect(decisionLines(logSpy).join('\n')).not.toContain('auth-1')
		const allowed = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer secret',
			},
			body: JSON.stringify({
				v: 1,
				id: 'auth-2',
				kind: 'done',
				title: 'T',
				ts: 1_700_000_000_000,
			}),
		})
		expect(allowed.status).toBe(202)
		logSpy.mockRestore()
	})

	test('returns 429 after 60 events per minute', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		let lastStatus = 202
		for (let i = 0; i < 61; i++) {
			const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					v: 1,
					id: `rate-${i}`,
					kind: 'done',
					title: 'T',
					ts: 1_700_000_000_000,
				}),
			})
			lastStatus = response.status
		}
		expect(lastStatus).toBe(429)
		const rejected = decisionLines(logSpy).filter((line) => line.includes('rejected'))
		expect(rejected).toEqual(['herdweb: notify decision rejected reason=rate-limited status=429'])
		expect(rejected.join('\n')).not.toContain('rate-60')
		logSpy.mockRestore()
	})

	test('duplicate id returns 202 without double append', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const body = JSON.stringify({
			v: 1,
			id: 'dup',
			kind: 'done',
			title: 'T',
			ts: 1_700_000_000_000,
		})
		expect(
			(
				await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
				})
			).status,
		).toBe(202)
		expect(
			(
				await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
				})
			).status,
		).toBe(202)
		const lines = readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim().split('\n')
		expect(lines).toHaveLength(1)
		const decision = logSpy.mock.calls
			.map((args) => String(args[0]))
			.filter((line) => line.startsWith('herdweb: notify decision'))
		expect(decision.filter((line) => line.includes('skipped') && line.includes('id=dup'))).toEqual([
			'herdweb: notify decision skipped kind=done id=dup reason=done-coalesced',
		])
		expect(decision.filter((line) => line.includes('reason=duplicate'))).toEqual([
			'herdweb: notify decision duplicate kind=done id=dup reason=duplicate',
		])
		logSpy.mockRestore()
	})

	test('explicit producer requires v2 and a known target', async () => {
		harness = await createHarness(undefined, 'explicit', ['local', 'workbox'])
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const v1Body = { ...validBase, id: 'v1-explicit' }
		const post = (body: object) =>
			fetch(`http://127.0.0.1:${harness.port}/api/events`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})
		expect((await post(v1Body)).status).toBe(400)
		expect(decisionLines(logSpy)).toContain(
			'herdweb: notify decision rejected reason=invalid-event status=400',
		)
		expect(decisionLines(logSpy).join('\n')).not.toContain('v1-explicit')
		const v2 = {
			v: 2,
			targetId: 'workbox',
			id: 'v2-explicit',
			kind: 'done',
			title: 'Done',
			ts: 1_700_000_000_000,
		}
		await post(v2)
		expect(readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8')).toContain(
			'"targetId":"workbox"',
		)
		expect((await post({ ...v2, targetId: 'missing' })).status).toBe(400)
		logSpy.mockRestore()
	})

	test('kind=test bypasses dedup and disk', async () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-test-kind-'))
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: Date.now(),
			},
		])
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		const payload = parseNotifyEvent(
			JSON.stringify({ v: 1, kind: 'test', title: 'T', ts: 1_700_000_000_000 }),
		)
		expect(notifyService.dispatchEvent(payload)).toBe('accepted')
		expect(notifyService.dispatchEvent(payload)).toBe('accepted')
		expect(() => readFileSync(join(stateDir, 'events.jsonl'))).toThrow()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(2)
		expect(decisionLines(logSpy).filter((line) => line.includes('kind=test'))).toEqual([
			'herdweb: notify decision accepted kind=test id=test:1',
			'herdweb: notify decision accepted kind=test id=test:2',
		])
		notifyService.dispose()
		rmSync(stateDir, { recursive: true, force: true })
		logSpy.mockRestore()
	})

	test('FIFO dedup eviction allows reuse after capacity', () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-fifo-'))
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
		for (let i = 0; i < 1001; i++) {
			const event = parseNotifyEvent(
				JSON.stringify({ v: 1, id: `id-${i}`, kind: 'done', title: 'T', ts: 1_700_000_000_000 }),
			)
			notifyService.dispatchEvent(event)
		}
		const replay = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'id-0', kind: 'done', title: 'T', ts: 1_700_000_000_000 }),
		)
		expect(notifyService.dispatchEvent(replay)).toBe('accepted')
		notifyService.dispose()
		rmSync(stateDir, { recursive: true, force: true })
		logSpy.mockRestore()
	})

	test('rejects non-loopback POST with decision log and no body', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const body = JSON.stringify({
			v: 1,
			id: 'remote-1',
			kind: 'done',
			title: 'T',
			ts: 1_700_000_000_000,
		})
		const response = await harness.fetchApp(
			new Request('http://term.example.ts.net/api/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			}),
		)
		expect(response.status).toBe(403)
		expect(decisionLines(logSpy)).toEqual([
			'herdweb: notify decision rejected reason=not-loopback status=403',
		])
		expect(decisionLines(logSpy).join('\n')).not.toContain(body)
		expect(decisionLines(logSpy).join('\n')).not.toContain('remote-1')
		logSpy.mockRestore()
	})

	test('persists contentMarkdown into jsonl', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const md = '## Status Update\n\n- Task completed'
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				v: 1,
				id: 'md-post-1',
				kind: 'done',
				title: 'Task Done',
				ts: 1_700_000_000_000,
				contentMarkdown: md,
			}),
		})
		expect(response.status).toBe(202)
		const stored = JSON.parse(
			readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8').trim(),
		) as {
			contentMarkdown?: string
		}
		expect(stored).toMatchObject({ contentMarkdown: md })
		logSpy.mockRestore()
	})

	test('rejects oversized payload with decision log and no body', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const body = JSON.stringify({
			v: 1,
			id: 'huge-1',
			kind: 'done',
			title: 'T',
			ts: 1_700_000_000_000,
			contentMarkdown: 'x'.repeat(17 * 1024),
		})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
		})
		expect(response.status).toBe(413)
		expect(decisionLines(logSpy)).toEqual([
			'herdweb: notify decision rejected reason=payload-too-large status=413',
		])
		expect(decisionLines(logSpy).join('\n')).not.toContain(body)
		expect(decisionLines(logSpy).join('\n')).not.toContain('huge-1')
		logSpy.mockRestore()
	})
})

describe('SlidingWindowRateLimiter', () => {
	test('blocks the 61st event in a window', () => {
		const limiter = new SlidingWindowRateLimiter(60, 60_000, () => 0)
		for (let i = 0; i < 60; i++) {
			expect(limiter.allow()).toBe(true)
		}
		expect(limiter.allow()).toBe(false)
	})
})

describe('GET /api/push/vapid-key', () => {
	let harness: TestHarness

	afterEach(() => {
		harness?.close()
	})

	test('returns 200 without Origin on non-loopback Host', async () => {
		harness = await createHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/push/vapid-key`, {
			headers: { Host: 'term.example.ts.net' },
		})
		expect(response.status).toBe(200)
		const body = (await response.json()) as { publicKey: string }
		expect(body.publicKey.length).toBeGreaterThan(0)
	})
})

describe('POST /api/push/test', () => {
	let harness: TestHarness

	afterEach(() => {
		harness?.close()
	})

	test('returns 202 and dispatches kind=test with matching Origin', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const dispatchSpy = vi.spyOn(harness.notifyService, 'dispatchEvent')
		const host = `127.0.0.1:${harness.port}`
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/push/test`, {
			method: 'POST',
			headers: {
				Origin: `http://${host}`,
				Host: host,
			},
		})
		expect(response.status).toBe(202)
		expect(dispatchSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'test',
				title: 'herdweb test',
				body: 'Test notification from panel',
			}),
		)
		logSpy.mockRestore()
	})

	test('returns 403 without Origin on non-loopback Host', async () => {
		harness = await createHarness()
		const response = await harness.fetchApp(
			new Request('http://term.example.ts.net/api/push/test', { method: 'POST' }),
		)
		expect(response.status).toBe(403)
	})

	test('returns 429 after 60 requests per minute', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const host = `127.0.0.1:${harness.port}`
		let lastStatus = 202
		for (let i = 0; i < 61; i++) {
			const response = await fetch(`http://127.0.0.1:${harness.port}/api/push/test`, {
				method: 'POST',
				headers: {
					Origin: `http://${host}`,
					Host: host,
				},
			})
			lastStatus = response.status
		}
		expect(lastStatus).toBe(429)
		logSpy.mockRestore()
	})

	test('explicit mode uses validated targetId query for v2 test events', async () => {
		harness = await createHarness(undefined, 'explicit', ['local', 'workbox'])
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const dispatchSpy = vi.spyOn(harness.notifyService, 'dispatchEvent')
		const post = (query = '') =>
			fetch(`http://127.0.0.1:${harness.port}/api/push/test${query}`, {
				method: 'POST',
				headers: {
					Origin: `http://127.0.0.1:${harness.port}`,
					Host: `127.0.0.1:${harness.port}`,
				},
			})
		expect((await post('?targetId=workbox')).status).toBe(202)
		expect(dispatchSpy).toHaveBeenCalledWith(
			expect.objectContaining({ v: 2, targetId: 'workbox', kind: 'test' }),
		)
		expect((await post()).status).toBe(400)
		expect((await post('?targetId=nope')).status).toBe(400)
		logSpy.mockRestore()
	})
})
