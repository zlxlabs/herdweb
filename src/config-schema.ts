/**
 * Valibot schemas for herdweb config validation.
 * Only used at CLI time (build/inject/serve) — never in the browser bundle.
 */
import * as v from 'valibot'

// --- Primitives ---

const finiteNumber = v.pipe(v.number(), v.finite())

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// --- Button action (discriminated union) ---

const sendActionSchema = v.strictObject({
	type: v.literal('send'),
	data: v.string(),
	keyLabel: v.optional(v.string()),
})

const prefixActionSchema = v.strictObject({
	type: v.literal('prefix'),
	data: v.string(),
})
const ctrlModifierActionSchema = v.strictObject({ type: v.literal('ctrl-modifier') })
const pasteActionSchema = v.strictObject({ type: v.literal('paste') })
const comboPickerActionSchema = v.strictObject({ type: v.literal('combo-picker') })
const drawerToggleActionSchema = v.strictObject({ type: v.literal('drawer-toggle') })
const fontSizeActionSchema = v.strictObject({
	type: v.literal('font-size'),
	delta: finiteNumber,
})
const helpActionSchema = v.strictObject({ type: v.literal('help') })
const keyboardToggleActionSchema = v.strictObject({ type: v.literal('keyboard-toggle') })
const dpadToggleActionSchema = v.strictObject({ type: v.literal('dpad-toggle') })
const voiceInputActionSchema = v.strictObject({ type: v.literal('voice-input') })
const imageUploadActionSchema = v.strictObject({ type: v.literal('image-upload') })
const notifyPanelActionSchema = v.strictObject({ type: v.literal('notify-panel') })

const buttonActionSchema = v.variant('type', [
	sendActionSchema,
	prefixActionSchema,
	ctrlModifierActionSchema,
	pasteActionSchema,
	comboPickerActionSchema,
	drawerToggleActionSchema,
	fontSizeActionSchema,
	helpActionSchema,
	keyboardToggleActionSchema,
	dpadToggleActionSchema,
	voiceInputActionSchema,
	imageUploadActionSchema,
	notifyPanelActionSchema,
])

// --- Control button ---

const controlButtonSchema = v.strictObject({
	id: v.string(),
	label: v.string(),
	description: v.string(),
	action: buttonActionSchema,
})

// --- Button array input (array | function) ---
// Uses v.custom for type check + v.rawCheck for deep array validation,
// avoiding v.union which loses path context for nested issues.

const buttonArrayInputSchema = v.pipe(
	v.custom<readonly Record<string, unknown>[] | ((...args: readonly unknown[]) => unknown)>(
		(input) => Array.isArray(input) || typeof input === 'function',
		'array or function',
	),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed || !Array.isArray(dataset.value)) return
		const arr = dataset.value
		for (let i = 0; i < arr.length; i++) {
			const result = v.safeParse(controlButtonSchema, arr[i])
			if (!result.success) {
				for (const issue of result.issues) {
					addIssue({
						message: issue.message,
						// The widened action-variant union types expected as string | null;
						// addIssue takes string | undefined
						expected: issue.expected ?? undefined,
						received: issue.received,
						path: [
							{
								type: 'array',
								origin: 'value',
								input: arr,
								key: i,
								// oxlint-disable-next-line typescript/consistent-type-assertions -- Valibot path segment requires typed value
								value: arr[i] as Record<string, unknown>,
							},
							...(issue.path ?? []),
						],
					})
				}
			}
		}
	}),
)

// --- Theme ---

const themeColourSchema = v.optional(v.string())

const termThemeOverridesSchema = v.strictObject({
	background: themeColourSchema,
	foreground: themeColourSchema,
	cursor: themeColourSchema,
	cursorAccent: themeColourSchema,
	selectionBackground: themeColourSchema,
	black: themeColourSchema,
	red: themeColourSchema,
	green: themeColourSchema,
	yellow: themeColourSchema,
	blue: themeColourSchema,
	magenta: themeColourSchema,
	cyan: themeColourSchema,
	white: themeColourSchema,
	brightBlack: themeColourSchema,
	brightRed: themeColourSchema,
	brightGreen: themeColourSchema,
	brightYellow: themeColourSchema,
	brightBlue: themeColourSchema,
	brightMagenta: themeColourSchema,
	brightCyan: themeColourSchema,
	brightWhite: themeColourSchema,
})

