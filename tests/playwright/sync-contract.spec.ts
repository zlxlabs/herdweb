import type { Page } from '@playwright/test'
import { expect, openTerminal, test } from './fixtures'

type ProbeWindow = typeof window & { __syncContractSentFrames?: string[] }

/**
 * Counterexample pinning the openTerminal sync contract: the entry may only
 * return once the server's attach-committed has landed. The proxy below holds
 * that exact server message with deterministic scheduling (no random sleeps),
 * so while held the client can never reach `synced`.
 */
async function installSendProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const browserWindow = window as ProbeWindow
		browserWindow.__syncContractSentFrames = []
		const nativeSend = window.WebSocket.prototype.send
		window.WebSocket.prototype.send = function (
			data: string | ArrayBufferLike | Blob | ArrayBufferView,
		) {
			if (typeof data === 'string') browserWindow.__syncContractSentFrames?.push(data)
			return nativeSend.call(this, data)
		}
	})
}

async function sentInputFrames(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		((window as ProbeWindow).__syncContractSentFrames ?? []).filter(
			(frame) => JSON.parse(frame).type === 'input',
		),
	)
}

test('openTerminal returns only after attach-committed; held input is dropped', async ({
	page,
	serve,
}) => {
	let releaseHold!: () => void
	let released = false
	const releasedGate = new Promise<void>((resolve) => {
		releaseHold = () => {
			released = true
			resolve()
		}
	})
	const heldFrames: string[] = []
	await page.routeWebSocket(`${serve.url.replace('http', 'ws')}/ws`, (socket) => {
		const upstream = socket.connectToServer()
		socket.onMessage((message) => upstream.send(message))
		upstream.onMessage((message) => {
			// Hold only pre-release commits: after release every frame flows
			// through, so reconnects (if any) sync normally.
			if (
				!released &&
				typeof message === 'string' &&
				JSON.parse(message).type === 'attach-committed'
			) {
				heldFrames.push(message)
				return
			}
			socket.send(message)
		})
		void releasedGate.then(() => {
			for (const frame of heldFrames.splice(0)) socket.send(frame)
		})
	})
	await installSendProbe(page)

	let resolved = false
	let failed = false
	const ready = openTerminal(page, serve.url).then(
		() => {
			resolved = true
		},
		() => {
			failed = true
		},
	)

	// Hold-active proof: the proxy captured the real attach-committed (it only
	// exists after the client applied the snapshot, so the terminal DOM is up).
	// With the commit withheld, `synced` is impossible — a single check suffices.
	await expect.poll(() => heldFrames.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
	expect(await page.evaluate(() => window.term?.getConnectionStatus().state ?? 'absent')).not.toBe(
		'synced',
	)

	expect(resolved).toBe(false)
	expect(failed).toBe(false)

	// Input typed while held must be dropped synchronously (never sent as an
	// input frame — the client-side rule weak-network.spec.ts pins) and must
	// never reach the PTY.
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const heldMarker = `held-drop-${Date.now()}`
	await page.keyboard.type(`printf "${heldMarker}\\n"`)
	await page.keyboard.press('Enter')
	expect(await sentInputFrames(page)).toEqual([])
	await expect(page.locator('body')).not.toContainText(heldMarker)

	expect(resolved).toBe(false)
	releaseHold()

	// Release → the buffered attach-committed lands → the entry must resolve.
	await ready
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state))
		.toBe('synced')

	const releasedMarker = `after-release-${Date.now()}`
	await page.evaluate((value) => window.term?.input(`printf "${value}\\n"\r`, true), releasedMarker)
	await expect(page.locator('body')).toContainText(releasedMarker)
	// The held-phase command never executed — dropping is the product contract.
	await expect(page.locator('body')).not.toContainText(heldMarker)
})
