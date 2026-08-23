import { resolveButtonArray } from './config-resolve'
import { dpadToggleButton } from './controls/dpad'
import { keyboardToggleButton } from './controls/keyboard-controller'
import { catppuccinMocha } from './theme/catppuccin-mocha'
import type {
	ControlButton,
	DeepPartial,
	HerdwebConfig,
	HerdwebConfigOverrides,
	PwaConfig,
} from './types'

/** Default font configuration */
const defaultFont: HerdwebConfig['font'] = {
	family: 'JetBrainsMono NFM, monospace',
	cdnUrl:
		'https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/jetbrainsmono-nfm.css',
	mobileSizeDefault: 13,
	sizeRange: [8, 32],
}

/** Default gesture configuration */
const defaultGestures: HerdwebConfig['gestures'] = {
	swipe: {
		// Default off: horizontal swipes at the screen bottom now belong to the
		// single-row toolbar scroll — a swipe starting just above it would fire
		// a window switch. Window switching stays in the drawer (Win/Windows).
		enabled: false,
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
}

/** Default toolbar entry for the two-layer voice composer. */
const voiceComposerButton: ControlButton = {
	id: 'voice-input',
	label: 'Voice',
	description: 'Open voice composer',
	action: { type: 'voice-input' },
}

/**
 * Default row 1 buttons (moshi-style single row): control keys on the left
 * (Esc, C-c, ✥, ⏎), input modes on the right (🎤, 🖼, ⌨, ☰). ⌫ left the row —
 * the floating d-pad and the voice composer textarea cover it day-to-day,
 * and the drawer keeps a fallback. The voice entry stays on the row even
 * when ASR is disabled; the toolbar hides it until a mic controller exists.
 */
const defaultRow1: HerdwebConfig['toolbar']['row1'] = [
	{
		id: 'esc',
		label: 'Esc',
		description: 'Send Escape key',
		action: { type: 'send', data: '\x1b' },
	},
	{
		// Dedicated C-c: coding agents need double Ctrl-C to quit, which neither
		// the one-shot sticky Ctrl nor the auto-closing drawer can express.
		id: 'ctrl-c',
		label: 'C-c',
		description: 'Send Ctrl-C interrupt (tap twice to quit agents)',
		action: { type: 'send', data: '\x03' },
	},
	// ✥ toggles the floating d-pad — it owns the arrow keys and ⌫ now (up/down
	// also keep drawer fallback entries below).
	dpadToggleButton,
	{
		id: 'enter',
		label: '\u23CE',
		description: 'Send Enter/Return key',
		action: { type: 'send', data: '\r' },
	},
	// Voice is the primary input method — a first-class row1 member, not an
	// asr.enabled patch-in. Hidden by the toolbar when no mic controller exists.
	voiceComposerButton,
	{
		// Image insert is a high-frequency agent action — one tap from row1,
		// no drawer round trip (success is a transient toast, nothing to close).
		id: 'image-upload',
		label: '🖼',
		description: 'Upload an image and insert its temp path into the agent input',
		action: { type: 'image-upload' },
	},
	// ⌨ stays on the first layer as the soft-keyboard escape hatch.
	keyboardToggleButton,
	{
		id: 'drawer-toggle',
		label: '\u2630',
		description: 'Open command drawer',
		action: { type: 'drawer-toggle' },
	},
]

/**
 * Default row 2 buttons — empty: the toolbar is a single row by default
 * (moshi style). The removed keys live in the drawer defaults below; set
 * `toolbar.row2` to opt back into a second row.
 */
const defaultRow2: HerdwebConfig['toolbar']['row2'] = []

/**
 * Inject the voice entry into the reachable toolbar when ASR is enabled.
 * The default row1 already carries voice-input, so this is a no-op for
 * default configs; it only patches custom rows that lack a voice entry.
 */
export function withVoiceComposerEntry(config: HerdwebConfig): HerdwebConfig {
	if (!config.asr.enabled) return config

	const rows = [config.toolbar.row1, config.toolbar.row2]
	if (rows.flat().some((button) => button.action.type === 'voice-input')) return config

	const keyboardRow = rows.findIndex((row) =>
		row.some((button) => button.action.type === 'keyboard-toggle'),
	)
	const drawerRow = rows.findIndex((row) =>
		row.some((button) => button.action.type === 'drawer-toggle'),
	)
	const rowIndex = keyboardRow >= 0 ? keyboardRow : drawerRow >= 0 ? drawerRow : 0
	const row = rows[rowIndex] ?? []
	const anchorType = keyboardRow >= 0 ? 'keyboard-toggle' : 'drawer-toggle'
	const anchorIndex = row.findIndex((button) => button.action.type === anchorType)
	const insertIndex =
		anchorIndex >= 0 && anchorType === 'keyboard-toggle' ? anchorIndex + 1 : anchorIndex
	const nextRow = [...row]
	if (insertIndex >= 0) nextRow.splice(insertIndex, 0, voiceComposerButton)
	else nextRow.push(voiceComposerButton)

	return {
		...config,
		toolbar: {
			row1: rowIndex === 0 ? nextRow : config.toolbar.row1,
			row2: rowIndex === 1 ? nextRow : config.toolbar.row2,
		},
	}
}

/** Default drawer commands — herdr key bindings (Ctrl-B prefix, same as tmux) */
export const defaultDrawerButtons: readonly ControlButton[] = [
	{
		id: 'herdr-new-window',
		label: '+ Win',
		description: 'Create herdr window',
		action: { type: 'send', data: '\x02c' },
	},
	{
		id: 'herdr-split-v',
		label: 'Split |',
		description: 'Split pane vertically',
		action: { type: 'send', data: '\x02v' },
	},
	{
		id: 'herdr-split-h',
		label: 'Split \u2014',
		description: 'Split pane horizontally',
		action: { type: 'send', data: '\x02-' },
	},
	{
		id: 'herdr-zoom',
		label: 'Zoom',
		description: 'Toggle pane zoom',
		action: { type: 'send', data: '\x02z' },
	},
	{
		id: 'herdr-workspaces',
		label: 'Spaces',
		description: 'Choose herdr workspace',
		action: { type: 'send', data: '\x02w' },
	},
	{
		id: 'herdr-sidebar',
		label: 'Sidebar',
		description: 'Toggle herdr sidebar',
		action: { type: 'send', data: '\x02b' },
	},
	{
		id: 'page-up',
		label: 'PgUp',
		description: 'Send Page Up key',
		action: { type: 'send', data: '\x1b[5~', keyLabel: 'Page Up' },
	},
	{
		id: 'page-down',
		label: 'PgDn',
		description: 'Send Page Down key',
		action: { type: 'send', data: '\x1b[6~', keyLabel: 'Page Down' },
	},
	{
		id: 'herdr-scrollback',
		label: 'Scroll',
		description: 'Enter herdr scrollback editor',
		action: { type: 'send', data: '\x02e' },
	},
	{
		id: 'herdr-help',
		label: 'Help',
		description: 'List herdr key bindings',
		action: { type: 'send', data: '\x02?' },
	},
	{
		id: 'herdr-kill-pane',
		label: 'Kill',
		description: 'Kill current pane (with confirm)',
		action: { type: 'send', data: '\x02x' },
	},
	{
		id: 'combo-picker',
		label: 'Combo',
		description: 'Open combo sender (Ctrl/Alt + key)',
		action: { type: 'combo-picker' },
	},
	{
		id: 'font-decrease',
		label: 'Font −',
		description: 'Decrease font size',
		action: { type: 'font-size', delta: -2 },
	},
	{
		id: 'font-increase',
		label: 'Font +',
		description: 'Increase font size',
		action: { type: 'font-size', delta: 2 },
	},
	{
		id: 'notify-panel',
		label: '\uD83D\uDD14',
		description: 'Notification settings',
		action: { type: 'notify-panel' },
	},
	{
		id: 'guide',
		label: 'Guide',
		description: 'Open the herdweb help guide',
		action: { type: 'help' },
	},
	// Keys removed from the toolbar when it went single-row stay reachable here
	{
		// Tab left row1 when the row shrank — drawer fallback
		id: 'tab',
		label: 'Tab',
		description: 'Send Tab key',
		action: { type: 'send', data: '\t', keyLabel: 'Tab' },
	},
	{
		id: 'shift-tab',
		label: 'S-Tab',
		description: 'Send Shift+Tab key',
		action: { type: 'send', data: '\x1b[Z', keyLabel: 'Shift+Tab' },
	},
	{
		id: 'left',
		label: '\u2190',
		description: 'Send Left arrow key',
		action: { type: 'send', data: '\x1b[D', keyLabel: 'Left' },
	},
	{
		id: 'right',
		label: '\u2192',
		description: 'Send Right arrow key',
		action: { type: 'send', data: '\x1b[C', keyLabel: 'Right' },
	},
	// up/down left row1 when the d-pad took over the arrows — drawer fallback
	{
		id: 'up',
		label: '\u2191',
		description: 'Send Up arrow key',
		action: { type: 'send', data: '\x1b[A', keyLabel: 'Up' },
	},
	{
		id: 'down',
		label: '\u2193',
		description: 'Send Down arrow key',
		action: { type: 'send', data: '\x1b[B', keyLabel: 'Down' },
	},
	{
		id: 'ctrl-c',
		label: 'C-c',
		description: 'Send Ctrl-C interrupt',
		action: { type: 'send', data: '\x03' },
	},
	{
		id: 'ctrl-d',
		label: 'C-d',
		description: 'Send Ctrl-D key',
		action: { type: 'send', data: '\x04' },
	},
	{
		id: 'q',
		label: 'q',
		description: 'Send q key',
		action: { type: 'send', data: 'q' },
	},
	{
		id: 'alt-enter',
		label: 'M-↵',
		description: 'Send Alt+Enter (ESC + Enter)',
		action: { type: 'send', data: '\x1b\r', keyLabel: 'Alt+Enter' },
	},
	{
		id: 'space',
		label: 'Space',
		description: 'Send Space key',
		action: { type: 'send', data: ' ' },
	},
	{
		// ⌫ left row1 in the portrait recut — the d-pad owns it day-to-day; drawer fallback
		id: 'backspace',
		label: '\u232b',
		description: 'Send Backspace key',
		action: { type: 'send', data: '\x7f', keyLabel: 'Backspace' },
	},
	// Second single-row cut (8-key row): Ctrl modifier / Prefix / Paste stay reachable here
	{
		id: 'ctrl',
		label: 'Ctrl',
		description: 'Sticky Ctrl modifier (applies to the next key)',
		action: { type: 'ctrl-modifier' },
	},
	{
		id: 'prefix',
		label: 'Prefix',
		description: 'Send herdr prefix key (Ctrl-B)',
		action: { type: 'prefix', data: '\x02' },
	},
	{ id: 'paste', label: 'Paste', description: 'Paste from clipboard', action: { type: 'paste' } },
]

/** Default mobile configuration */
const defaultMobile: HerdwebConfig['mobile'] = {
	initData: null,
	widthThreshold: 768,
	keyboardMode: 'auto',
}

/** Default PWA configuration */
const defaultPwa: PwaConfig = {
	enabled: true,
	themeColor: '#1e1e2e',
}

const defaultAsr: HerdwebConfig['asr'] = {
	enabled: false,
	provider: 'doubao',
	doubao: {
		apiKey: '',
		resourceId: 'volc.seedasr.sauc.duration',
	},
	autoEnter: false,
}

const defaultNotify: HerdwebConfig['notify'] = {
	vapid: {},
	history: { limit: 200 },
	silence: {
		enabled: true,
		busyMs: 30_000,
		quietMs: 180_000,
		cooldownMs: 600_000,
	},
}

/** Complete default configuration */
export const defaultConfig: HerdwebConfig = {
	name: 'herdweb',
	theme: catppuccinMocha,
	font: defaultFont,
	toolbar: { row1: defaultRow1, row2: defaultRow2 },
	drawer: { buttons: defaultDrawerButtons },
	gestures: defaultGestures,
	mobile: defaultMobile,
	floatingButtons: [],
	scrollButtons: { enabled: false },
	pwa: defaultPwa,
	reconnect: { enabled: true },
	asr: defaultAsr,
	notify: defaultNotify,
}

/** Deep merge two objects, with `override` taking precedence */
function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base }
	for (const key of Object.keys(override)) {
		const overrideVal = override[key]
		if (overrideVal === undefined) continue
		const baseVal = base[key]
		if (
			baseVal !== null &&
			typeof baseVal === 'object' &&
			!Array.isArray(baseVal) &&
			overrideVal !== null &&
			typeof overrideVal === 'object' &&
			!Array.isArray(overrideVal)
		) {
			/* oxlint-disable typescript/consistent-type-assertions -- generic deepMerge on runtime-narrowed objects */
			result[key] = deepMerge(
				baseVal as Record<string, unknown>,
				overrideVal as Record<string, unknown>,
			)
			/* oxlint-enable typescript/consistent-type-assertions */
		} else {
			result[key] = overrideVal
		}
	}
	return result
}

