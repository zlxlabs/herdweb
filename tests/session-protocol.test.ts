import { describe, expect, test } from 'vitest'
import {
	MAX_CLIENT_INPUT_BYTES,
	MAX_PROTOCOL_ID_BYTES,
	MAX_RESIZE_COLS,
	MAX_RESIZE_ROWS,
	parseClientMessage,
	parseServerMessage,
	serialiseClientMessage,
	serialiseServerMessage,
} from '../src/session-protocol'
const target = {
	id: 'local',
	name: 'Local 😀',
	processState: 'process-exited' as const,
	lastActivityAt: 123,
	exit: { code: 0, signal: null },
	failure: 'target-process-exited' as const,
	capabilities: { imageDrop: 'local-path' as const },
}
const request = { requestId: 'request-1', targetId: 'local' }
const attachment = { ...request, attachmentId: 'attachment-1' }
const parseJson = (value: object) => parseServerMessage(JSON.stringify(value))
const expectParsed = (value: object, expected: object = value) =>
	expect(parseJson(value)).toEqual(expected)
const expectInvalid = (value: object) => expect(parseJson(value)).toBeNull()

describe('session protocol', () => {
	test('round-trips input messages', () => {
		const message = { type: 'input' as const, data: 'ls\r' }
		expect(parseClientMessage(serialiseClientMessage(message))).toEqual(message)
	})

	test('round-trips input-action messages and validates UTF-8 ID size', () => {
		const message = { type: 'input-action' as const, id: 'action-1', data: 'echo hello\r' }
		expect(parseClientMessage(serialiseClientMessage(message))).toEqual(message)

		const maxSizedId = '😀'.repeat(MAX_PROTOCOL_ID_BYTES / 4)
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: maxSizedId }))).toEqual({
			type: 'ping',
			id: maxSizedId,
		})
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: `${maxSizedId}😀` }))).toBeNull()
		expect(
			parseClientMessage(JSON.stringify({ type: 'input-action', id: '', data: 'x' })),
		).toBeNull()
	})

	test('requires ping IDs', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toBeNull()
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: 123 }))).toBeNull()
	})

	test('rejects malformed resize messages', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: 0 }))).toBeNull()
		expect(parseClientMessage('{"type":"resize","cols":"80","rows":24}')).toBeNull()
	})

	test('rejects oversized input messages', () => {
		const oversized = 'x'.repeat(MAX_CLIENT_INPUT_BYTES + 1)
		expect(parseClientMessage(JSON.stringify({ type: 'input', data: oversized }))).toBeNull()
	})

	test('rejects oversized resize messages', () => {
		expect(
			parseClientMessage(JSON.stringify({ type: 'resize', cols: MAX_RESIZE_COLS + 1, rows: 24 })),
		).toBeNull()
		expect(
			parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: MAX_RESIZE_ROWS + 1 })),
		).toBeNull()
	})

	test('round-trips snapshot messages', () => {
		const message = {
			type: 'snapshot' as const,
			data: '\u001b[2Jhello',
			sessionId: 'session-1',
			outputWatermark: 3,
		}
		expect(parseServerMessage(serialiseServerMessage(message))).toEqual(message)
	})

	test('round-trips sequenced output and action responses', () => {
		const messages = [
			{ type: 'output' as const, data: 'hello', seq: 4 },
			{ type: 'pong' as const, id: 'ping-1' },
			{ type: 'input-accepted' as const, id: 'action-1' },
			{ type: 'input-rejected' as const, id: 'action-2', reason: 'id-conflict' as const },
		]

		for (const message of messages) {
			expect(parseServerMessage(serialiseServerMessage(message))).toEqual(message)
		}
	})

	test('rejects malformed new server message fields', () => {
		expect(parseServerMessage(JSON.stringify({ type: 'snapshot', data: 'x' }))).toBeNull()
		expect(
			parseServerMessage(
				JSON.stringify({ type: 'snapshot', data: 'x', sessionId: 's', outputWatermark: -1 }),
			),
		).toBeNull()
		expect(parseServerMessage(JSON.stringify({ type: 'output', data: 'x', seq: 0 }))).toBeNull()
		expect(parseServerMessage(JSON.stringify({ type: 'pong' }))).toBeNull()
		expect(
			parseServerMessage(
				JSON.stringify({ type: 'input-rejected', id: 'a', reason: 'pty-write-failed' }),
			),
		).toBeNull()
	})

	test('rejects unknown server message types', () => {
		expect(parseServerMessage('{"type":"mystery"}')).toBeNull()
	})

	test('round-trips protocol 2 client controls and preserves exact attach JSON', () => {
		const messages = [
			{
				type: 'attach-target' as const,
				requestId: 'request-1',
				targetId: 'local',
				cols: 80,
				rows: 24,
			},
			{ type: 'restart-target' as const, requestId: 'request-2', targetId: 'local' },
			{ type: 'snapshot-applied' as const, requestId: 'request-1', attachmentId: 'attach-1' },
		] as const

		for (const message of messages) {
			expect(parseClientMessage(serialiseClientMessage(message))).toEqual(message)
		}
		expect(serialiseClientMessage(messages[0])).toBe(
			'{"type":"attach-target","requestId":"request-1","targetId":"local","cols":80,"rows":24}',
		)
		expect(parseClientMessage(JSON.stringify({ ...messages[0], ignored: true }))).toEqual(
			messages[0],
		)
	})

	test('parses and serialises protocol 2 target controls', () => {
		const ready = { type: 'server-ready', protocol: 2 } as const
		const targets = { type: 'targets' as const, targets: [target] }
		const eight = Array.from({ length: 8 }, (_, index) => ({ ...target, id: `target-${index}` }))
		const status = { type: 'target-status' as const, target }
		expectParsed({ ...ready, ignored: true }, ready)
		expectParsed(targets)
		expectParsed({ type: 'targets', targets: eight })
		expectParsed({ ...status, target: { ...target, ignored: true } }, status)
		expect(serialiseServerMessage(ready)).toBe('{"type":"server-ready","protocol":2}')
		expect(serialiseServerMessage(targets)).toBe(
			'{"type":"targets","targets":[{"id":"local","name":"Local 😀","processState":"process-exited","lastActivityAt":123,"exit":{"code":0,"signal":null},"failure":"target-process-exited","capabilities":{"imageDrop":"local-path"}}]}',
		)
	})

	test('round-trips protocol 2 attach controls and drops unknown fields', () => {
		const messages = [
			{ type: 'attach-started' as const, ...attachment },
			{ type: 'attach-committed' as const, ...attachment },
			{ type: 'snapshot-failed' as const, ...attachment, reason: 'timeout' as const },
			{ type: 'target-restarted' as const, targetId: 'local', sessionId: 'session-1' },
		] as const
		for (const message of messages)
			expect(parseServerMessage(serialiseServerMessage(message))).toEqual(message)
		expectParsed({ ...messages[0], ignored: true }, messages[0])

		for (const reason of [
			'unknown-target',
			'target-start-failed',
			'target-process-exited',
			'attach-superseded',
			'snapshot-failed',
			'protocol-violation',
		] as const)
			expectParsed({ type: 'attach-rejected', ...request, reason })
	})

	test('rejects malformed protocol 2 attach controls', () => {
		const invalid = [
			{ type: 'attach-started', ...request },
			{ type: 'attach-started', ...attachment, requestId: '' },
			{
				type: 'attach-started',
				...attachment,
				attachmentId: 'a'.repeat(MAX_PROTOCOL_ID_BYTES + 1),
			},
			{ type: 'target-restarted', targetId: 'local', sessionId: '😀'.repeat(17) },
			{ type: 'attach-rejected', ...request, targetId: 'Local', reason: 'unknown-target' },
			{ type: 'attach-rejected', ...request, reason: 'other' },
			{ type: 'snapshot-failed', ...attachment, reason: 'not-timeout' },
		]
		for (const message of invalid) expectInvalid(message)
	})

	test('rejects malformed protocol 2 server controls and summaries', () => {
		for (const protocol of [1, '2']) expectInvalid({ type: 'server-ready', protocol })
		const nine = Array.from({ length: 9 }, (_, index) => ({ ...target, id: `t${index}` }))
		for (const targets of ['nope', [], nine, [target, target]])
			expectInvalid({ type: 'targets', targets })
		const invalidSummaries = [
			{},
			{ ...target, id: 'Bad' },
			{ ...target, name: '' },
			{ ...target, name: '🙂'.repeat(81) },
			{ ...target, name: 'bad\u0000name' },
			{ ...target, processState: 'running' },
			{ ...target, failure: 'other' },
			{ ...target, capabilities: { imageDrop: 'other' } },
			{ ...target, lastActivityAt: -1 },
			{ ...target, exit: { code: 1.5, signal: 'TERM' } },
		]
		for (const summary of invalidSummaries)
			expectInvalid({ type: 'target-status', target: summary })
	})

	test('validates protocol 2 client control boundaries', () => {
		const id = 'a'.repeat(MAX_PROTOCOL_ID_BYTES)
		const emojiId = '😀'.repeat(MAX_PROTOCOL_ID_BYTES / 4)
		const attach = {
			type: 'attach-target',
			requestId: id,
			targetId: `a${'b'.repeat(63)}`,
			cols: 500,
			rows: 200,
		}
		expect(parseClientMessage(JSON.stringify(attach))).toEqual(attach)
		expect(
			parseClientMessage(
				JSON.stringify({ type: 'snapshot-applied', requestId: emojiId, attachmentId: emojiId }),
			),
		).not.toBeNull()

		const invalid = [
			'not json',
			JSON.stringify({ ...attach, requestId: '' }),
			JSON.stringify({ ...attach, requestId: `${id}a` }),
			JSON.stringify({ ...attach, targetId: 'Local' }),
			JSON.stringify({ ...attach, targetId: `a${'b'.repeat(64)}` }),
			JSON.stringify({ ...attach, cols: 0 }),
			JSON.stringify({ ...attach, rows: 1.5 }),
			JSON.stringify({ ...attach, cols: '80', rows: '24' }),
			JSON.stringify({
				type: 'snapshot-applied',
				requestId: 'request-1',
				attachmentId: '😀'.repeat(17),
			}),
		]
		for (const payload of invalid) expect(parseClientMessage(payload)).toBeNull()
	})
})
