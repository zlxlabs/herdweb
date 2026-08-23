import { join } from 'node:path'
import { expect, test } from './fixtures'
import asrConfig from './asr.config'

declare global {
	interface Window {
		__voiceConnectionStates?: boolean[]
	}
}

const repoRoot = join(import.meta.dirname, '../..')
const configPath = join(repoRoot, 'tests/playwright/asr.config.ts')
test.use({ serveOptions: { configPath } })
const voiceButton = asrConfig.toolbar.row1.at(0)
if (!voiceButton) throw new Error('ASR e2e config must define a voice-input toolbar button')

function serverFrame(flags: 0 | 1 | 3, text: string, sequence = 1): Buffer {
	const payload = Buffer.from(JSON.stringify({ result: { text } }), 'utf8')
	const sequenceBytes = flags === 1 || flags === 3 ? 4 : 0
	const result = Buffer.alloc(8 + sequenceBytes + payload.byteLength)
	result.set([0x11, 0x90 | flags, 0x10, 0], 0)
	if (sequenceBytes > 0) result.writeInt32BE(sequence, 4)
	result.writeUInt32BE(payload.byteLength, 4 + sequenceBytes)
	payload.copy(result, 8 + sequenceBytes)
	return result
}

function frameType(message: string | Buffer): { readonly type: number; readonly flags: number } {
	const bytes = typeof message === 'string' ? Buffer.from(message, 'binary') : message
	return { type: (bytes[1] ?? 0) >> 4, flags: (bytes[1] ?? 0) & 0x0f }
}