/**
 * Merge a config overrides object against a base config.
 * Button arrays support array or function form via `ButtonArrayInput`.
 */
export function mergeConfig(base: HerdwebConfig, overrides: HerdwebConfigOverrides): HerdwebConfig {
	// Extract button array inputs before deep-merging (they are not plain arrays)
	const row1Input = overrides.toolbar?.row1
	const row2Input = overrides.toolbar?.row2
	const drawerInput = overrides.drawer?.buttons

	// Strip button array inputs from overrides before deep-merge so deepMerge
	// doesn't try to replace them (they may be functions, not arrays)
	const strippedOverrides: DeepPartial<HerdwebConfig> = {
		...overrides,
		toolbar:
			overrides.toolbar !== undefined
				? {
						// oxlint-disable-next-line typescript/consistent-type-assertions -- bridge typed overrides to untyped merge
						...(overrides.toolbar as DeepPartial<HerdwebConfig['toolbar']>),
						row1: undefined,
						row2: undefined,
					}
				: undefined,
		drawer:
			overrides.drawer !== undefined
				? {
						// oxlint-disable-next-line typescript/consistent-type-assertions -- bridge typed overrides to untyped merge
						...(overrides.drawer as DeepPartial<HerdwebConfig['drawer']>),
						buttons: undefined,
					}
				: undefined,
	}

	/* oxlint-disable typescript/consistent-type-assertions -- bridge typed config to untyped deepMerge */
	const merged = deepMerge(
		base as unknown as Record<string, unknown>,
		strippedOverrides as unknown as Record<string, unknown>,
	) as unknown as HerdwebConfig
	/* oxlint-enable typescript/consistent-type-assertions */

	// Resolve button arrays
	const row1 = resolveButtonArray(base.toolbar.row1, row1Input)
	const row2 = resolveButtonArray(base.toolbar.row2, row2Input)
	const drawerButtons = resolveButtonArray(base.drawer.buttons, drawerInput)

	return {
		...merged,
		toolbar: { row1, row2 },
		drawer: { buttons: drawerButtons },
	}
}

/** Define a herdweb configuration with defaults filled in */
export function defineConfig(overrides: HerdwebConfigOverrides = {}): HerdwebConfig {
	return mergeConfig(defaultConfig, overrides)
}

/**
 * Serialise theme to ttyd `-t theme=...` JSON string.
 * Used by the shell wrapper to pass theme via CLI flags.
 */
export function serialiseThemeForTtyd(config: HerdwebConfig): string {
	return JSON.stringify(config.theme)
}
