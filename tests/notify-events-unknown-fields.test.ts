// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NotifyEventError, parseNotifyEvent } from '../src/notify/events'
import { registerNotifyRoutes } from '../src/notify/routes'
import { createNotifyService } from '../src/notify/service'
import { buildSecurityHeaders, isAllowedOrigin, withSecurityHeaders } from '../src/serve'

const PRODUCER_FIXTURE_PATH = join(import.meta.dirname, 'fixtures/notify-producer-host-event.json')

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
	close(): void
}

async function createHarness(
	targetMode: 'single' | 'explicit' = 'single',
	targetIds: readonly string[] = ['default'],
): Promise<TestHarness> {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-unknown-'))
	const notifyService = createNotifyService({
		stateDir,
		historyLimit: 200,
		targetMode,
		targetIds,
	})
	const app = new Hono()
	const securityHeaders = buildSecurityHeaders('127.0.0.1:0', '127.0.0.1', 0, 'nonce')
	registerNotifyRoutes(app, {
		basePath: '/',
		notifyService,
		stateDir,
		targetMode,
		targetIds,
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

describe('parseNotifyEvent unknown top-level fields', () => {
	test('ignores host and returns its name without throwing', () => {
		const parsed = parseNotifyEvent(
			JSON.stringify({ ...validBase, v: 2, targetId: 'local', host: 'vm-a' }),
		)
		expect(parsed.kind).toBe('asking')
		expect(parsed.ignoredFields).toEqual(['host'])
		expect(JSON.parse(JSON.stringify(parsed))).not.toHaveProperty('host')
	})

	test('strips extra and foo while keeping the event', () => {
		const parsed = parseNotifyEvent(JSON.stringify({ ...validBase, extra: true, foo: 'x' }))
		expect(parsed.id).toBe('evt-1')
		expect(parsed.ignoredFields).toEqual(['extra', 'foo'])
	})

	test('returns an empty ignoredFields list when every key is known', () => {
		const parsed = parseNotifyEvent(JSON.stringify(validBase))
		expect(parsed.ignoredFields).toEqual([])
		expect(JSON.stringify(parsed)).toBe(JSON.stringify(validBase))
	})

	test('still rejects invalid kind after ignoring host', () => {
		try {
			parseNotifyEvent(JSON.stringify({ ...validBase, kind: 'not-a-kind', host: 'vm-a' }))
			throw new Error('expected throw')
		} catch (error) {
			expect(error).toBeInstanceOf(NotifyEventError)
			expect((error as NotifyEventError).statusCode).toBe(400)
			expect((error as NotifyEventError).message).toBe('invalid kind')
		}
	})

	test('caps ignored field names at 16 entries of 64 characters', () => {
		const extra: Record<string, string> = {}
		for (let i = 0; i < 18; i++) {
			extra[`k${i}_${'x'.repeat(70)}`] = '1'
		}
		const parsed = parseNotifyEvent(JSON.stringify({ ...validBase, ...extra }))
		expect(parsed.ignoredFields).toHaveLength(16)
		expect(parsed.ignoredFields.every((name) => name.length <= 64)).toBe(true)
		expect(parsed.ignoredFields[0]).toBe(`k0_${'x'.repeat(70)}`.slice(0, 64))
	})
})

describe('POST /api/events unknown field receipt', () => {
	let harness: TestHarness

	afterEach(() => {
		harness?.close()
	})

	test('accepts the producer host fixture bytes with ignoredFields', async () => {
		harness = await createHarness('explicit', ['local'])
		const raw = readFileSync(PRODUCER_FIXTURE_PATH)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: raw,
		})
		expect(response.status).toBe(202)
		const body = (await response.json()) as {
			outcome: string
			ignoredFields?: string[]
		}
		expect(body.ignoredFields).toEqual(['host'])
		expect(body.outcome).toBe('dispatched')
		const stored = readFileSync(join(harness.stateDir, 'events.jsonl'), 'utf-8')
		expect(stored).toContain('producer-host-1')
		expect(stored).not.toContain('"host"')
		expect(decisionLines(logSpy).some((line) => line.includes('ignoredFields=host'))).toBe(true)
		logSpy.mockRestore()
	})

	test('rejects invalid kind with 400 and logs the parse error message', async () => {
		harness = await createHarness()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...validBase, kind: 'not-a-kind' }),
		})
		expect(response.status).toBe(400)
		expect(await response.text()).toBe('invalid kind')
		expect(existsSync(join(harness.stateDir, 'events.jsonl'))).toBe(false)
		expect(decisionLines(logSpy)).toContain(
			'herdweb: notify decision rejected reason=invalid-event status=400 detail=invalid kind',
		)
		logSpy.mockRestore()
	})
})
