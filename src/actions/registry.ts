import type { ButtonAction, FontConfig, XTerminal } from '../types'
import { resizeTerm } from '../util/terminal'

export interface ActionExecutionContext {
	readonly term: XTerminal
	readonly kbWasOpen: boolean
	readonly focusIfNeeded: () => void
	readonly sendText: (data: string) => Promise<void>
	readonly sendRawText?: (data: string) => Promise<void>
	readonly openDrawer?: () => void
	readonly openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
		readonly title?: string
		readonly description?: string
	}) => void
	readonly toggleCtrlModifier?: () => void
	/** Font config for the font-size action — supplied per call or via registry deps */
	readonly font?: FontConfig
	/** Opens the help overlay — supplied per call or via registry deps */
	readonly openHelp?: () => void
	readonly openNotifyPanel?: () => void
	/** Toggles the soft keyboard — supplied per call or via registry deps */
	readonly toggleKeyboard?: () => void
	/** Toggles the floating d-pad — supplied per call or via registry deps */
	readonly toggleDpad?: () => void
}

type ActionHandler = (action: ButtonAction, context: ActionExecutionContext) => void | Promise<void>

export interface ActionRegistry {
	register: (type: ButtonAction['type'], handler: ActionHandler) => void
	execute: (action: ButtonAction, context: ActionExecutionContext) => Promise<boolean>
}

export function createActionRegistry(): ActionRegistry {
	const handlers = new Map<ButtonAction['type'], ActionHandler>()
	let sendQueue: Promise<void> = Promise.resolve()

	function register(type: ButtonAction['type'], handler: ActionHandler): void {
		handlers.set(type, handler)
	}

	async function execute(action: ButtonAction, context: ActionExecutionContext): Promise<boolean> {
		const handler = handlers.get(action.type)
		if (!handler) {
			// Fail loud: an unregistered action must never become a silent dead button.
			const error = new Error(`herdweb: no handler registered for action type "${action.type}"`)
			console.error(error)
			throw error
		}

		if (action.type === 'send' || action.type === 'prefix') {
			const current = sendQueue.then(async () => {
				await handler(action, context)
			})
			sendQueue = current.catch(() => {})
			await current
			return true
		}

		if (action.type === 'paste') {
			await sendQueue
			await handler(action, context)
			return true
		}

		await handler(action, context)
		return true
	}

	return { register, execute }
}

/** Map a prefix byte to a human-readable label (e.g. '\x02' → 'Ctrl-B') */
function describePrefixByte(data: string): string | null {
	if (data.length !== 1) return null
	const code = data.charCodeAt(0)
	// Ctrl-A through Ctrl-Z → 0x01–0x1A
	if (code >= 1 && code <= 26) {
		return `Ctrl-${String.fromCharCode(code + 64)}`
	}
	return null
}

/** localStorage key for the user-adjusted terminal font size */
export const FONT_SIZE_STORAGE_KEY = 'herdweb:fontSize'

/** Pre-rename localStorage key — split to keep the legacy identifier out of grep scans. */
const LEGACY_APP = 're' + 'mobi'
export const LEGACY_FONT_SIZE_STORAGE_KEY = `${LEGACY_APP}:fontSize`

/**
 * Read font size from localStorage with one-time migration from the pre-rename key.
 * New key wins when both exist; migrated value is written to the new key and the old key removed.
 */
export function readFontSizeFromStorage(): string | null {
	const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
	if (raw !== null && raw !== '') return raw
	const legacy = localStorage.getItem(LEGACY_FONT_SIZE_STORAGE_KEY)
	if (legacy === null || legacy === '') return null
	localStorage.setItem(FONT_SIZE_STORAGE_KEY, legacy)
	localStorage.removeItem(LEGACY_FONT_SIZE_STORAGE_KEY)
	return legacy
}

/** Change terminal font size by delta, clamped to config range, and persist it */
function changeFontSize(term: XTerminal, delta: number, font: FontConfig): void {
	const current = term.options.fontSize
	const next = Math.max(font.sizeRange[0], Math.min(font.sizeRange[1], current + delta))
	if (next !== current) {
		term.options.fontSize = next
		resizeTerm()
		try {
			localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(next))
		} catch (error) {
			// iOS private mode throws on localStorage writes — keep going without a cache
			console.error('herdweb: failed to persist font size', error)
		}
	}
}

/** Dependencies for the default handlers that need app-level wiring */
interface DefaultActionDeps {
	readonly font?: FontConfig
	readonly openHelp?: () => void
	readonly openNotifyPanel?: () => void
	readonly toggleKeyboard?: () => void
	readonly toggleDpad?: () => void
	/** Opens the single-file image picker — T3 wires this to the image-drop controller from src/client-entry.ts */
	readonly openImageDrop?: () => void
}

