import { afterEach, describe, expect, test } from 'vitest'
import { SharedTerminalSession } from '../src/session'

describe('SharedTerminalSession activity tracking', () => {
	let session: SharedTerminalSession | undefined

	afterEach(async () => {
		if (session) {
			await session.dispose()
			session = undefined
		}
	})

	test('bytesInWindow sums trailing PTY output within window', async () => {
		session = new SharedTerminalSession(['bash', '-c', 'printf "%1500s" "" | tr " " "x"; sleep 60'])
		const deadline = Date.now() + 3000
		while (Date.now() < deadline && session.bytesInWindow(30_000) < 1024) {
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		expect(session.bytesInWindow(30_000)).toBeGreaterThanOrEqual(1024)
	})

	test('bytesInWindow returns zero outside activity window', async () => {
		session = new SharedTerminalSession(['bash', '-c', 'printf x; sleep 60'])
		const deadline = Date.now() + 3000
		while (Date.now() < deadline && session.bytesInWindow(30_000) === 0) {
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		expect(session.bytesInWindow(30_000)).toBeGreaterThan(0)
		const futureNow = Date.now() + 120_000
		expect(session.bytesInWindow(30_000, futureNow)).toBe(0)
	})

	test('lastOutputAt returns undefined when no output', () => {
		session = new SharedTerminalSession(['sleep', '60'])
		expect(session.lastOutputAt()).toBeUndefined()
	})

	test('lastOutputAt reflects recent output', async () => {
		session = new SharedTerminalSession(['bash', '-c', 'printf hi; sleep 60'])
		const deadline = Date.now() + 3000
		while (Date.now() < deadline && session.lastOutputAt() === undefined) {
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		expect(session.lastOutputAt()).toBeDefined()
	})

	test('exposes stable id and startTime', () => {
		session = new SharedTerminalSession(['sleep', '60'])
		expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
		expect(session.startTime).toBeLessThanOrEqual(Date.now())
		expect(session.startTime).toBeGreaterThan(0)
	})
})