const termThemeResolvedSchema = v.strictObject({
	background: v.string(),
	foreground: v.string(),
	cursor: v.string(),
	cursorAccent: v.string(),
	selectionBackground: v.string(),
	black: v.string(),
	red: v.string(),
	green: v.string(),
	yellow: v.string(),
	blue: v.string(),
	magenta: v.string(),
	cyan: v.string(),
	white: v.string(),
	brightBlack: v.string(),
	brightRed: v.string(),
	brightGreen: v.string(),
	brightYellow: v.string(),
	brightBlue: v.string(),
	brightMagenta: v.string(),
	brightCyan: v.string(),
	brightWhite: v.string(),
})

// --- Font ---

const fontOverridesSchema = v.strictObject({
	family: v.optional(v.string()),
	cdnUrl: v.optional(v.string()),
	mobileSizeDefault: v.optional(finiteNumber),
	sizeRange: v.optional(v.pipe(v.tuple([finiteNumber, finiteNumber]))),
})

const fontResolvedSchema = v.strictObject({
	family: v.string(),
	cdnUrl: v.string(),
	mobileSizeDefault: finiteNumber,
	sizeRange: v.pipe(v.tuple([finiteNumber, finiteNumber])),
})

// --- Gestures ---

const swipeOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	threshold: v.optional(finiteNumber),
	maxDuration: v.optional(finiteNumber),
	left: v.optional(v.string()),
	right: v.optional(v.string()),
	leftLabel: v.optional(v.string()),
	rightLabel: v.optional(v.string()),
})

const swipeResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	threshold: finiteNumber,
	maxDuration: finiteNumber,
	left: v.string(),
	right: v.string(),
	leftLabel: v.string(),
	rightLabel: v.string(),
})

const pinchOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
})

const pinchResolvedSchema = v.strictObject({
	enabled: v.boolean(),
})

const scrollStrategySchema = v.picklist(['keys', 'wheel'])

const scrollMomentumFrictionSchema = v.pipe(
	finiteNumber,
	v.gtValue(0, 'must be greater than 0 and less than 1'),
	v.ltValue(1, 'must be greater than 0 and less than 1'),
)

const scrollMomentumMinVelocitySchema = v.pipe(finiteNumber, v.minValue(0, 'must be >= 0'))

const scrollSendIntervalMsSchema = v.pipe(finiteNumber, v.minValue(0, 'must be >= 0'))

const scrollMomentumOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	friction: v.optional(scrollMomentumFrictionSchema),
	minVelocity: v.optional(scrollMomentumMinVelocitySchema),
})

const scrollMomentumResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	friction: scrollMomentumFrictionSchema,
	minVelocity: scrollMomentumMinVelocitySchema,
})

const scrollOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	strategy: v.optional(scrollStrategySchema),
	speedMultiplier: v.optional(finiteNumber),
	linesPerWheel: v.optional(finiteNumber),
	momentum: v.optional(scrollMomentumOverridesSchema),
	maxLinesPerSend: v.optional(finiteNumber),
	sendIntervalMs: v.optional(scrollSendIntervalMsSchema),
})

const scrollResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	strategy: scrollStrategySchema,
	speedMultiplier: finiteNumber,
	linesPerWheel: finiteNumber,
	momentum: scrollMomentumResolvedSchema,
	maxLinesPerSend: finiteNumber,
	sendIntervalMs: scrollSendIntervalMsSchema,
})

const doubleTapOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	data: v.optional(v.string()),
	maxInterval: v.optional(finiteNumber),
})

const doubleTapResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	data: v.string(),
	maxInterval: finiteNumber,
})

const gestureOverridesSchema = v.strictObject({
	swipe: v.optional(swipeOverridesSchema),
	pinch: v.optional(pinchOverridesSchema),
	scroll: v.optional(scrollOverridesSchema),
	doubleTap: v.optional(doubleTapOverridesSchema),
})

const gestureResolvedSchema = v.strictObject({
	swipe: swipeResolvedSchema,
	pinch: pinchResolvedSchema,
	scroll: scrollResolvedSchema,
	doubleTap: doubleTapResolvedSchema,
})

// --- Mobile ---

const keyboardModeSchema = v.picklist(['auto', 'manual'])

const mobileOverridesSchema = v.strictObject({
	initData: v.optional(v.nullable(v.string())),
	widthThreshold: v.optional(finiteNumber),
	keyboardMode: v.optional(keyboardModeSchema),
})

const mobileResolvedSchema = v.strictObject({
	initData: v.nullable(v.string()),
	widthThreshold: finiteNumber,
	keyboardMode: keyboardModeSchema,
})

// --- Floating buttons ---

