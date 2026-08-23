import { describe, expect, test } from 'vitest'
import {
	defaultConfig,
	defineConfig,
	mergeConfig,
	serialiseThemeForTtyd,
	withVoiceComposerEntry,
} from '../src/config'
import { ConfigValidationError, assertValidConfigOverrides } from '../src/config-validate'

describe('defineConfig', () => {
	test('returns default config when called with no args', () => {
		const config = defineConfig()
		expect(config).toEqual(defaultConfig)
	})

	test('overrides font family', () => {
		const config = defineConfig({
			font: { family: 'Monaco, monospace' },
		})
		expect(config.font.family).toBe('Monaco, monospace')
		// Other font defaults preserved
		expect(config.font.mobileSizeDefault).toBe(13)
		expect(config.font.sizeRange).toEqual([8, 32])
	})

	test('overrides nested gesture config', () => {
		const config = defineConfig({
			gestures: { swipe: { threshold: 120 } },
		})
		expect(config.gestures.swipe.threshold).toBe(120)
		// Other swipe defaults preserved
		expect(config.gestures.swipe.enabled).toBe(false)
		expect(config.gestures.swipe.maxDuration).toBe(400)
		expect(config.gestures.swipe.left).toBe('\x02n')
		expect(config.gestures.swipe.right).toBe('\x02p')
		expect(config.gestures.swipe.leftLabel).toBe('Next herdr tab')
		expect(config.gestures.swipe.rightLabel).toBe('Previous herdr tab')
		// Pinch defaults preserved
		expect(config.gestures.pinch.enabled).toBe(false)
	})

	test('overrides swipe commands while preserving other swipe defaults', () => {
		const config = defineConfig({
			gestures: { swipe: { left: '\x02]', right: '\x02[' } },
		})
		expect(config.gestures.swipe.left).toBe('\x02]')
		expect(config.gestures.swipe.right).toBe('\x02[')
		// Other swipe defaults preserved
		expect(config.gestures.swipe.enabled).toBe(false)
		expect(config.gestures.swipe.threshold).toBe(80)
		expect(config.gestures.swipe.leftLabel).toBe('Next herdr tab')
		expect(config.gestures.swipe.rightLabel).toBe('Previous herdr tab')
	})

	test('replaces arrays entirely (toolbar row1)', () => {
		const customRow = [
			{
				id: 'a',
				label: 'A',
				description: 'Send a',
				action: { type: 'send' as const, data: 'a' },
			},
		]
		const config = defineConfig({
			toolbar: { row1: customRow },
		})
		expect(config.toolbar.row1).toEqual(customRow)
		// row2 should still have defaults (empty in the single-row layout)
		expect(config.toolbar.row2).toEqual(defaultConfig.toolbar.row2)
	})

	test('replaces drawer buttons array', () => {
		const customButtons = [
			{
				id: 'test',
				label: 'Test',
				description: 'Run test command',
				action: { type: 'send' as const, data: '\x02t' },
			},
		]
		const config = defineConfig({
			drawer: { buttons: customButtons },
		})
		expect(config.drawer.buttons).toEqual(customButtons)
	})

	test('sets custom floatingButtons', () => {
		const group = {
			position: 'top-left' as const,
			buttons: [
				{
					id: 'zoom',
					label: 'Zoom',
					description: 'Toggle pane zoom',
					action: { type: 'send' as const, data: '\x02z' },
				},
			],
		}
		const config = defineConfig({ floatingButtons: [group] })
		expect(config.floatingButtons).toEqual([group])
	})

	test('overrides mobile initData while preserving widthThreshold', () => {
		const config = defineConfig({ mobile: { initData: '\x02z' } })
		expect(config.mobile.initData).toBe('\x02z')
		expect(config.mobile.widthThreshold).toBe(768)
	})

	test('overrides name while preserving pwa defaults', () => {
		const config = defineConfig({ name: 'My Terminal' })
		expect(config.name).toBe('My Terminal')
		expect(config.pwa.enabled).toBe(true)
		expect(config.pwa.themeColor).toBe('#1e1e2e')
	})

	test('has disabled Doubao ASR defaults with the spike resource id', () => {
		expect(defaultConfig.asr).toEqual({
			enabled: false,
			provider: 'doubao',
			doubao: { apiKey: '', resourceId: 'volc.seedasr.sauc.duration' },
			autoEnter: false,
		})
	})

	test('merges nested ASR overrides without dropping defaults', () => {
		const config = defineConfig({ asr: { enabled: true, doubao: { apiKey: 'sk-test' } } })
		expect(config.asr.enabled).toBe(true)
		expect(config.asr.provider).toBe('doubao')
		expect(config.asr.doubao).toEqual({
			apiKey: 'sk-test',
			resourceId: 'volc.seedasr.sauc.duration',
		})
		expect(config.asr.autoEnter).toBe(false)
	})
})

