import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseNotifyEvent } from '../src/notify/events'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService } from '../src/notify/service'

function countActiveTimeouts(): number {
	return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
}

describe('notify service awaitInFlight drain', () => {
	let stateDir: string

	afterEach(() => {
		rmSync(stateDir, { recursive: true, force: true })
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test('clears race loser timer when in-flight promises settle early', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])

		let resolvePush: (() => void) | undefined
		const sendPush = vi.fn().mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolvePush = resolve
				}),
		)
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
		})

		const event = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'drain-1', kind: 'done', title: 'T', ts: 1 }),
		)
		notifyService.dispatchEvent(event)

		const baselineTimeouts = countActiveTimeouts()
		const drainPromise = notifyService.awaitInFlight(60_000)
		resolvePush?.()
		await drainPromise

		expect(countActiveTimeouts()).toBe(baselineTimeouts)
		notifyService.dispose()
	})

	test('rejects when in-flight promises never settle', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/hang',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])

		const sendPush = vi.fn().mockImplementation(() => new Promise<void>(() => {}))
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
		})

		const event = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'drain-2', kind: 'done', title: 'T', ts: 1 }),
		)
		notifyService.dispatchEvent(event)

		const started = Date.now()
		await expect(notifyService.awaitInFlight(50)).rejects.toThrow('timed out')
		const elapsed = Date.now() - started
		expect(elapsed).toBeGreaterThanOrEqual(40)
		expect(elapsed).toBeLessThan(500)
		notifyService.dispose()
	})

	test('waits for in-flight channel delivery before returning', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		let resolveFetch!: (response: Response) => void
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						resolveFetch = resolve
					}),
			),
		)
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			channels: [{ type: 'webhook', url: 'https://hook.example.com/events' }],
		})

		const event = parseNotifyEvent(
			JSON.stringify({ v: 1, id: 'drain-channel', kind: 'done', title: 'T', ts: 1 }),
		)
		notifyService.dispatchEvent(event)

		let drained = false
		const drainPromise = notifyService.awaitInFlight(1000).then(() => {
			drained = true
		})
		await Promise.resolve()
		expect(drained).toBe(false)
		resolveFetch(new Response(null, { status: 204 }))
		await drainPromise
		expect(drained).toBe(true)
		notifyService.dispose()
	})

	test('awaitInFlight flushes a pending unlabeled done before waiting', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
		})
		notifyService.dispatchEvent(
			parseNotifyEvent(
				JSON.stringify({ v: 1, id: 'drain-flush', kind: 'done', title: 'T', ts: 1 }),
			),
		)
		expect(sendPush).not.toHaveBeenCalled()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'drain-flush' })
		notifyService.dispose()
	})

	test('dispose flushes the last pending unlabeled done', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const notifyService = createNotifyService({
			stateDir,
			historyLimit: 200,
			sendPush,
		})
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'first', kind: 'done', title: 'T', ts: 1 })),
		)
		notifyService.dispatchEvent(
			parseNotifyEvent(JSON.stringify({ v: 1, id: 'last', kind: 'done', title: 'T', ts: 2 })),
		)
		expect(sendPush).not.toHaveBeenCalled()
		notifyService.dispose()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'last' })
	})
})

describe('presence defer drain', () => {
	let stateDir: string

	afterEach(() => {
		rmSync(stateDir, { recursive: true, force: true })
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	function createHarness() {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockResolvedValue(undefined)
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		return { sendPush, notifyService }
	}

	test('awaitInFlight flushes a pending presence-deferred event before waiting', async () => {
		const { sendPush, notifyService } = createHarness()
		notifyService.dispatchEvent(
			parseNotifyEvent(
				JSON.stringify({
					v: 1,
					id: 'defer-drain',
					kind: 'asking',
					title: 'T',
					ts: 1,
					presence: 'likely-present',
				}),
			),
		)
		expect(sendPush).not.toHaveBeenCalled()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'defer-drain' })
		notifyService.dispose()
	})

	test('dispose flushes a pending presence-deferred event', async () => {
		const { sendPush, notifyService } = createHarness()
		notifyService.dispatchEvent(
			parseNotifyEvent(
				JSON.stringify({
					v: 1,
					id: 'defer-dispose',
					kind: 'asking',
					title: 'T',
					ts: 1,
					presence: 'likely-present',
				}),
			),
		)
		expect(sendPush).not.toHaveBeenCalled()
		notifyService.dispose()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(sendPush.mock.calls[0]?.[1]))).toMatchObject({
			id: 'defer-dispose',
		})
	})

	test('dispose flushes a deferred unlabeled done through both queues', async () => {
		const { sendPush, notifyService } = createHarness()
		notifyService.dispatchEvent(
			parseNotifyEvent(
				JSON.stringify({
					v: 1,
					id: 'defer-done',
					kind: 'done',
					title: 'T',
					ts: 1,
					presence: 'likely-present',
				}),
			),
		)
		expect(sendPush).not.toHaveBeenCalled()
		notifyService.dispose()
		await notifyService.awaitInFlight(1000)
		expect(sendPush).toHaveBeenCalledTimes(1)
		expect(JSON.parse(String(sendPush.mock.calls[0]?.[1]))).toMatchObject({ id: 'defer-done' })
	})
})
