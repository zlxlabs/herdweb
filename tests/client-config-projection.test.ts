import { describe, expect, test } from 'vitest'
import { bundleClientAssets, renderClientHtml } from '../build'
import { defineConfig } from '../src/config'

describe('client config projection', () => {
	test('embeds only client fields in generated JavaScript and HTML', async () => {
		const config = defineConfig({
			name: 'client-name-sentinel',
			theme: { background: 'client-theme-sentinel' },
			font: { family: 'client-font-sentinel' },
			toolbar: {
				row1: [
					{
						id: 'client-toolbar',
						label: 'client-toolbar-sentinel',
						description: 'client toolbar',
						action: { type: 'send', data: '\u001b' },
					},
				],
			},
			reconnect: { enabled: false },
			asr: {
				enabled: true,
				doubao: {
					apiKey: 'asr-api-key-sentinel',
					resourceId: 'asr-resource-id-sentinel',
				},
			},
			targets: [
				{
					id: 'target-id-sentinel',
					name: 'target-name-sentinel',
					command: ['target-command-sentinel', 'target-argv-sentinel'],
				},
			],
			defaultTargetId: 'target-id-sentinel',
			notify: {
				token: 'notify-token-sentinel',
				vapid: { privateKey: 'vapid-private-key-sentinel' },
				channels: [
					{
						type: 'message-pusher',
						url: 'message-pusher-url-sentinel',
						user: 'message-pusher-user',
						token: 'message-pusher-token-sentinel',
					},
					{ type: 'wecom', url: 'wecom-webhook-url-sentinel' },
					{
						type: 'webhook',
						url: 'webhook-url-sentinel',
						headers: { authorization: 'webhook-header-sentinel' },
					},
				],
			},
		})
		const assets = await bundleClientAssets(config, 'test-version')
		const html = renderClientHtml(assets.js, assets.css, config, 'test-nonce')
		const bytes = `${assets.js}\n${html}`

		for (const secret of [
			'target-command-sentinel',
			'target-argv-sentinel',
			'notify-token-sentinel',
			'vapid-private-key-sentinel',
			'message-pusher-token-sentinel',
			'message-pusher-url-sentinel',
			'wecom-webhook-url-sentinel',
			'webhook-url-sentinel',
			'webhook-header-sentinel',
		]) {
			expect(bytes).not.toContain(secret)
		}

		expect(assets.js).toContain('asr-api-key-sentinel')
		expect(assets.js).toContain('asr-resource-id-sentinel')
		expect(assets.js).toContain('client-name-sentinel')
		expect(assets.js).toContain('client-theme-sentinel')
		expect(assets.js).toContain('client-font-sentinel')
		expect(assets.js).toContain('client-toolbar-sentinel')
		expect(assets.js).toContain('"reconnect":{"enabled":false}')
		const projectionMatch = assets.js.match(
			/globalThis\.__herdwebConfig=(\{.*?\});globalThis\.__herdwebBasePath=/,
		)
		if (projectionMatch === null) {
			throw new Error('client config projection was not embedded')
		}
		const projection = projectionMatch[1]
		if (projection === undefined) {
			throw new Error('client config projection payload was empty')
		}
		const projected = JSON.parse(projection) as Record<string, unknown>
		expect(projected.targetMode).toBe('explicit')
		expect(projected.targetCount).toBe(1)
		expect(projected).not.toHaveProperty('targets')
		expect(assets.js).not.toContain('"command":["herdr","--session","default"]')
	})
})