describe('defaultConfig', () => {
	test('has catppuccin-mocha theme', () => {
		expect(defaultConfig.theme.background).toBe('#1e1e2e')
		expect(defaultConfig.theme.foreground).toBe('#cdd6f4')
	})

	test('has 8 row1 buttons (moshi-style single row)', () => {
		expect(defaultConfig.toolbar.row1).toHaveLength(8)
	})

	test('row2 defaults to empty — single-row toolbar', () => {
		expect(defaultConfig.toolbar.row2).toEqual([])
	})

	test('has 31 drawer buttons', () => {
		expect(defaultConfig.drawer.buttons).toHaveLength(31)
	})

	test('default row1 contains the image-upload button; the drawer does not', () => {
		const imageButton = defaultConfig.toolbar.row1.find((button) => button.id === 'image-upload')
		expect(imageButton).toBeDefined()
		expect(imageButton?.action).toEqual({ type: 'image-upload' })
		expect(defaultConfig.drawer.buttons.some((button) => button.id === 'image-upload')).toBe(false)
	})

	test('default drawer uses herdr bindings only', () => {
		const byId = new Map(defaultConfig.drawer.buttons.map((button) => [button.id, button]))

		expect(byId.get('herdr-split-v')?.action).toEqual({ type: 'send', data: '\x02v' })
		expect(byId.get('herdr-split-h')?.action).toEqual({ type: 'send', data: '\x02-' })
		expect(byId.get('herdr-workspaces')?.action).toEqual({ type: 'send', data: '\x02w' })
		expect(byId.get('herdr-sidebar')?.action).toEqual({ type: 'send', data: '\x02b' })
		expect(byId.get('herdr-scrollback')?.action).toEqual({ type: 'send', data: '\x02e' })
		expect(byId.get('herdr-help')?.action).toEqual({ type: 'send', data: '\x02?' })
		expect(byId.has('tmux-split-vertical')).toBe(false)
		expect(byId.has('tmux-sessions')).toBe(false)
		expect(byId.has('tmux-copy')).toBe(false)
	})

	test('row1 is Esc, C-c, ✥, ⏎, Voice, 🖼, ⌨, ☰', () => {
		const labels = defaultConfig.toolbar.row1.map((b) => b.label)
		expect(labels).toEqual(['Esc', 'C-c', '✥', '⏎', 'Voice', '🖼', '⌨', '☰'])
	})

	test('default mobile font size is 13', () => {
		expect(defaultConfig.font.mobileSizeDefault).toBe(13)
	})

	test('font size range is [8, 32]', () => {
		expect(defaultConfig.font.sizeRange).toEqual([8, 32])
	})

	test('mobile defaults to null initData and 768 widthThreshold', () => {
		expect(defaultConfig.mobile.initData).toBeNull()
		expect(defaultConfig.mobile.widthThreshold).toBe(768)
	})

	test('defaults to empty floatingButtons groups', () => {
		expect(defaultConfig.floatingButtons).toEqual([])
	})

	test('scroll buttons default to disabled', () => {
		expect(defaultConfig.scrollButtons.enabled).toBe(false)
	})

	test('scroll buttons can be enabled via defineConfig', () => {
		const config = defineConfig({ scrollButtons: { enabled: true } })
		expect(config.scrollButtons.enabled).toBe(true)
	})

	test('has default name', () => {
		expect(defaultConfig.name).toBe('herdweb')
	})

	test('has default pwa config', () => {
		expect(defaultConfig.pwa.enabled).toBe(true)
		expect(defaultConfig.pwa.themeColor).toBe('#1e1e2e')
	})

	test('swipe defaults to herdr next/prev tab', () => {
		expect(defaultConfig.gestures.swipe.enabled).toBe(false)
		expect(defaultConfig.gestures.swipe.left).toBe('\x02n')
		expect(defaultConfig.gestures.swipe.right).toBe('\x02p')
		expect(defaultConfig.gestures.swipe.leftLabel).toBe('Next herdr tab')
		expect(defaultConfig.gestures.swipe.rightLabel).toBe('Previous herdr tab')
	})
})

