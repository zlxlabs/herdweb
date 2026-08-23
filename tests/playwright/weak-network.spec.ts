import { join } from 'node:path'
import { expect, test } from './fixtures'

async function installSocketProbe(page: import('@playwright/test').Page): Promise<void> {
	await page.addInitScript(() => {
		const browserWindow = window as typeof window & {
			__herdwebSentFrames?: string[]
			__herdwebPendingAtActionSend?: (string | null)[]
			__herdwebBufferedSamples?: number[]
			__herdwebSocketConstructs?: number
		}
		browserWindow.__herdwebSentFrames = []
		browserWindow.__herdwebPendingAtActionSend = []
		browserWindow.__herdwebBufferedSamples = []
		browserWindow.__herdwebSocketConstructs = 0
		const NativeWebSocket = window.WebSocket
		const NativeSend = NativeWebSocket.prototype.send
		NativeWebSocket.prototype.send = function (
			data: string | ArrayBufferLike | Blob | ArrayBufferView,
		) {
			const before = this.bufferedAmount
			if (typeof data === 'string') {
				browserWindow.__herdwebSentFrames?.push(data)
				if (JSON.parse(data).type === 'input-action') {
					browserWindow.__herdwebPendingAtActionSend?.push(
						localStorage.getItem('herdweb:composer:v1:/'),
					)
				}
			}
			const result = NativeSend.call(this, data)
			browserWindow.__herdwebBufferedSamples?.push(before, this.bufferedAmount)
			return result
		}
		// biome-ignore lint/complexity/useArrowFunction: WebSocket replacement must remain constructable
		const TrackedWebSocket = function (...args: ConstructorParameters<typeof WebSocket>) {
			browserWindow.__herdwebSocketConstructs = (browserWindow.__herdwebSocketConstructs ?? 0) + 1
			return new NativeWebSocket(...args)
		} as unknown as typeof WebSocket
		Object.setPrototypeOf(TrackedWebSocket, NativeWebSocket)
		TrackedWebSocket.prototype = NativeWebSocket.prototype
		window.WebSocket = TrackedWebSocket
	})
}

async function getActionFrames(page: import('@playwright/test').Page): Promise<string[]> {
	return (await getSentFrames(page)).filter((frame) => JSON.parse(frame).type === 'input-action')
}

async function getPendingAtActionSend(
	page: import('@playwright/test').Page,
): Promise<(string | null)[]> {
	return page.evaluate(
		() =>
			(window as typeof window & { __herdwebPendingAtActionSend?: (string | null)[] })
				.__herdwebPendingAtActionSend ?? [],
	)
}

async function getSentFrames(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __herdwebSentFrames?: string[] }
		return browserWindow.__herdwebSentFrames ?? []
	})
}

async function getNonPingFrames(page: import('@playwright/test').Page): Promise<string[]> {
	return (await getSentFrames(page)).filter((frame) => JSON.parse(frame).type !== 'ping')
}

async function getBufferedSamples(page: import('@playwright/test').Page): Promise<number[]> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __herdwebBufferedSamples?: number[] }
		return browserWindow.__herdwebBufferedSamples ?? []
	})
}

async function getSocketConstructs(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __herdwebSocketConstructs?: number }
		return browserWindow.__herdwebSocketConstructs ?? 0
	})
}

async function waitForState(page: import('@playwright/test').Page, state: string): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state), {
			timeout: 15_000,
		})
		.toBe(state)
}

async function waitForSynced(page: import('@playwright/test').Page): Promise<void> {
	await waitForState(page, 'synced')
}

test('plain page load constructs exactly one terminal WebSocket', async ({ page }) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)
	await expect.poll(() => getSocketConstructs(page)).toBe(1)
})

test('offline keyboard input is dropped and recovery requires a fresh synced snapshot', async ({
	page,
	context,
}) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	await context.setOffline(true)
	await page.evaluate(() => window.__herdwebSockets?.[0]?.close())
	await waitForState(page, 'disconnected')
	await page.screenshot({ path: 'test-results/weak-network-disconnected.png' })
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const offlineInput = `offline-input-${Date.now()}`
	await page.keyboard.type(offlineInput)
	await page.keyboard.press('Enter')

	await context.setOffline(false)
	await waitForSynced(page)
	await expect(page.locator('body')).not.toContainText(offlineInput)
	await page.screenshot({ path: 'test-results/weak-network-synced.png' })
})

test('offline and online recovery converges to the server snapshot', async ({ page, context }) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	const marker = `fresh-snapshot-${Date.now()}`
	await page.evaluate((value) => window.term?.input(`printf "${value}\\n"\r`, true), marker)
	await expect(page.locator('body')).toContainText(marker)
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const keyboardMarker = `normal-keyboard-${Date.now()}`
	await page.keyboard.type(`printf "${keyboardMarker}\\n"`)
	await page.keyboard.press('Enter')
	await expect(page.locator('body')).toContainText(keyboardMarker)
	const bufferedSamples = await getBufferedSamples(page)
	expect(bufferedSamples.length).toBeGreaterThan(0)
	console.log(`normal-network bufferedAmount samples: ${JSON.stringify(bufferedSamples)}`)
	await page.waitForTimeout(250)
	const bufferedAtRest = await page.evaluate(
		() => window.__herdwebSockets?.[0]?.bufferedAmount ?? -1,
	)
	console.log(`normal-network bufferedAmount after 250ms: ${bufferedAtRest}`)
	expect(bufferedAtRest).toBe(0)

	await context.setOffline(true)
	await page.evaluate(() => window.__herdwebSockets?.[0]?.close())
	await waitForState(page, 'disconnected')
	await page.screenshot({ path: 'test-results/weak-network-disconnected.png' })
	await context.setOffline(false)
	await page.screenshot({ path: 'test-results/weak-network-syncing.png' })
	await waitForSynced(page)
	await expect(page.locator('body')).toContainText(marker)
})

