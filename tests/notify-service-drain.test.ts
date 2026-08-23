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
	})

	test('clears race loser timer when in-flight promises settle early', async () => {
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

	test('returns within timeoutMs when in-flight promises never settle', async () => {
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
		await notifyService.awaitInFlight(50)
		const elapsed = Date.now() - started

		expect(elapsed).toBeGreaterThanOrEqual(40)
		expect(elapsed).toBeLessThan(500)
		notifyService.dispose()
	})
})