describe('withVoiceComposerEntry', () => {
	test('is a no-op for the default config — voice-input is already on default row1', () => {
		const config = defineConfig({ asr: { enabled: true } })
		expect(withVoiceComposerEntry(config)).toBe(config)
	})

	test('custom row1 without voice: inserts after keyboard-toggle and before drawer-toggle', () => {
		const config = defineConfig({
			asr: { enabled: true },
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'voice-input') },
		})
		const effective = withVoiceComposerEntry(config)
		const types = effective.toolbar.row1.map((button) => button.action.type)

		expect(types.indexOf('voice-input')).toBe(types.indexOf('keyboard-toggle') + 1)
		expect(types.indexOf('voice-input')).toBeLessThan(types.indexOf('drawer-toggle'))
		expect(types.filter((type) => type === 'voice-input')).toHaveLength(1)
	})

	test('uses row2 anchor when a configured second row is present', () => {
		const config = defineConfig({
			asr: { enabled: true },
			toolbar: {
				row1: [],
				row2: [
					{
						id: 'drawer',
						label: 'More',
						description: 'Open drawer',
						action: { type: 'drawer-toggle' },
					},
				],
			},
		})
		const effective = withVoiceComposerEntry(config)

		expect(effective.toolbar.row1).toEqual([])
		expect(effective.toolbar.row2.map((button) => button.action.type)).toEqual([
			'voice-input',
			'drawer-toggle',
		])
	})

	test('does not inject when disabled or already configured', () => {
		const disabled = defineConfig()
		expect(withVoiceComposerEntry(disabled)).toBe(disabled)

		const configured = defineConfig({
			asr: { enabled: true },
			toolbar: {
				row1: [
					{
						id: 'voice',
						label: 'Voice',
						description: 'Open voice composer',
						action: { type: 'voice-input' },
					},
				],
			},
		})
		expect(withVoiceComposerEntry(configured)).toBe(configured)
		expect(configured.toolbar.row1).toHaveLength(1)
	})

	test('appends to row1 when neither anchor exists', () => {
		const config = defineConfig({
			asr: { enabled: true },
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
		})
		const effective = withVoiceComposerEntry(config)
		expect(effective.toolbar.row1.at(-1)?.action.type).toBe('voice-input')
	})
})