test('offline event invalidates an OPEN socket before keyboard input is sent', async ({
	page,
	context,
}) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)
	let sentBefore: string[] | undefined
	let previousFrames: string[] | undefined
	await expect
		.poll(async () => {
			const currentFrames = await getNonPingFrames(page)
			const stable =
				previousFrames !== undefined &&
				JSON.stringify(currentFrames) === JSON.stringify(previousFrames)
			previousFrames = currentFrames
			if (stable) sentBefore = currentFrames
			return stable
		})
		.toBe(true)

	await context.setOffline(true)
	await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
	await waitForState(page, 'disconnected')
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const marker = `offline-open-${Date.now()}`
	await page.keyboard.type(marker)
	await page.keyboard.press('Enter')
	const sentAfter = await getNonPingFrames(page)
	expect(sentBefore).toBeDefined()
	expect(sentAfter).toEqual(sentBefore)

	await context.setOffline(false)
	await waitForSynced(page)
	await expect(page.locator('body')).not.toContainText(marker)
})

test('freeze and resume events force a fresh epoch and snapshot', async ({ page }) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)
	const socketCountBefore = await getSocketConstructs(page)
	// Page.setWebLifecycleState does not reliably dispatch DOM lifecycle events in this Chromium build.
	await page.evaluate(() => document.dispatchEvent(new Event('freeze')))
	await waitForState(page, 'disconnected')
	await page.evaluate(() => document.dispatchEvent(new Event('resume')))

	// Do not assert the transient reconnecting/syncing state here: against a local
	// server the whole reconnect finishes in tens of milliseconds, so polling for
	// the intermediate state is a race that Chromium happens to win and WebKit
	// loses. The invariant (resume must go through a fresh epoch and a complete
	// snapshot) is already pinned by the surrounding assertions: waitForState
	// above proves we left synced, a new socket construct proves a fresh epoch,
	// and applySnapshot is the only path back into synced.
	await expect
		.poll(() => getSocketConstructs(page), { timeout: 15_000 })
		.toBeGreaterThan(socketCountBefore)
	await waitForSynced(page)
})

test.describe('composer action weak network', () => {
	const repoRoot = join(import.meta.dirname, '../..')
	const configPath = join(repoRoot, 'tests/playwright/asr.config.ts')
	test.use({ serveOptions: { configPath } })

	test('lost accepted retries the same action once and writes PTY once', async ({
		page,
		context,
		serve,
	}) => {
		let dropped = false
		await page.routeWebSocket(`${serve.url.replace('http', 'ws')}/ws`, (socket) => {
			const upstream = socket.connectToServer()
			upstream.onMessage((message) => {
				const parsed = typeof message === 'string' ? JSON.parse(message) : null
				if (parsed?.type === 'input-accepted' && !dropped) {
					dropped = true
					return
				}
				socket.send(message)
			})
		})
		await installSocketProbe(page)
		await page.goto(serve.url)
		await waitForSynced(page)
		await page.locator('[data-herdweb-action="voice-input"]').click()
		const marker = `T4-${Date.now()}`
		const escaped = [...marker]
			.map((character) => `\\x${(character.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}`)
			.join('')
		const composer = page.locator('#wt-asr-composer')
		await composer.locator('textarea').fill(`printf '${escaped}\\n'`)
		await composer.locator('.wt-composer-send').click()
		await expect.poll(() => getActionFrames(page)).toHaveLength(1)
		expect(JSON.parse((await getPendingAtActionSend(page))[0] ?? '{}').pending).toMatchObject({
			data: `printf '${escaped}\\n'\r`,
			status: 'pending',
		})
		await page.screenshot({ path: 'test-results/composer-pending.png' })
		await context.setOffline(true)
		await waitForState(page, 'disconnected')
		await page.waitForTimeout(15_000)
		await page.screenshot({ path: 'test-results/composer-unknown.png' })
		await context.setOffline(false)
		await waitForSynced(page)
		await expect.poll(() => getActionFrames(page), { timeout: 15_000 }).toHaveLength(2)
		await expect(page.locator('#terminal .xterm-rows')).toContainText(marker, { timeout: 5_000 })
		const terminalText = (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
		expect(terminalText.split(marker).length - 1).toBe(1)
		await expect(composer.locator('textarea')).toHaveValue('')
		await page.screenshot({ path: 'test-results/composer-accepted.png' })
	})

	test('offline before send keeps draft and emits no action frame', async ({
		page,
		context,
		serve,
	}) => {
		await installSocketProbe(page)
		await page.goto(serve.url)
		await waitForSynced(page)
		await page.locator('[data-herdweb-action="voice-input"]').click()
		const composer = page.locator('#wt-asr-composer')
		await composer.locator('textarea').fill("printf 'offline'")
		await context.setOffline(true)
		await waitForState(page, 'disconnected')
		await composer.locator('.wt-composer-send').click()
		await expect(composer.locator('textarea')).toHaveValue("printf 'offline'")
		await expect(composer.locator('.wt-asr-composer-message')).toHaveText(
			'Not sent — still syncing.',
		)
		expect(await getActionFrames(page)).toEqual([])
		await context.setOffline(false)
		await waitForSynced(page)
	})
})
