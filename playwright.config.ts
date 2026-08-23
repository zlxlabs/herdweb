import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './tests/playwright',
	// Local request timing does not justify changing the shared suite timeout.
	timeout: 30_000,
	retries: process.env.CI ? 2 : 0,
	projects: [
		{
			name: 'chromium-android',
			use: {
				...devices['Pixel 5'],
				launchOptions: {
					args: [
						'--use-fake-device-for-media-stream',
						'--use-fake-ui-for-media-stream',
						'--enable-features=WebPush',
					],
				},
			},
		},
		{
			name: 'webkit-iphone',
			use: { ...devices['iPhone 13'] },
		},
	],
})
