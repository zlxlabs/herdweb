import { describe, expect, test } from 'vitest'
import { defaultConfig, defineConfig } from '../src/config'
import {
	ConfigValidationError,
	assertValidConfigOverrides,
	assertValidResolvedConfig,
} from '../src/config-validate'

type Validator = (value: unknown) => void

function getValidationMessage(value: unknown, validate: Validator): string {
	try {
		validate(value)
		throw new Error('Expected config validation to fail')
	} catch (error) {
		expect(error instanceof ConfigValidationError).toBe(true)
		if (error instanceof Error) {
			return error.message
		}
		return ''
	}
}

describe('assertValidConfigOverrides', () => {
	test('accepts empty config object', () => {
		expect(() => assertValidConfigOverrides({})).not.toThrow()
	})

	test('accepts the ASR override shape', () => {
		expect(() =>
			assertValidConfigOverrides({
				asr: {
					enabled: true,
					provider: 'doubao',
					doubao: { apiKey: 'sk-test', resourceId: 'volc.seedasr.sauc.duration' },
					autoEnter: false,
				},
			}),
		).not.toThrow()
	})

	test.each([{ enabled: true, doubao: { apiKey: '' } }, { enabled: true }])(
		'rejects enabling ASR without a non-empty API key: %#',
		(asr) => {
			const message = getValidationMessage({ asr }, assertValidConfigOverrides)
			expect(message).toContain('config.asr.doubao.apiKey')
			expect(message).toContain('redacted')
			expect(message).not.toContain('sk-secret')
		},
	)

	test('allows the disabled ASR default with an empty API key', () => {
		expect(() =>
			assertValidConfigOverrides({ asr: { enabled: false, doubao: { apiKey: '' } } }),
		).not.toThrow()
	})

	test('redacts an ASR doubao string replacement in validation errors', () => {
		const message = getValidationMessage(
			{ asr: { doubao: 'sk-secret-value' } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.asr.doubao')
		expect(message).toContain('redacted')
		expect(message).not.toContain('sk-secret-value')
	})

	test('redacts an ASR parent string replacement in validation errors', () => {
		const message = getValidationMessage({ asr: 'sk-secret-value' }, assertValidConfigOverrides)
		expect(message).toContain('config.asr')
		expect(message).toContain('redacted')
		expect(message).not.toContain('sk-secret-value')
	})

	test('accepts valid partial config with custom row', () => {
		expect(() =>
			assertValidConfigOverrides({
				toolbar: {
					row1: [
						{
							id: 'esc',
							label: 'Esc',
							description: 'Send Escape',
							action: { type: 'send', data: '\x1b' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('accepts voice-input in either toolbar row', () => {
		expect(() =>
			assertValidConfigOverrides({
				toolbar: {
					row1: [
						{
							id: 'voice',
							label: 'Mic',
							description: 'Hold to speak',
							action: { type: 'voice-input' },
						},
					],
					row2: [
						{
							id: 'voice-2',
							label: 'Mic 2',
							description: 'Hold to speak',
							action: { type: 'voice-input' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects voice-input outside the toolbar', () => {
		const voiceButton = {
			id: 'voice',
			label: 'Mic',
			description: 'Hold to speak',
			action: { type: 'voice-input' },
		}
		const drawerMessage = getValidationMessage(
			{ drawer: { buttons: [voiceButton] } },
			assertValidConfigOverrides,
		)
		expect(drawerMessage).toContain('only allowed in toolbar buttons')
		const floatingMessage = getValidationMessage(
			{
				floatingButtons: [
					{
						position: 'top-left',
						buttons: [voiceButton],
					},
				],
			},
			assertValidConfigOverrides,
		)
		expect(floatingMessage).toContain('only allowed in toolbar buttons')
	})

	test('locates every invalid voice-input button by array index and action type', () => {
		const voice = (id: string) => ({
			id,
			label: 'Mic',
			description: 'Hold to speak',
			action: { type: 'voice-input' },
		})
		const message = getValidationMessage(
			{
				drawer: {
					buttons: [
						voice('drawer-0'),
						{ ...voice('regular'), action: { type: 'send', data: 'x' } },
						voice('drawer-2'),
					],
				},
				floatingButtons: [
					{ position: 'top-left', buttons: [] },
					{
						position: 'top-right',
						buttons: [
							{ ...voice('floating-0'), action: { type: 'send', data: 'x' } },
							voice('floating-1'),
						],
					},
				],
			},
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.drawer.buttons[0].action.type')
		expect(message).toContain('config.drawer.buttons[2].action.type')
		expect(message).toContain('config.floatingButtons[1].buttons[1].action.type')
	})

	test('rejects unknown root keys', () => {
		const message = getValidationMessage({ mystery: true }, assertValidConfigOverrides)
		expect(message).toContain('config.mystery')
	})

	test('rejects malformed nested types', () => {
		const message = getValidationMessage(
			{ gestures: { scroll: { strategy: 'mouse' } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.scroll.strategy')
		expect(message).toContain('received string("mouse")')
	})

	test('rejects invalid toolbar button shape', () => {
		const message = getValidationMessage(
			{
				toolbar: {
					row1: [{ id: 'only-id' }],
				},
			},
			assertValidConfigOverrides,
		)
		expect(message).toContain('[0].label')
		expect(message).toContain('[0].description')
		expect(message).toContain('[0].action')
	})

	test('accepts valid partial swipe overrides with left/right', () => {
		expect(() =>
			assertValidConfigOverrides({
				gestures: {
					swipe: { left: '\x02]', right: '\x02[', leftLabel: 'Next pane', rightLabel: 'Prev pane' },
				},
			}),
		).not.toThrow()
	})

	test('rejects non-string swipe left', () => {
		const message = getValidationMessage(
			{ gestures: { swipe: { left: 42 } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.swipe.left')
		expect(message).toContain('string')
	})

	test('rejects non-string swipe rightLabel', () => {
		const message = getValidationMessage(
			{ gestures: { swipe: { rightLabel: true } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.swipe.rightLabel')
		expect(message).toContain('string')
	})

	test('accepts valid doubleTap overrides', () => {
		expect(() =>
			assertValidConfigOverrides({
				gestures: { doubleTap: { enabled: true } },
			}),
		).not.toThrow()
		expect(() =>
			assertValidConfigOverrides({
				gestures: { doubleTap: { data: '\x01z', maxInterval: 500 } },
			}),
		).not.toThrow()
	})

	test('rejects non-string doubleTap data', () => {
		const message = getValidationMessage(
			{ gestures: { doubleTap: { data: 42 } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.doubleTap.data')
		expect(message).toContain('string')
	})

	test('rejects non-number doubleTap maxInterval', () => {
		const message = getValidationMessage(
			{ gestures: { doubleTap: { maxInterval: 'fast' } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.doubleTap.maxInterval')
		expect(message).toContain('number')
	})

	test('accepts valid partial mobile overrides including null initData', () => {
		expect(() => assertValidConfigOverrides({ mobile: { initData: null } })).not.toThrow()
		expect(() => assertValidConfigOverrides({ mobile: { initData: '\x02z' } })).not.toThrow()
		expect(() => assertValidConfigOverrides({ mobile: { widthThreshold: 480 } })).not.toThrow()
	})

	test('rejects non-string/non-null mobile initData', () => {
		const message = getValidationMessage({ mobile: { initData: 42 } }, assertValidConfigOverrides)
		expect(message).toContain('config.mobile.initData')
		expect(message).toContain('received number(42)')
	})

	test('accepts valid floatingButtons group array', () => {
		expect(() =>
			assertValidConfigOverrides({
				floatingButtons: [
					{
						position: 'top-left',
						buttons: [
							{
								id: 'zoom',
								label: 'Zoom',
								description: 'Toggle pane zoom',
								action: { type: 'send', data: '\x02z' },
							},
						],
					},
				],
			}),
		).not.toThrow()
	})

	test('accepts floatingButtons group with direction', () => {
		expect(() =>
			assertValidConfigOverrides({
				floatingButtons: [
					{
						position: 'centre-left',
						direction: 'column',
						buttons: [],
					},
				],
			}),
		).not.toThrow()
	})

	test('accepts empty floatingButtons array', () => {
		expect(() => assertValidConfigOverrides({ floatingButtons: [] })).not.toThrow()
	})

	test('rejects non-array floatingButtons', () => {
		const message = getValidationMessage({ floatingButtons: 'bad' }, assertValidConfigOverrides)
		expect(message).toContain('config.floatingButtons')
	})

	test('rejects floatingButtons group missing position', () => {
		const message = getValidationMessage(
			{ floatingButtons: [{ buttons: [] }] },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.floatingButtons[0].position')
	})

	test('rejects floatingButtons group with invalid position', () => {
		const message = getValidationMessage(
			{ floatingButtons: [{ position: 'middle', buttons: [] }] },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.floatingButtons[0].position')
	})

	test('rejects floatingButtons group with invalid direction', () => {
		const message = getValidationMessage(
			{ floatingButtons: [{ position: 'top-left', direction: 'diagonal', buttons: [] }] },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.floatingButtons[0].direction')
	})

	test('rejects floatingButtons group with unknown keys', () => {
		const message = getValidationMessage(
			{ floatingButtons: [{ position: 'top-left', buttons: [], mystery: true }] },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.floatingButtons[0].mystery')
	})

	test('rejects malformed button inside floatingButtons group', () => {
		const message = getValidationMessage(
			{ floatingButtons: [{ position: 'top-left', buttons: [{ id: 'zoom' }] }] },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.floatingButtons[0].buttons[0].label')
		expect(message).toContain('config.floatingButtons[0].buttons[0].description')
		expect(message).toContain('config.floatingButtons[0].buttons[0].action')
	})

	test('rejects unknown mobile keys', () => {
		const message = getValidationMessage(
			{ mobile: { unknownKey: true } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.mobile.unknownKey')
	})

	test('accepts valid top-level name override', () => {
		expect(() => assertValidConfigOverrides({ name: 'My Terminal' })).not.toThrow()
	})

	test('rejects non-string top-level name', () => {
		const message = getValidationMessage({ name: 42 }, assertValidConfigOverrides)
		expect(message).toContain('config.name')
		expect(message).toContain('string')
	})

	test('accepts valid partial pwa overrides', () => {
		expect(() => assertValidConfigOverrides({ pwa: { shortName: 'wm' } })).not.toThrow()
		expect(() => assertValidConfigOverrides({ pwa: { enabled: false } })).not.toThrow()
		expect(() => assertValidConfigOverrides({ pwa: { themeColor: '#000000' } })).not.toThrow()
	})

	test('rejects pwa.name as unknown key', () => {
		const message = getValidationMessage(
			{ pwa: { name: 'My Terminal' } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.pwa.name')
	})

	test('rejects non-boolean pwa enabled', () => {
		const message = getValidationMessage({ pwa: { enabled: 'yes' } }, assertValidConfigOverrides)
		expect(message).toContain('config.pwa.enabled')
		expect(message).toContain('boolean')
	})

	test('rejects unknown pwa keys', () => {
		const message = getValidationMessage({ pwa: { unknown: true } }, assertValidConfigOverrides)
		expect(message).toContain('config.pwa.unknown')
	})

	test('accepts combo-picker actions', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'combo-picker',
							label: 'Combo',
							description: 'Open combo sender',
							action: { type: 'combo-picker' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects non-send action with data field', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'paste',
							label: 'Paste',
							description: 'Paste text',
							action: { type: 'paste', data: 'x' },
						},
					],
				},
			}),
		).toThrow(ConfigValidationError)
	})

	test('accepts font-size and help actions', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'font-decrease',
							label: 'Font −',
							description: 'Decrease font size',
							action: { type: 'font-size', delta: -2 },
						},
						{
							id: 'guide',
							label: 'Guide',
							description: 'Open the herdweb help guide',
							action: { type: 'help' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects font-size action without a numeric delta', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'font-decrease',
							label: 'Font −',
							description: 'Decrease font size',
							action: { type: 'font-size' },
						},
					],
				},
			}),
		).toThrow(ConfigValidationError)

		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'font-decrease',
							label: 'Font −',
							description: 'Decrease font size',
							action: { type: 'font-size', delta: '2' },
						},
					],
				},
			}),
		).toThrow(ConfigValidationError)
	})

	test('rejects help action with unknown fields', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'guide',
							label: 'Guide',
							description: 'Open the herdweb help guide',
							action: { type: 'help', data: 'x' },
						},
					],
				},
			}),
		).toThrow(ConfigValidationError)
	})

	test('accepts scrollButtons override', () => {
		expect(() => assertValidConfigOverrides({ scrollButtons: { enabled: true } })).not.toThrow()
	})

	test('rejects scroll momentum friction at upper bound', () => {
		const message = getValidationMessage(
			{ gestures: { scroll: { momentum: { friction: 1 } } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.gestures.scroll.momentum.friction')
	})

	test.each([
		{ field: 'friction', value: 0 },
		{ field: 'friction', value: -0.5 },
		{ field: 'friction', value: 1 },
		{ field: 'friction', value: 1.5 },
		{ field: 'minVelocity', value: -1 },
	] as const)('rejects invalid scroll momentum $field=$value', ({ field, value }) => {
		const message = getValidationMessage(
			{ gestures: { scroll: { momentum: { [field]: value } } } },
			assertValidConfigOverrides,
		)
		expect(message).toContain(`config.gestures.scroll.momentum.${field}`)
	})

	test.each([{ friction: 0.95 }, { friction: 0.5 }, { minVelocity: 0 }] as const)(
		'accepts valid scroll momentum override %o',
		(momentum) => {
			expect(() => assertValidConfigOverrides({ gestures: { scroll: { momentum } } })).not.toThrow()
		},
	)

	test('rejects unknown scrollButtons keys', () => {
		const message = getValidationMessage(
			{ scrollButtons: { position: 'left' } },
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.scrollButtons.position')
	})

	test('accepts dpad.keys with null spacer cells', () => {
		expect(() =>
			assertValidConfigOverrides({
				dpad: {
					keys: [
						{
							id: 'dpad-paste',
							label: '📋',
							description: 'Paste from clipboard',
							action: { type: 'paste' },
						},
						null,
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects dpad.keys entries that are neither buttons nor null', () => {
		const message = getValidationMessage({ dpad: { keys: ['x'] } }, assertValidConfigOverrides)
		expect(message).toContain('config.dpad.keys[0]')
	})
})

describe('assertValidResolvedConfig', () => {
	test('accepts defaultConfig', () => {
		expect(() => assertValidResolvedConfig(defaultConfig)).not.toThrow()
		expect(defaultConfig.gestures.scroll.linesPerWheel).toBe(1)
	})

	test('accepts merged config output', () => {
		const merged = defineConfig({ gestures: { scroll: { strategy: 'keys' } } })
		expect(() => assertValidResolvedConfig(merged)).not.toThrow()
	})

	test('rejects missing required root keys', () => {
		const message = getValidationMessage({}, assertValidResolvedConfig)
		expect(message).toContain('config.name')
		expect(message).toContain('config.theme')
		expect(message).toContain('config.font')
		expect(message).toContain('config.mobile')
		expect(message).toContain('config.floatingButtons')
		expect(message).toContain('config.pwa')
	})

	test('rejects missing required nested fields', () => {
		const message = getValidationMessage(
			{
				theme: {},
				font: {
					family: 'JetBrainsMono NFM, monospace',
					cdnUrl:
						'https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css',
					mobileSizeDefault: 16,
					sizeRange: [8, 32],
				},
				toolbar: { row1: [], row2: [] },
				drawer: { buttons: [] },
				gestures: {
					swipe: {
						enabled: true,
						threshold: 80,
						maxDuration: 400,
						left: '\x02n',
						right: '\x02p',
						leftLabel: 'Next herdr tab',
						rightLabel: 'Previous herdr tab',
					},
					pinch: { enabled: false },
					scroll: {
						enabled: true,
						strategy: 'wheel',
						speedMultiplier: 1,
						linesPerWheel: 1,
						momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
						maxLinesPerSend: 24,
						sendIntervalMs: 33,
					},
					doubleTap: { enabled: false, data: '\x02z', maxInterval: 300 },
				},
				mobile: { initData: null, widthThreshold: 768, keyboardMode: 'auto' },
				floatingButtons: [],
			},
			assertValidResolvedConfig,
		)
		expect(message).toContain('config.theme.background')
		expect(message).toContain('received undefined')
	})

	test('rejects missing mobile fields in resolved config', () => {
		const message = getValidationMessage(
			{ ...defaultConfig, mobile: { widthThreshold: 768 } },
			assertValidResolvedConfig,
		)
		expect(message).toContain('config.mobile.initData')
	})
})

describe('assertValidConfigOverrides: ButtonArrayInput forms', () => {
	test('accepts function form for toolbar row1', () => {
		expect(() =>
			assertValidConfigOverrides({
				toolbar: { row1: (defaults: unknown) => defaults },
			}),
		).not.toThrow()
	})

	test('accepts function form for drawer buttons', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: { buttons: () => [] },
			}),
		).not.toThrow()
	})

	test('rejects object (patch) for toolbar row2', () => {
		const message = getValidationMessage(
			{
				toolbar: {
					row2: {
						append: [
							{
								id: 'x',
								label: 'X',
								description: 'X',
								action: { type: 'send', data: 'x' },
							},
						],
						remove: ['q'],
					},
				},
			},
			assertValidConfigOverrides,
		)
		expect(message).toContain('array or function')
	})

	test('rejects non-array/non-function value', () => {
		const message = getValidationMessage({ toolbar: { row1: 42 } }, assertValidConfigOverrides)
		expect(message).toContain('array or function')
	})
})

describe('notify channel config schema', () => {
	test('accepts all built-in outbound channel shapes', () => {
		expect(() =>
			assertValidConfigOverrides({
				notify: {
					channels: [
						{
							type: 'message-pusher',
							url: 'https://push.example.com',
							user: 'someone',
							token: 'token-placeholder',
						},
						{ type: 'wecom', url: 'https://wecom.example.com/hook' },
						{
							type: 'webhook',
							url: 'https://hooks.example.com/events',
							headers: { authorization: 'Bearer header-placeholder' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects unknown fields in a channel', () => {
		const message = getValidationMessage(
			{
				notify: {
					channels: [{ type: 'wecom', url: 'https://wecom.example.com/hook', secret: 'x' }],
				},
			},
			assertValidConfigOverrides,
		)
		expect(message).toContain('config.notify.channels[0].secret')
	})
})