const floatingPositionSchema = v.picklist([
	'top-left',
	'top-right',
	'top-centre',
	'bottom-left',
	'bottom-right',
	'bottom-centre',
	'centre-left',
	'centre-right',
])

const floatingDirectionSchema = v.picklist(['row', 'column'])

const floatingButtonGroupSchema = v.strictObject({
	position: floatingPositionSchema,
	direction: v.optional(floatingDirectionSchema),
	buttons: v.array(controlButtonSchema),
})

// --- Scroll buttons ---

const scrollButtonsOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
})

const scrollButtonsResolvedSchema = v.strictObject({
	enabled: v.boolean(),
})

// --- PWA ---

const pwaOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	shortName: v.optional(v.string()),
	themeColor: v.optional(v.string()),
})

const pwaResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	shortName: v.optional(v.string()),
	themeColor: v.string(),
})

// --- Reconnect ---

const reconnectOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
})

const reconnectResolvedSchema = v.strictObject({
	enabled: v.boolean(),
})

// --- ASR ---

const asrProviderSchema = v.literal('doubao')

const doubaoAsrOverridesSchema = v.strictObject({
	apiKey: v.optional(v.string()),
	resourceId: v.optional(v.string()),
})

function asrApiKeyCheck<T extends Record<string, unknown>>() {
	return v.rawCheck<T>(({ dataset, addIssue }) => {
		if (!dataset.typed || !isRecord(dataset.value) || dataset.value.enabled !== true) return
		const doubao = dataset.value.doubao
		const doubaoRecord = isRecord(doubao) ? doubao : {}
		const apiKey = doubaoRecord.apiKey
		if (typeof apiKey === 'string' && apiKey.length > 0) return
		addIssue({
			message: 'ASR apiKey must be a non-empty string when enabled',
			expected: 'non-empty string',
			input: apiKey,
			path: [
				{ type: 'object', origin: 'value', input: dataset.value, key: 'doubao', value: doubao },
				{ type: 'object', origin: 'value', input: doubaoRecord, key: 'apiKey', value: apiKey },
			],
		})
	})
}

const asrOverridesBaseSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	provider: v.optional(asrProviderSchema),
	doubao: v.optional(doubaoAsrOverridesSchema),
	autoEnter: v.optional(v.boolean()),
})
const asrOverridesSchema = v.pipe(
	asrOverridesBaseSchema,
	asrApiKeyCheck<v.InferOutput<typeof asrOverridesBaseSchema>>(),
)

const doubaoAsrResolvedSchema = v.strictObject({
	apiKey: v.string(),
	resourceId: v.string(),
})

const asrResolvedBaseSchema = v.strictObject({
	enabled: v.boolean(),
	provider: asrProviderSchema,
	doubao: doubaoAsrResolvedSchema,
	autoEnter: v.boolean(),
})
const asrResolvedSchema = v.pipe(
	asrResolvedBaseSchema,
	asrApiKeyCheck<v.InferOutput<typeof asrResolvedBaseSchema>>(),
)

// --- Top-level schemas ---

function voiceInputAction(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value) || !isRecord(value.action)) return undefined
	return value.action.type === 'voice-input' ? value.action : undefined
}

function addVoiceInputButtonIssues<T>(
	addIssue: v.RawCheckAddIssue<T>,
	buttons: readonly unknown[],
	basePath: readonly [v.IssuePathItem, ...v.IssuePathItem[]],
): void {
	for (let buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
		const button = buttons[buttonIndex]
		const action = voiceInputAction(button)
		if (!action || !isRecord(button)) continue
		const path: [v.IssuePathItem, ...v.IssuePathItem[]] = [
			...basePath,
			{
				type: 'array',
				origin: 'value',
				input: buttons,
				key: buttonIndex,
				value: button,
			},
			{
				type: 'object',
				origin: 'value',
				input: button,
				key: 'action',
				value: action,
			},
			{
				type: 'object',
				origin: 'value',
				input: action,
				key: 'type',
				value: action.type,
			},
		]
		addIssue({
			message: 'voice-input action is only allowed in toolbar buttons',
			path,
		})
	}
}

