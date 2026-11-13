import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

/**
 * Independent UI walkthrough (visual evidence) config — consumed only by
 * .github/workflows/herdweb-visual.yml. It runs just
 * tests/playwright/herdweb-visual.spec.ts on chromium with a single worker,
 * zero retries, and always-on video/trace/screenshot plus a self-contained
 * HTML report. The media/report settings must never leak into the shared
 * blocking suite in playwright.config.ts (that would make every test:pw run
 * record video), and the blocking suite's testIgnore is overridden here so
 * visual discovery is never empty.
 */
export default defineConfig({
	...baseConfig,
	testDir: './tests/playwright',
	testMatch: '**/herdweb-visual.spec.ts',
	testIgnore: [],
	fullyParallel: false,
	workers: 1,
	retries: 0,
	use: {
		video: 'on',
		trace: 'on',
		screenshot: 'on',
	},
	// Test artifacts (video/trace/screenshots) get their own directory, a
	// sibling of the HTML report — never nested inside it (Playwright refuses a
	// report folder that clashes with the tests output folder) and never the
	// shared default test-results/ root.
	outputDir: 'test-results/visual-artifacts',
	// Under test-results/ (git- and biome-ignored); the root-level
	// 'playwright-report' name is not honored by biome's ignore list.
	reporter: [['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
	projects: (baseConfig.projects ?? []).filter((project) => project.name === 'chromium-android'),
})