test.describe('Voice composer tap-to-toggle input', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'full voice flow is chromium-only')

	test('fake microphone → mock partial/final → PTY receives sanitized command bytes', async ({
		page,
		serve,
	}) => {
		const partial = serverFrame(0, 'partial')
		const asrFrames: Buffer[] = []
		const frameCounts = { fullRequest: 0, audio: 0, end: 0 }
		let currentText = ''
		await page.routeWebSocket('wss://openspeech.bytedance.com/**', (socket) => {
			let partialSent = false
			const final = (): Buffer => serverFrame(3, currentText, 1)
			socket.onMessage((message) => {
				if (typeof message === 'string') return
				const buffer = Buffer.isBuffer(message) ? message : Buffer.from(message)
				asrFrames.push(buffer)
				const frame = frameType(buffer)
				if (frame.type === 1) frameCounts.fullRequest++
				if (frame.type !== 2) return
				frameCounts.audio++
				if (frame.flags === 2 || frame.flags === 3) {
					frameCounts.end++
					socket.send(final())
				} else if (!partialSent) {
					partialSent = true
					socket.send(partial)
				}
			})
		})

		for (let attempt = 0; attempt < 5; attempt++) {
			currentText = `printf '\\x4f\\x55\\x54\\x50\\x55\\x54-${attempt}\\n'`
			const outputMarker = `OUTPUT-${attempt}`
			expect(currentText).not.toContain(outputMarker)
			await page.goto(serve.url)
			await page.waitForSelector('#wt-toolbar [data-herdweb-action="voice-input"]')
			const entry = page.locator('[data-herdweb-action="voice-input"]')
			await expect(entry).toBeVisible()
			await expect(entry).toHaveAttribute('aria-label', 'Voice composer')
			await expect(entry).toHaveCSS('width', '44px')
			await expect(entry).toHaveCSS('height', '44px')
			await expect(entry).not.toHaveAttribute('data-mic-state', 'recording')
			if (attempt === 0) await page.screenshot({ path: 'test-results/voice-entry-idle.png' })

			await entry.click()
			const composer = page.locator('#wt-asr-composer')
			await expect(composer).toBeVisible()
			await expect(composer.locator('textarea')).toHaveAttribute('placeholder', 'Speak or type…')
			await expect(composer.locator('textarea')).not.toBeFocused()
			await expect(page.locator('#terminal .xterm-rows')).toBeVisible()
			await expect(page.locator('#wt-toolbar')).toBeHidden()
			await expect(page.locator('body')).toHaveClass(/wt-composer-open/)
			const composerBox = await composer.boundingBox()
			if (!composerBox) throw new Error('voice composer must have a visible bounding box')
			expect(composerBox.y).toBeGreaterThan((await page.evaluate(() => window.innerHeight)) / 2)
			const composerStyle = await composer.evaluate((element) => {
				const style = getComputedStyle(element)
				return { top: style.top, backgroundColor: style.backgroundColor }
			})
			expect(Number.parseFloat(composerStyle.top)).toBeGreaterThan(0)
			expect(composerStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0.58)')
			await expect(composer.locator('[data-herdweb-control="composer-mic"]')).toHaveAttribute(
				'data-mic-state',
				'idle',
			)
			if (attempt === 0) await page.screenshot({ path: 'test-results/voice-composer-idle.png' })

			const mic = composer.locator('[data-herdweb-control="composer-mic"]')
			await mic.click()
			await page.waitForTimeout(450)
			await expect(mic).toHaveAttribute('data-mic-state', 'recording')
			await expect(composer.locator('textarea')).toHaveAttribute('readonly', '')
			if (attempt === 0) await page.screenshot({ path: 'test-results/voice-recording.png' })

			await mic.click()
			await expect(composer).toBeVisible({ timeout: 5_000 })
			await expect(composer.locator('textarea')).toHaveValue(currentText, {
				timeout: 5_000,
			})
			await expect(composer.locator('textarea')).not.toHaveAttribute('readonly', '')
			if (attempt === 0) await page.screenshot({ path: 'test-results/voice-preview.png' })

			await composer.locator('.wt-composer-send').click()
			await expect(page.locator('#terminal .xterm-rows')).toContainText(outputMarker, {
				timeout: 5_000,
			})
			await expect(composer).toBeVisible()
			await expect(composer.locator('textarea')).toHaveValue('')
			await expect(page.locator('body')).toHaveClass(/wt-composer-open/)
			await expect(page.locator('#wt-toolbar')).toBeHidden()
		}
		expect(asrFrames.some((frame) => ((frame[1] ?? 0) & 0x0f) === 3)).toBe(true)
		expect(frameCounts.fullRequest).toBeGreaterThanOrEqual(5)
		expect(frameCounts.audio).toBeGreaterThan(0)
		expect(frameCounts.end).toBeGreaterThanOrEqual(5)
	})

	test('long drafts wrap, Enter stays in textarea, and Send keeps composer open', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url)
		const entry = page.locator('[data-herdweb-action="voice-input"]')
		await entry.click()
		const composer = page.locator('#wt-asr-composer')
		const textarea = composer.locator('textarea')
		const longText = 'x'.repeat(220)
		await textarea.fill(longText)
		const metrics = await textarea.evaluate((element) => ({
			clientHeight: element.clientHeight,
			clientWidth: element.clientWidth,
			scrollHeight: element.scrollHeight,
			scrollWidth: element.scrollWidth,
		}))
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
		expect(metrics.clientHeight).toBeGreaterThan(48)
		expect(metrics.scrollHeight).toBeGreaterThan(48)
		await page.screenshot({ path: 'test-results/voice-composer-long-text.png' })

		await textarea.press('Enter')
		await expect(textarea).toHaveValue(`${longText}\n`)
		await expect(composer).toBeVisible()
		await composer.locator('.wt-composer-send').click()
		await expect(textarea).toHaveValue('')
		await expect(composer).toBeVisible()
	})

	test('connection observer replays a disconnected state to late subscribers', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm')
		await expect.poll(() => page.evaluate(() => window.__herdwebSockets?.[0]?.readyState)).toBe(1)
		await page.evaluate(() => window.__herdwebSockets?.[0]?.close())
		await expect
			.poll(() => page.evaluate(() => window.__herdwebSockets?.[0]?.readyState), { timeout: 5_000 })
			.toBe(3)
		await page.evaluate(() => {
			window.__voiceConnectionStates = []
			window.term?.onConnectionChange((connected) => {
				window.__voiceConnectionStates?.push(connected)
			})
		})
		await expect.poll(() => page.evaluate(() => window.__voiceConnectionStates)).toEqual([false])
	})

	test('socket error followed by close emits one disconnected transition', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm')
		await expect.poll(() => page.evaluate(() => window.__herdwebSockets?.[0]?.readyState)).toBe(1)
		await page.evaluate(() => {
			window.__voiceConnectionStates = []
			window.term?.onConnectionChange((connected) => {
				window.__voiceConnectionStates?.push(connected)
			})
			const socket = window.__herdwebSockets?.[0]
			socket?.close()
			socket?.dispatchEvent(new Event('error'))
		})
		await expect
			.poll(
				() => page.evaluate(() => window.__voiceConnectionStates?.filter((state) => !state).length),
				{ timeout: 5_000 },
			)
			.toBe(1)
	})
})

test.describe('Mic tap-to-toggle capability degradation', () => {
	test('webkit hides voice input when getUserMedia is unavailable', async ({
		page,
		browserName,
		serve,
	}) => {
		test.skip(browserName !== 'webkit', 'capability degradation is webkit-only')
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
		})
		await page.goto(serve.url)
		await page.waitForSelector('#wt-toolbar')
		await expect(page.locator('[data-herdweb-action="voice-input"]')).toHaveCount(0)
	})
})
