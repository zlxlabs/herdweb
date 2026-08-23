// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, test } from 'vitest'
import {
	HISTORY_DEFAULT_LIMIT,
	HISTORY_MAX_LIMIT,
	HISTORY_MIN_LIMIT,
	clampHistoryLimit,
	parseHistoryLimitParam,
	readEventHistory,
} from '../src/notify/history'
import { registerNotifyRoutes } from '../src/notify/routes'
import { createNotifyService } from '../src/notify/service'
import { appendEventLine } from '../src/notify/state'
import { buildSecurityHeaders, isAllowedOrigin, withSecurityHeaders } from '../src/serve'

const validBase = {
	v: 1,
	id: 'evt-1',
	kind: 'asking',
	title: 'Need input',
	ts: 1_700_000_000,
} as const

describe('clampHistoryLimit', () => {
	test('defaults non-finite to 50', () => {
		expect(clampHistoryLimit(Number.NaN)).toBe(HISTORY_DEFAULT_LIMIT)
		expect(clampHistoryLimit(Number.POSITIVE_INFINITY)).toBe(HISTORY_DEFAULT_LIMIT)
	})

	test('clamps below minimum to 1', () => {
		expect(clampHistoryLimit(0)).toBe(HISTORY_MIN_LIMIT)
		expect(clampHistoryLimit(-10)).toBe(HISTORY_MIN_LIMIT)
	})

	test('clamps above maximum to 500', () => {
		expect(clampHistoryLimit(1000)).toBe(HISTORY_MAX_LIMIT)
		expect(clampHistoryLimit(501)).toBe(HISTORY_MAX_LIMIT)
	})

	test('floors fractional values', () => {
		expect(clampHistoryLimit(3.9)).toBe(3)
	})
})

describe('parseHistoryLimitParam', () => {
	test('defaults missing param to 50', () => {
		expect(parseHistoryLimitParam(undefined)).toBe(HISTORY_DEFAULT_LIMIT)
		expect(parseHistoryLimitParam('')).toBe(HISTORY_DEFAULT_LIMIT)
	})

	test('clamps out-of-range query values', () => {
		expect(parseHistoryLimitParam('0')).toBe(HISTORY_MIN_LIMIT)
		expect(parseHistoryLimitParam('999')).toBe(HISTORY_MAX_LIMIT)
		expect(parseHistoryLimitParam('abc')).toBe(HISTORY_DEFAULT_LIMIT)
	})
})

describe('readEventHistory', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
		stateDir = undefined
	})

	test('returns empty array for missing file', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		expect(readEventHistory(stateDir, 50)).toEqual([])
	})

	test('returns empty array for empty file', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		writeFileSync(join(stateDir, 'events.jsonl'), '')
		expect(readEventHistory(stateDir, 50)).toEqual([])
	})

	test('returns newest-first tail events', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		for (let i = 0; i < 5; i++) {
			appendEventLine(
				stateDir,
				{ ...validBase, id: `e${i}`, kind: 'done', title: `t${i}`, ts: i },
				200,
			)
		}
		const events = readEventHistory(stateDir, 3)
		expect(events).toHaveLength(3)
		expect(events.map((e) => e.id)).toEqual(['e4', 'e3', 'e2'])
	})

	test('does not include test kind events', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		appendEventLine(stateDir, { ...validBase, id: 'real', kind: 'done' }, 200)
		const path = join(stateDir, 'events.jsonl')
		const lines = readFileSync(path, 'utf-8').trim().split('\n')
		writeFileSync(
			path,
			`${lines.join('\n')}\n${JSON.stringify({ v: 1, id: '', kind: 'test', title: 'skip', ts: 1 })}\n`,
		)
		const events = readEventHistory(stateDir, 50)
		expect(events).toHaveLength(1)
		expect(events[0]?.id).toBe('real')
	})
})

function routeVariants(basePath: string, path: string): readonly string[] {
	return basePath === '/' ? [path] : [path, `${basePath}${path}`]
}

interface HistoryHarness {
	readonly port: number
	readonly stateDir: string
	close(): void
}

async function createHistoryHarness(): Promise<HistoryHarness> {
	const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-route-'))
	const notifyService = createNotifyService({ stateDir, historyLimit: 200 })
	const app = new Hono()
	const securityHeaders = buildSecurityHeaders('127.0.0.1:0', '127.0.0.1', 0, 'nonce')
	registerNotifyRoutes(app, {
		basePath: '/',
		notifyService,
		stateDir,
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

describe('GET /api/events/history', () => {
	let harness: HistoryHarness | undefined

	afterEach(() => {
		harness?.close()
		harness = undefined
	})

	test('returns newest-first events with default limit', async () => {
		harness = await createHistoryHarness()
		for (let i = 0; i < 5; i++) {
			appendEventLine(
				harness.stateDir,
				{ ...validBase, id: `h${i}`, kind: 'done', title: `t${i}`, ts: i },
				200,
			)
		}
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events/history`)
		expect(response.status).toBe(200)
		const body = (await response.json()) as { events: Array<{ id: string }> }
		expect(body.events.map((e) => e.id)).toEqual(['h4', 'h3', 'h2', 'h1', 'h0'])
	})

	test('respects limit query param with clamping', async () => {
		harness = await createHistoryHarness()
		for (let i = 0; i < 5; i++) {
			appendEventLine(
				harness.stateDir,
				{ ...validBase, id: `c${i}`, kind: 'done', title: `t${i}`, ts: i },
				200,
			)
		}
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events/history?limit=2`)
		expect(response.status).toBe(200)
		const body = (await response.json()) as { events: Array<{ id: string }> }
		expect(body.events.map((e) => e.id)).toEqual(['c4', 'c3'])

		const clamped = await fetch(`http://127.0.0.1:${harness.port}/api/events/history?limit=0`)
		const clampedBody = (await clamped.json()) as { events: Array<{ id: string }> }
		expect(clampedBody.events.map((e) => e.id)).toEqual(['c4'])
	})

	test('returns empty array when no events file exists', async () => {
		harness = await createHistoryHarness()
		const response = await fetch(`http://127.0.0.1:${harness.port}/api/events/history`)
		expect(response.status).toBe(200)
		const body = (await response.json()) as { events: unknown[] }
		expect(body.events).toEqual([])
	})
})
