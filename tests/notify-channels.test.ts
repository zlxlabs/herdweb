import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildNotifyContent, sendNotifyChannels } from '../src/notify/channels'
import { type NotifyEvent, parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'

const event: NotifyEvent = {
	v: 1,
	id: 'event-1',
	kind: 'done',
	session: 'dev',
	title: 'Build finished',
	body: 'All checks passed',
	reason: 'exit 0',
	ts: 123,
}

interface CapturedRequest {
	readonly request: Request
	readonly body: string
}

function captureFetch(status = 204): CapturedRequest[] {
	const requests: CapturedRequest[] = []
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init)
			requests.push({ request, body: await request.text() })
			return new Response(null, { status })
		}),
	)
	return requests
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('notify channel content', () => {
	test.each([
		['title only', { kind: 'asking' as const, title: 'Need input' }, '【等待输入】Need input'],
		[
			'title and body',
			{ kind: 'done' as const, title: 'Done', body: 'Finished' },
			'【完成】Done\nFinished',
		],
		[
			'all optional fields',
			{
				kind: 'done' as const,
				title: 'Done',
				body: 'Finished',
				session: 'dev',
				reason: 'exit 0',
			},
			'【完成】Done\nFinished\n会话：dev\n原因：exit 0',
		],
		['test label', { kind: 'test' as const, title: 'Test' }, '【测试】Test'],
	] as const)('assembles %s without extra blank lines', (_name, input, expected) => {
		expect(buildNotifyContent({ v: 1, id: 'content', ts: 1, ...input })).toBe(expected)
	})

	test.each([
		['no session or body', {}, '【测试】Test'],
		['session without body', { session: 'default' }, '【测试】Test\n会话：default'],
		[
			'session with body that does not contain it',
			{ session: 'default', body: '正文不含该值' },
			'【测试】Test\n正文不含该值\n会话：default',
		],
		[
			'body already contains a UUID session',
			{
				session: '39b36907-9086-4637-8de9-285d423f3e0b',
				body: 'pane=w15:p1 session=39b36907-9086-4637-8de9-285d423f3e0b',
			},
			'【测试】Test\npane=w15:p1 session=39b36907-9086-4637-8de9-285d423f3e0b',
		],
		[
			'body already contains default session',
			{ session: 'default', body: 'session=default' },
			'【测试】Test\nsession=default',
		],
		[
			'substring match is treated as contained',
			{ session: 'abc', body: 'abcdef' },
			'【测试】Test\nabcdef',
		],
	] as const)('deduplicates a session already present in body: %s', (_name, input, expected) => {
		expect(
			buildNotifyContent({ v: 1, id: 'content', kind: 'test', title: 'Test', ts: 1, ...input }),
		).toBe(expected)
	})
})

describe('notify channel request bytes', () => {
	test('message-pusher uses JSON desp and the fixed endpoint', async () => {
		const requests = captureFetch()
		const targetEvent: NotifyEvent = { ...event, v: 2, targetId: 'workbox' }

		await sendNotifyChannels(
			[
				{
					type: 'message-pusher',
					url: 'https://push.example.com',
					user: 'someone',
					token: 'token-placeholder',
				},
			],
			targetEvent,
		)

		expect(requests).toHaveLength(1)
		expect(requests[0]?.request.method).toBe('POST')
		expect(requests[0]?.request.url).toBe('https://push.example.com/push/someone')
		expect(requests[0]?.request.headers.get('content-type')).toBe('application/json')
		expect(JSON.parse(requests[0]?.body ?? '')).toEqual({
			title: 'Build finished',
			desp: 'All checks passed',
			content: '【完成】Build finished\n目标：workbox\nAll checks passed\n会话：dev\n原因：exit 0',
			token: 'token-placeholder',
		})
		expect(requests[0]?.body).not.toContain('description')
	})

	test('wecom sends plain text content', async () => {
		const requests = captureFetch()

		await sendNotifyChannels(
			[
				{
					type: 'wecom',
					url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-placeholder',
				},
			],
			event,
		)

		expect(requests[0]?.request.url).toBe(
			'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-placeholder',
		)
		expect(JSON.parse(requests[0]?.body ?? '')).toEqual({
			msgtype: 'text',
			text: { content: '【完成】Build finished\nAll checks passed\n会话：dev\n原因：exit 0' },
		})
	})

	test('webhook sends the event object and configured headers', async () => {
		const requests = captureFetch()

		await sendNotifyChannels(
			[
				{
					type: 'webhook',
					url: 'https://hooks.example.com/events',
					headers: { authorization: 'Bearer header-placeholder', 'x-source': 'herdweb' },
				},
			],
			event,
		)

		expect(requests[0]?.request.headers.get('authorization')).toBe('Bearer header-placeholder')
		expect(requests[0]?.request.headers.get('x-source')).toBe('herdweb')
		expect(JSON.parse(requests[0]?.body ?? '')).toEqual(event)
	})
})

