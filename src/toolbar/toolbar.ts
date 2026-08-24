import { createDefaultActionRegistry } from '../actions/registry'
import type { ActionRegistry } from '../actions/registry'
import { decorateKeyboardToggleButton } from '../controls/keyboard-controller'
import type { MicController } from '../controls/mic-controller'
import type { HookRegistry } from '../hooks/registry'
import type { ControlButton, HerdwebConfig, XTerminal } from '../types'
import { el, svg } from '../util/dom'
import { haptic } from '../util/haptic'
import { conditionalFocus, isKeyboardOpen } from '../util/keyboard'
import { onTap } from '../util/tap'
import { createAttachmentGuard, sendData } from '../util/terminal'

/** Ctrl sticky modifier state */
interface CtrlState {
	active: boolean
	disposer: { dispose(): void } | null
	buttonEl: HTMLButtonElement | null
	/** Attachment generation captured when the modifier was activated (T4b). */
	generation: string | null | undefined
}

/** Create the ctrl modifier state manager */
function createCtrlState(): CtrlState {
	return { active: false, disposer: null, buttonEl: null, generation: undefined }
}

/** Create the inline composer icon used by the circular voice-input entry. */
function createComposerIcon(): SVGSVGElement {
	return svg(
		'svg',
		{
			viewBox: '0 0 24 24',
			'aria-hidden': 'true',
			focusable: 'false',
		},
		svg('path', {
			d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5h-5.4l-3.9 3.2V15H6.5A2.5 2.5 0 0 1 4 12.5v-7Z',
		}),
		svg('path', {
			d: 'M8 8.5h8M8 11.5h5',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-linecap': 'round',
			'stroke-width': '1.7',
		}),
	)
}

/** Activate ctrl sticky modifier */
function activateCtrl(state: CtrlState, term: XTerminal, theme: HerdwebConfig['theme']): void {
	if (!state.buttonEl) return
	state.active = true
	state.generation = term.getAttachmentId?.()
	state.buttonEl.style.background = theme.blue
	state.buttonEl.style.color = theme.background

	if (!state.disposer) {
		state.disposer = term.onData((data: string) => {
			// T4b: a pending modifier must never fire into a different attachment.
			if (state.active && term.getAttachmentId?.() === state.generation && data.length === 1) {
				const code = data.charCodeAt(0)
				deactivateCtrl(state, theme)
				if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
					sendData(term, String.fromCharCode(code & 0x1f))
				}
			}
		})
	}
}

/** Deactivate ctrl sticky modifier */
function deactivateCtrl(state: CtrlState, theme: HerdwebConfig['theme']): void {
	if (!state.buttonEl) return
	state.active = false
	state.buttonEl.style.background = theme.black
	state.buttonEl.style.color = theme.foreground

	if (state.disposer) {
		state.disposer.dispose()
		state.disposer = null
	}
}

/** Wire up a single button's click handler based on its action type */
function wireButton(
	button: HTMLButtonElement,
	def: ControlButton,
	term: XTerminal,
	ctrlState: CtrlState,
	config: HerdwebConfig,
	registry: ActionRegistry,
	hooks: HookRegistry,
	openDrawer: () => void,
	micController: MicController | undefined,
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
): void {
	if (def.action.type === 'voice-input') {
		if (!micController) throw new Error('herdweb: voice-input action requires a mic controller')
		micController.attachComposerToggle(button)
		return
	}

	onTap(button, () => {
		const kbWasOpen = isKeyboardOpen()
		haptic()
		// T4b: captures the attachment generation at tap time; delayed sends below
		// complete only while this generation is still current.
		const isGenerationCurrent = createAttachmentGuard(term)

		async function sendWithCtrlAware(data: string): Promise<void> {
			const before = await hooks.runBeforeSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data,
			})
			if (before.blocked) return
			if (!isGenerationCurrent()) return

			let nextData = before.data
			if (ctrlState.active && ctrlState.buttonEl) {
				deactivateCtrl(ctrlState, config.theme)
				if (nextData.length === 1) {
					const code = nextData.charCodeAt(0)
					if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
						nextData = String.fromCharCode(code & 0x1f)
					}
				}
			}

			sendData(term, nextData)
			await hooks.runAfterSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data: nextData,
			})
		}

		async function sendRaw(data: string): Promise<void> {
			const before = await hooks.runBeforeSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data,
			})
			if (before.blocked) return
			if (!isGenerationCurrent()) return

			sendData(term, before.data)
			await hooks.runAfterSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data: before.data,
			})
		}

		void registry
			.execute(def.action, {
				term,
				kbWasOpen,
				focusIfNeeded: () => conditionalFocus(term, kbWasOpen),
				sendText: sendWithCtrlAware,
				sendRawText: sendRaw,
				openDrawer,
				openComboPicker,
				toggleCtrlModifier: () => {
					if (ctrlState.active) {
						deactivateCtrl(ctrlState, config.theme)
					} else {
						activateCtrl(ctrlState, term, config.theme)
					}
					conditionalFocus(term, kbWasOpen)
				},
			})
			.catch((error) => {
				console.error('herdweb: toolbar action execution failed', error)
				button.classList.add('wt-action-error')
				conditionalFocus(term, kbWasOpen)
			})
	})
}

/** Build a row of buttons */
function buildRow(
	buttons: readonly ControlButton[],
	term: XTerminal,
	ctrlState: CtrlState,
	config: HerdwebConfig,
	registry: ActionRegistry,
	hooks: HookRegistry,
	openDrawer: () => void,
	micController: MicController | undefined,
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
): HTMLDivElement {
	const row = el('div', { class: 'wt-row' })

	for (const def of buttons) {
		if (def.action.type === 'voice-input' && !micController) continue
		const button = el('button')
		button.dataset.herdwebAction = def.action.type
		button.dataset.herdwebButtonId = def.id
		if (def.action.type === 'voice-input') {
			button.classList.add('wt-mic')
			button.appendChild(createComposerIcon())
		} else {
			button.textContent = def.label
		}
		if (def.action.type === 'ctrl-modifier') {
			ctrlState.buttonEl = button
		}
		if (def.action.type === 'keyboard-toggle') {
			decorateKeyboardToggleButton(button)
		}
		wireButton(
			button,
			def,
			term,
			ctrlState,
			config,
			registry,
			hooks,
			openDrawer,
			micController,
			openComboPicker,
		)
		row.appendChild(button)
	}

	return row
}

interface ToolbarResult {
	readonly element: HTMLDivElement
	readonly ctrlState: CtrlState
}

/** Create the toolbar; empty rows are skipped (single-row by default) */
export function createToolbar(
	term: XTerminal,
	config: HerdwebConfig,
	openDrawer: () => void,
	hooks: HookRegistry,
	actions: ActionRegistry = createDefaultActionRegistry(),
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
	micController?: MicController,
): ToolbarResult {
	const toolbar = el('div', { id: 'wt-toolbar' })
	const ctrlState = createCtrlState()

	for (const buttons of [config.toolbar.row1, config.toolbar.row2]) {
		if (buttons.length === 0) continue
		toolbar.appendChild(
			buildRow(
				buttons,
				term,
				ctrlState,
				config,
				actions,
				hooks,
				openDrawer,
				micController,
				openComboPicker,
			),
		)
	}

	// T4b: leaving the synced state (target switch, disconnect) cancels the
	// pending sticky modifier; persistent config is untouched.
	term.onConnectionStatusChange((status) => {
		if (status.state !== 'synced' && ctrlState.active) deactivateCtrl(ctrlState, config.theme)
	})

	return { element: toolbar, ctrlState }
}
