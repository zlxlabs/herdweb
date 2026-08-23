/**
 * E2E for image drop: pick a PNG via the hidden file input → real HTTP POST to
 * /api/image-drop → bytes land 0600 in the serve process's isolated TMPDIR →
 * the path travels the real input-action into the PTY and shows at the bash
 * prompt, but is never followed by Enter (no execution, no new prompt).
 * Runs on both projects (Pixel 5 Chromium, iPhone 13 WebKit) × base paths (/ and /herdweb).
 */
import { readFileSync, statSync } from 'node:fs'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/** Minimal PNG the server accepts: magic bytes + payload — format is sniffed from magic bytes only. */
const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from('herdweb-image-drop-e2e-payload'),
])

/** Raw xterm rows; rows are padded with spaces, so callers usually normalise whitespace. */
async function terminalText(page: Page): Promise<string> {
	return (await page.locator('#terminal .xterm-rows').textContent()) ?? ''
}

/** Whitespace-insensitive terminal text — a long path wraps across padded xterm rows. */
async function terminalTextFlat(page: Page): Promise<string> {
	return (await terminalText(page)).replace(/\s+/g, '')
}

for (const basePath of [undefined, '/herdweb'] as const) {
	const label = basePath ?? '/'

	test.describe(`image drop base path ${label}`, () => {
		test.use({ serveOptions: { basePath, isolateTmpDir: true } })

		test(`image drop inserts path into PTY without Enter`, async ({ page, serve }) => {
			const tmpDir = serve.tmpDir
			expect(tmpDir).not.toBeNull()

			await page.goto(serve.url)
			await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })
			// bash --norc prompt (e.g. "bash-5.2$") proves the session snapshot synced,
			// which is the gate for the controller's auto-insert.
			await expect.poll(() => terminalTextFlat(page), { timeout: 10_000 }).toContain('bash-')

			await page.locator('#wt-image-drop input[type=file]').setInputFiles({
				name: 'e2e-drop.png',
				mimeType: 'image/png',
				buffer: PNG_BYTES,
			})

			// Same-session auto-insert acknowledged by the real input-action round trip.
			await expect(page.locator('.wt-image-drop-status')).toHaveText('Inserted into agent input.', {
				timeout: 10_000,
			})
			const droppedPath = (await page.locator('.wt-image-drop-path').textContent()) ?? ''
			expect(droppedPath).toMatch(/herdweb-drop-[0-9a-f-]+\.png$/)
			expect(droppedPath.startsWith(`${tmpDir}/`)).toBe(true)

			// The uploaded bytes landed in the isolated TMPDIR byte-for-byte, with 0600.
			expect(readFileSync(droppedPath).equals(PNG_BYTES)).toBe(true)
			expect(statSync(droppedPath).mode & 0o777).toBe(0o600)

			// The path reached the real PTY: it is visible at the bash prompt.
			await expect.poll(() => terminalTextFlat(page), { timeout: 10_000 }).toContain(droppedPath)

			// No automatic Enter: bash never executed the path — no error output and
			// no second prompt line appeared after the inserted text.
			await page.waitForTimeout(500)
			const flat = await terminalTextFlat(page)
			expect(flat).not.toContain('Permissiondenied')
			expect(flat).not.toContain('Nosuchfileordirectory')
			expect(flat.split('bash-').length - 1).toBe(1)
		})
	})
}