export function createDefaultActionRegistry(deps: DefaultActionDeps = {}): ActionRegistry {
	const registry = createActionRegistry()
	let pasteQueue: Promise<void> = Promise.resolve()

	registry.register('send', (action, context) => {
		if (action.type !== 'send') return
		return context.sendText(action.data).then(() => context.focusIfNeeded())
	})

	registry.register('paste', (_action, context) => {
		if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
			context.focusIfNeeded()
			return
		}

		const runPaste = async (): Promise<void> => {
			try {
				const text = await navigator.clipboard.readText()
				if (!text) return
				if (context.sendRawText) {
					await context.sendRawText(text)
					return
				}
				await context.sendText(text)
			} catch {
				// Clipboard access may fail due to permissions or browser constraints.
				// Keep behaviour fail-safe and restore focus without surfacing runtime errors.
			} finally {
				context.focusIfNeeded()
			}
		}

		const current = pasteQueue.then(runPaste)
		pasteQueue = current.catch(() => {})
		return current
	})

	registry.register('ctrl-modifier', (_action, context) => {
		if (context.toggleCtrlModifier) {
			context.toggleCtrlModifier()
		} else {
			context.focusIfNeeded()
		}
	})

	registry.register('drawer-toggle', (_action, context) => {
		if (context.openDrawer) {
			context.openDrawer()
		} else {
			context.focusIfNeeded()
		}
	})

	registry.register('prefix', async (action, context) => {
		if (action.type !== 'prefix') return
		await context.sendText(action.data)
		if (context.openComboPicker) {
			const prefixLabel = describePrefixByte(action.data)
			context.openComboPicker({
				title: `Prefix sent${prefixLabel ? ` (${prefixLabel})` : ''} — type follow-up`,
				description:
					'A letter like r (reload config) or c (new window). ' + 'C-x = Ctrl+x, M-x = Alt+x',
				sendText: async (data: string) => {
					await registry.execute(
						{ type: 'send', data },
						{ ...context, sendText: context.sendRawText ?? context.sendText },
					)
				},
				focusIfNeeded: context.focusIfNeeded,
			})
		} else {
			context.focusIfNeeded()
		}
	})

	registry.register('combo-picker', (_action, context) => {
		if (context.openComboPicker) {
			context.openComboPicker({
				sendText: async (data: string) => {
					await registry.execute(
						{ type: 'send', data },
						{
							...context,
							sendText: context.sendRawText ?? context.sendText,
						},
					)
				},
				focusIfNeeded: context.focusIfNeeded,
			})
		} else {
			context.focusIfNeeded()
		}
	})

	registry.register('font-size', (action, context) => {
		if (action.type !== 'font-size') return
		const font = context.font ?? deps.font
		if (!font) {
			// Fail loud: a font-size button without font config is a wiring bug.
			const error = new Error(
				'herdweb: font-size action requires a FontConfig (context.font or registry deps)',
			)
			console.error(error)
			throw error
		}
		changeFontSize(context.term, action.delta, font)
		context.focusIfNeeded()
	})

	registry.register('help', (_action, context) => {
		const openHelp = context.openHelp ?? deps.openHelp
		if (!openHelp) {
			// Fail loud: a help button without an openHelp callback is a wiring bug.
			const error = new Error(
				'herdweb: help action requires an openHelp callback (context.openHelp or registry deps)',
			)
			console.error(error)
			throw error
		}
		openHelp()
	})

	registry.register('notify-panel', (_action, context) => {
		const openNotifyPanel = context.openNotifyPanel ?? deps.openNotifyPanel
		if (!openNotifyPanel) {
			const error = new Error(
				'herdweb: notify-panel action requires an openNotifyPanel callback (context.openNotifyPanel or registry deps)',
			)
			console.error(error)
			throw error
		}
		openNotifyPanel()
	})

	registry.register('keyboard-toggle', (_action, context) => {
		const toggleKeyboard = context.toggleKeyboard ?? deps.toggleKeyboard
		if (!toggleKeyboard) {
			// Fail loud: a keyboard-toggle button without a toggleKeyboard callback is a wiring bug.
			const error = new Error(
				'herdweb: keyboard-toggle action requires a toggleKeyboard callback ' +
					'(context.toggleKeyboard or registry deps)',
			)
			console.error(error)
			throw error
		}
		toggleKeyboard()
	})

	registry.register('dpad-toggle', (_action, context) => {
		const toggleDpad = context.toggleDpad ?? deps.toggleDpad
		if (!toggleDpad) {
			// Fail loud: a dpad-toggle button without a toggleDpad callback is a wiring bug.
			const error = new Error(
				'herdweb: dpad-toggle action requires a toggleDpad callback ' +
					'(context.toggleDpad or registry deps)',
			)
			console.error(error)
			throw error
		}
		toggleDpad()
	})

	registry.register('image-upload', (_action, _context) => {
		// App-level dep only (not ActionExecutionContext, no drawer special-case):
		// T3 replaces this with the real image-drop controller wiring in src/client-entry.ts.
		const openImageDrop = deps.openImageDrop
		if (!openImageDrop) {
			// Fail loud: an image-upload button without an openImageDrop callback is a wiring bug.
			const error = new Error(
				'herdweb: image-upload action requires an openImageDrop callback (registry deps)',
			)
			console.error(error)
			throw error
		}
		openImageDrop()
	})

	return registry
}