function voiceInputPlacementCheck<T extends Record<string, unknown>>() {
	return v.rawCheck<T>(({ dataset, addIssue }) => {
		if (!dataset.typed || !isRecord(dataset.value)) return
		const value = dataset.value
		const drawer = isRecord(value.drawer) ? value.drawer : undefined
		if (drawer && Array.isArray(drawer.buttons)) {
			addVoiceInputButtonIssues(addIssue, drawer.buttons, [
				{ type: 'object', origin: 'value', input: value, key: 'drawer', value: drawer },
				{ type: 'object', origin: 'value', input: drawer, key: 'buttons', value: drawer.buttons },
			])
		}
		const floatingButtons = value.floatingButtons
		if (!Array.isArray(floatingButtons)) return
		for (let index = 0; index < floatingButtons.length; index++) {
			const group = floatingButtons[index]
			if (!isRecord(group) || !Array.isArray(group.buttons)) continue
			addVoiceInputButtonIssues(addIssue, group.buttons, [
				{
					type: 'object',
					origin: 'value',
					input: value,
					key: 'floatingButtons',
					value: floatingButtons,
				},
				{
					type: 'array',
					origin: 'value',
					input: floatingButtons,
					key: index,
					value: group,
				},
				{ type: 'object', origin: 'value', input: group, key: 'buttons', value: group.buttons },
			])
		}
	})
}

const notifyVapidOverridesSchema = v.strictObject({
	subject: v.optional(v.string()),
	publicKey: v.optional(v.string()),
	privateKey: v.optional(v.string()),
})

const notifySilenceOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	busyMs: v.optional(finiteNumber),
	quietMs: v.optional(finiteNumber),
	cooldownMs: v.optional(finiteNumber),
})

const notifyOverridesSchema = v.strictObject({
	token: v.optional(v.string()),
	vapid: v.optional(notifyVapidOverridesSchema),
	history: v.optional(v.strictObject({ limit: v.optional(finiteNumber) })),
	silence: v.optional(notifySilenceOverridesSchema),
})

const notifyVapidResolvedSchema = v.strictObject({
	subject: v.optional(v.string()),
	publicKey: v.optional(v.string()),
	privateKey: v.optional(v.string()),
})

const notifySilenceResolvedSchema = v.strictObject({
	enabled: v.boolean(),
	busyMs: finiteNumber,
	quietMs: finiteNumber,
	cooldownMs: finiteNumber,
})

const notifyResolvedSchema = v.strictObject({
	token: v.optional(v.string()),
	vapid: notifyVapidResolvedSchema,
	history: v.strictObject({ limit: finiteNumber }),
	silence: notifySilenceResolvedSchema,
})

const herdwebConfigOverridesBaseSchema = v.strictObject({
	name: v.optional(v.string()),
	theme: v.optional(termThemeOverridesSchema),
	font: v.optional(fontOverridesSchema),
	toolbar: v.optional(
		v.strictObject({
			row1: v.optional(buttonArrayInputSchema),
			row2: v.optional(buttonArrayInputSchema),
		}),
	),
	drawer: v.optional(
		v.strictObject({
			buttons: v.optional(buttonArrayInputSchema),
		}),
	),
	gestures: v.optional(gestureOverridesSchema),
	mobile: v.optional(mobileOverridesSchema),
	floatingButtons: v.optional(v.array(floatingButtonGroupSchema)),
	scrollButtons: v.optional(scrollButtonsOverridesSchema),
	pwa: v.optional(pwaOverridesSchema),
	reconnect: v.optional(reconnectOverridesSchema),
	asr: v.optional(asrOverridesSchema),
	notify: v.optional(notifyOverridesSchema),
})

/** Schema for config overrides (all fields optional, button arrays accept array | function) */
export const herdwebConfigOverridesSchema = v.pipe(
	herdwebConfigOverridesBaseSchema,
	voiceInputPlacementCheck<v.InferOutput<typeof herdwebConfigOverridesBaseSchema>>(),
)

/** Schema for fully resolved config (all required fields, plain button arrays) */
const herdwebConfigResolvedBaseSchema = v.strictObject({
	name: v.string(),
	theme: termThemeResolvedSchema,
	font: fontResolvedSchema,
	toolbar: v.strictObject({
		row1: v.array(controlButtonSchema),
		row2: v.array(controlButtonSchema),
	}),
	drawer: v.strictObject({
		buttons: v.array(controlButtonSchema),
	}),
	gestures: gestureResolvedSchema,
	mobile: mobileResolvedSchema,
	floatingButtons: v.array(floatingButtonGroupSchema),
	scrollButtons: scrollButtonsResolvedSchema,
	pwa: pwaResolvedSchema,
	reconnect: reconnectResolvedSchema,
	asr: asrResolvedSchema,
	notify: notifyResolvedSchema,
})

export const herdwebConfigResolvedSchema = v.pipe(
	herdwebConfigResolvedBaseSchema,
	voiceInputPlacementCheck<v.InferOutput<typeof herdwebConfigResolvedBaseSchema>>(),
)
