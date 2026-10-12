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
	reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
	projects: baseConfig.projects.filter((project) => project.name === 'chromium-android'),
})
