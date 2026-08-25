import { join } from 'node:path'
import { expect, test } from './fixtures'

const explicitConfigPath = join(import.meta.dirname, 'target-switch.config.ts')

// Coarse pointers: the badge must dodge herdr's own top-right `switch` — it
// parks lower-left above the toolbar and hides behind the voice composer layer;
// fine pointers keep it top-right. Only user-perceivable geometry is asserted
// (viewport halves, no overlap, visible gap), never exact pixels.
test.describe('target badge layout (explicit mode)', () => {
	test.use({ serveOptions: { configPath: explicitConfigPath, command: [] } })

	test('coarse-pointer badge parks lower-left, clear of the toolbar', async ({ page, serve }) => {
		await page.goto(serve.url, { waitUntil: 'domcontentloaded' })
		await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
		const badge = page.locator('button.wt-target-badge')
		await expect(badge).toBeVisible({ timeout: 15_000 })
		const toolbar = page.locator('#wt-toolbar')
		await expect(toolbar).toBeVisible()
		const badgeBox = await badge.boundingBox()
		if (!badgeBox) throw new Error('target badge must have a visible bounding box')
		const toolbarBox = await toolbar.boundingBox()
		if (!toolbarBox) throw new Error('toolbar must have a visible bounding box')
		const viewport = await page.evaluate(() => ({
			width: window.innerWidth,
			height: window.innerHeight,
		}))

		// Lower-left half of the viewport (bottom-right stays dpad turf).
		expect(badgeBox.y + badgeBox.height / 2).toBeGreaterThan(viewport.height / 2)
		expect(badgeBox.x + badgeBox.width / 2).toBeLessThan(viewport.width / 2)
		// Sits above the toolbar with a visible gap, never intersecting it.
		expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(toolbarBox.y)
		expect(toolbarBox.y - (badgeBox.y + badgeBox.height)).toBeGreaterThanOrEqual(4)
	})

	test('coarse-pointer badge hides while the voice composer layer is open', async ({
		page,
		serve,
	}) => {
		await page.goto(serve.url, { waitUntil: 'domcontentloaded' })
		const badge = page.locator('button.wt-target-badge')
		await expect(badge).toBeVisible({ timeout: 15_000 })
		await page.evaluate(() => document.body.classList.add('wt-composer-open'))
		await expect(badge).toBeHidden()
	})

	test('fine-pointer badge stays in the top-right area', async ({ browser, serve }) => {
		const desktopContext = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			isMobile: false,
			hasTouch: false,
		})
		try {
			const page = await desktopContext.newPage()
			await page.goto(serve.url, { waitUntil: 'domcontentloaded' })
			const badge = page.locator('button.wt-target-badge')
			await expect(badge).toBeVisible({ timeout: 15_000 })
			const badgeBox = await badge.boundingBox()
			if (!badgeBox) throw new Error('target badge must have a visible bounding box')
			const viewport = await page.evaluate(() => ({
				width: window.innerWidth,
				height: window.innerHeight,
			}))
			expect(badgeBox.y + badgeBox.height / 2).toBeLessThan(viewport.height / 2)
			expect(badgeBox.x + badgeBox.width / 2).toBeGreaterThan(viewport.width / 2)
		} finally {
			await desktopContext.close()
		}
	})
})