describe('notify channel delivery isolation', () => {
	test.each([
		[
			'message-pusher',
			{ type: 'message-pusher', url: 'https://push.example.com', user: 'u', token: 't' },
		],
		['wecom', { type: 'wecom', url: 'https://wecom.example.com/hook' }],
		['webhook', { type: 'webhook', url: 'https://hook.example.com/events' }],
	] as const)('logs delivered and failed for %s without throwing', async (_name, channel) => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const fetchMock = vi.fn()
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 202 }))
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
		vi.stubGlobal('fetch', fetchMock)

		await expect(sendNotifyChannels([channel], event)).resolves.toBeUndefined()
		await expect(sendNotifyChannels([channel], event)).resolves.toBeUndefined()

		expect(logSpy.mock.calls.map(([message]) => String(message))).toEqual([
			expect.stringContaining('delivered'),
			expect.stringContaining('failed'),
		])
		expect(logSpy.mock.calls.every(([message]) => String(message).includes('example.com'))).toBe(
			true,
		)
		expect(logSpy.mock.calls.every(([message]) => !String(message).includes('https://'))).toBe(true)
	})

	test('isolates a failed channel from a successful channel', async () => {
		const requests = captureFetch()
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const request = new Request(input, init)
			requests.push({ request, body: await request.text() })
			return new Response(null, { status: request.url.includes('fail') ? 500 : 200 })
		})

		await expect(
			sendNotifyChannels(
				[
					{ type: 'webhook', url: 'https://fail.example.com/hook' },
					{ type: 'webhook', url: 'https://ok.example.com/hook' },
				],
				event,
			),
		).resolves.toBeUndefined()
		expect(requests).toHaveLength(2)
		expect(logSpy.mock.calls.map(([message]) => String(message))).toEqual([
			expect.stringContaining('failed'),
			expect.stringContaining('delivered'),
		])
	})

	test('logs only the safe host when a webhook URL contains a secret', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('request failed: ?key=secret-value')),
		)

		await expect(
			sendNotifyChannels(
				[
					{
						type: 'wecom',
						url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-value',
					},
				],
				event,
			),
		).resolves.toBeUndefined()

		const output = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')
		expect(output).toContain('qyapi.weixin.qq.com')
		expect(output).not.toContain('secret-value')
	})

	test('logs network error name without throwing', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const error = new TypeError('network failed')
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))

		await expect(
			sendNotifyChannels([{ type: 'webhook', url: 'https://hook.example.com/events' }], event),
		).resolves.toBeUndefined()
		expect(logSpy.mock.calls.flat().join(' ')).toContain('TypeError')
	})

	test('uses a 10 second timeout and logs timeout as a failed delivery', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const timeoutSpy = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(new AbortController().signal)
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))

		await expect(
			sendNotifyChannels([{ type: 'webhook', url: 'https://hook.example.com/events' }], event),
		).resolves.toBeUndefined()

		expect(timeoutSpy).toHaveBeenCalledWith(10_000)
		expect(logSpy.mock.calls.flat().join(' ')).toContain('TimeoutError')
	})
})

describe('notify service channel independence', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
	})

	test('sends channels when Web Push rejects', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-channel-isolation-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const requests = captureFetch()
		const sendPush = vi.fn().mockRejectedValue(new Error('push failed'))
		const service = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
			channels: [{ type: 'webhook', url: 'https://hook.example.com/events' }],
		})

		service.dispatchEvent(event)
		await service.awaitInFlight(1000)

		expect(sendPush).toHaveBeenCalled()
		expect(requests).toHaveLength(1)
		service.dispose()
	})

	test('sends Web Push when a channel rejects', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-channel-isolation-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('channel failed')))
		const service = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
			channels: [{ type: 'webhook', url: 'https://hook.example.com/events' }],
		})

		service.dispatchEvent(event)
		await service.awaitInFlight(1000)

		expect(sendPush).toHaveBeenCalled()
		service.dispose()
	})

	test('does not fetch when no channels are configured', async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const service = createNotifyService({
			stateDir: mkdtempSync(join(tmpdir(), 'herdweb-notify-no-channels-')),
			historyLimit: 200,
		})

		service.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, kind: 'test', title: 'T', ts: 1 })),
		)
		await service.awaitInFlight(1000)

		expect(fetchMock).not.toHaveBeenCalled()
		service.dispose()
	})
})