describe('defineConfig with ButtonArrayInput', () => {
	test('plain array replaces toolbar row1', () => {
		const custom = [
			{ id: 'x', label: 'X', description: 'X', action: { type: 'send' as const, data: 'x' } },
		]
		const config = defineConfig({ toolbar: { row1: custom } })
		expect(config.toolbar.row1).toEqual(custom)
		// row2 preserved
		expect(config.toolbar.row2).toEqual(defaultConfig.toolbar.row2)
	})

	test('function form populates the empty default row2', () => {
		const extra = {
			id: 'q',
			label: 'q',
			description: 'Send q key',
			action: { type: 'send' as const, data: 'q' },
		}
		const config = defineConfig({
			toolbar: { row2: (defaults) => [...defaults, extra] },
		})
		expect(config.toolbar.row2).toEqual([extra])
	})

	test('function form appends to toolbar row1', () => {
		const extra = {
			id: 'x',
			label: 'X',
			description: 'X',
			action: { type: 'send' as const, data: 'x' },
		}
		const config = defineConfig({ toolbar: { row1: (defaults) => [...defaults, extra] } })
		expect(config.toolbar.row1).toHaveLength(defaultConfig.toolbar.row1.length + 1)
		expect(config.toolbar.row1[config.toolbar.row1.length - 1]).toEqual(extra)
	})

	test('function form prepends to toolbar row2', () => {
		const extra = {
			id: 'x',
			label: 'X',
			description: 'X',
			action: { type: 'send' as const, data: 'x' },
		}
		const config = defineConfig({ toolbar: { row2: (defaults) => [extra, ...defaults] } })
		expect(config.toolbar.row2[0]).toEqual(extra)
	})

	test('function form removes from toolbar row1', () => {
		const config = defineConfig({
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'esc') },
		})
		expect(config.toolbar.row1.find((b) => b.id === 'esc')).toBeUndefined()
		expect(config.toolbar.row1.length).toBe(defaultConfig.toolbar.row1.length - 1)
	})

	test('function form replaces in toolbar row1', () => {
		const config = defineConfig({
			toolbar: {
				row1: (defaults) =>
					defaults.map((b) =>
						b.id === 'esc'
							? { ...b, label: 'ESC2', action: { type: 'send' as const, data: '\x1b\x1b' } }
							: b,
					),
			},
		})
		const esc = config.toolbar.row1.find((b) => b.id === 'esc')
		expect(esc?.label).toBe('ESC2')
	})

	test('drawer function form', () => {
		const config = defineConfig({
			drawer: { buttons: (defaults) => defaults.slice(0, 3) },
		})
		expect(config.drawer.buttons).toHaveLength(3)
	})
})

describe('mergeConfig', () => {
	test('merges overrides against a non-default base config', () => {
		const base = defineConfig({ name: 'base' })
		const result = mergeConfig(base, { name: 'merged' })
		expect(result.name).toBe('merged')
		// Toolbar preserved from base
		expect(result.toolbar.row1).toEqual(base.toolbar.row1)
	})

	test('function resolves against base buttons, not defaults', () => {
		const custom = [
			{ id: 'x', label: 'X', description: 'X', action: { type: 'send' as const, data: 'x' } },
			{ id: 'y', label: 'Y', description: 'Y', action: { type: 'send' as const, data: 'y' } },
		]
		const base = defineConfig({ toolbar: { row1: custom } })
		const result = mergeConfig(base, {
			toolbar: { row1: (defaults) => defaults.filter((b) => b.id !== 'x') },
		})
		expect(result.toolbar.row1).toHaveLength(1)
		expect(result.toolbar.row1[0]?.id).toBe('y')
	})
})

describe('serialiseThemeForTtyd', () => {
	test('produces valid JSON', () => {
		const json = serialiseThemeForTtyd(defaultConfig)
		const parsed = JSON.parse(json)
		expect(parsed.background).toBe('#1e1e2e')
		expect(parsed.foreground).toBe('#cdd6f4')
	})
})

describe('image-upload action schema', () => {
	test('accepts a valid image-upload button in the drawer', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'image-upload',
							label: '🖼 Image',
							description: 'Upload an image',
							action: { type: 'image-upload' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('rejects an image-upload action with unknown fields', () => {
		expect(() =>
			assertValidConfigOverrides({
				drawer: {
					buttons: [
						{
							id: 'image-upload',
							label: '🖼 Image',
							description: 'Upload an image',
							action: { type: 'image-upload', data: 'x' },
						},
					],
				},
			}),
		).toThrow(ConfigValidationError)
	})
})
