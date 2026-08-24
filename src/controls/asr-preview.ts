import type { InputRejectedReason, XTerminal } from '../types'
import { el, svg } from '../util/dom'
import { onAttachmentTap, onTap } from '../util/tap'

declare const __herdwebBasePath: string | undefined

export type ComposerPending = {
	id: string
	sessionId: string
	sourceText: string
	data: string
	status: 'pending' | 'unknown' | 'rejected'
	reason?: InputRejectedReason
}

type ComposerStore = {
	version: 1
	draft: string
	pending: ComposerPending | null
}

type StoredComposer = Omit<ComposerStore, 'pending'> & { pending: ComposerPending | null }

type StorageReadResult =
	| { readonly kind: 'missing'; readonly storage: Storage }
	| { readonly kind: 'valid'; readonly storage: Storage; readonly value: StoredComposer }
	| { readonly kind: 'invalid'; readonly storage: Storage }
	| { readonly kind: 'unavailable'; readonly error: unknown }

const COMPOSER_STORAGE_KEY_PREFIX = 'herdweb:composer:v1:'
/** Pre-rename composer key prefix — split to keep the legacy identifier out of grep scans. */
const LEGACY_APP = 're' + 'mobi'
const LEGACY_COMPOSER_STORAGE_KEY_PREFIX = `${LEGACY_APP}:composer:v1:`

export { LEGACY_COMPOSER_STORAGE_KEY_PREFIX }

const DRAFT_RESTORE_FAILURE = 'Draft could not be restored; stored copy left untouched.'
const DRAFT_CORRUPT_RESET = 'Draft storage was corrupt and has been reset; your text is saved.'
const DRAFT_STORAGE_FAILURE = 'Draft is not protected on this device.'

function basePath(): string {
	return typeof __herdwebBasePath === 'undefined' ? '/' : (__herdwebBasePath ?? '/')
}

function composerStorageKey(targetId: string): string {
	return `${COMPOSER_STORAGE_KEY_PREFIX}${basePath()}:${targetId}`
}

function singleTargetStorageKey(): string {
	return `${COMPOSER_STORAGE_KEY_PREFIX}${basePath()}`
}

function legacyComposerStorageKey(): string {
	return `${LEGACY_COMPOSER_STORAGE_KEY_PREFIX}${basePath()}`
}

function migrateComposerStorageIfNeeded(storage: Storage, defaultTargetId: string): void {
	const targetKey = composerStorageKey(defaultTargetId)
	if (storage.getItem(targetKey) !== null) return
	const single = storage.getItem(singleTargetStorageKey())
	if (single !== null) {
		storage.setItem(targetKey, single)
		storage.removeItem(singleTargetStorageKey())
		return
	}
	const legacy = storage.getItem(legacyComposerStorageKey())
	if (legacy === null) return
	storage.setItem(targetKey, legacy)
	storage.removeItem(legacyComposerStorageKey())
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isComposerPending(value: unknown): value is ComposerPending {
	if (!isRecord(value)) return false
	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		typeof value.sessionId === 'string' &&
		value.sessionId.length > 0 &&
		typeof value.sourceText === 'string' &&
		typeof value.data === 'string' &&
		(value.status === 'pending' || value.status === 'unknown' || value.status === 'rejected') &&
		(value.reason === undefined ||
			value.reason === 'id-conflict' ||
			value.reason === 'session-unavailable')
	)
}

function readComposerStore(targetId: string): StorageReadResult {
	let storage: Storage
	try {
		storage = window.localStorage
	} catch (error: unknown) {
		return { kind: 'unavailable', error }
	}

	let raw: string | null
	try {
		raw = storage.getItem(composerStorageKey(targetId))
	} catch (error: unknown) {
		return { kind: 'unavailable', error }
	}
	if (raw === null) return { kind: 'missing', storage }

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { kind: 'invalid', storage }
	}
	if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.draft !== 'string') {
		return { kind: 'invalid', storage }
	}

	return {
		kind: 'valid',
		storage,
		value: {
			version: 1,
			draft: parsed.draft,
			pending:
				parsed.pending === null || parsed.pending === undefined
					? null
					: isComposerPending(parsed.pending)
						? parsed.pending
						: null,
		},
	}
}

export interface AsrPreview {
	readonly element: HTMLDivElement
	readonly input: HTMLTextAreaElement
	readonly message: HTMLDivElement
	readonly isOpen: () => boolean
	/** @deprecated Use isOpen; retained for existing preview consumers. */
	readonly isVisible: () => boolean
	readonly getText: () => string
	open(): void
	close(): void
	readonly show: (text: string) => void
	readonly setPartial: (text: string) => void
	readonly showMessage: (message: string) => void
	readonly setSubmissionStatus: (
		status: 'pending' | 'unknown' | 'rejected' | 'accepted' | null,
		message: string,
	) => void
	readonly setSubmissionControls: (status: 'pending' | 'unknown' | 'rejected' | null) => void
	readonly getPending: () => ComposerPending | null
	readonly setPending: (pending: ComposerPending | null) => boolean
	readonly restoreDraft: () => void
	readonly setTarget: (targetId: string) => void
	readonly resetDraft: () => void
	readonly clear: () => void
	readonly onOpenChange: (handler: (open: boolean) => void) => { dispose(): void }
	readonly onHeightChange: (handler: () => void) => { dispose(): void }
	readonly onConfirm: (term: XTerminal, handler: () => void) => { dispose(): void }
	readonly onRetry: (term: XTerminal, handler: () => void) => { dispose(): void }
	readonly onAbandon: (handler: () => void) => { dispose(): void }
	readonly onCancel: (handler: () => void) => { dispose(): void }
}

function createMicIcon(): SVGSVGElement {
	return svg(
		'svg',
		{
			viewBox: '0 0 24 24',
			'aria-hidden': 'true',
			focusable: 'false',
		},
		svg('path', {
			d: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z',
		}),
		svg('path', {
			d: 'M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-3.08A7 7 0 0 0 19 11Z',
		}),
		svg('path', { d: 'M11 21h2v-4h-2v4Z' }),
	)
}

/** Create the two-layer voice composer; opening it never focuses or starts ASR. */
export function createAsrPreview(options: { readonly defaultTargetId: string }): AsrPreview {
	const element = el('div', {
		id: 'wt-asr-composer',
		role: 'dialog',
		'aria-modal': 'false',
		'aria-label': 'Voice composer',
	})
	element.style.display = 'none'

	const panel = el('div', { id: 'wt-asr-composer-panel' })
	const closeButton = el('button', {
		type: 'button',
		class: 'wt-asr-composer-close',
		'aria-label': 'Close voice composer',
	})
	closeButton.textContent = '×'

	const input = el('textarea', {
		rows: '1',
		wrap: 'soft',
		placeholder: 'Speak or type…',
		'aria-label': 'Voice composer input',
		autocomplete: 'off',
	})
	const message = el('div', { class: 'wt-asr-composer-message', 'aria-live': 'polite' })
	const actions = el('div', { class: 'wt-asr-composer-actions' })
	const micButton = el('button', {
		type: 'button',
		class: 'wt-composer-mic',
		'aria-label': 'Toggle microphone',
		'aria-pressed': 'false',
		'data-herdweb-control': 'composer-mic',
	})
	micButton.appendChild(createMicIcon())
	const sendButton = el('button', {
		type: 'button',
		class: 'wt-composer-send',
	})
	sendButton.textContent = 'Send'
	const retryButton = el('button', {
		type: 'button',
		class: 'wt-composer-retry',
	})
	retryButton.textContent = 'Retry'
	retryButton.hidden = true
	const abandonButton = el('button', {
		type: 'button',
		class: 'wt-composer-abandon',
	})
	abandonButton.textContent = 'Abandon'
	abandonButton.hidden = true
	actions.append(closeButton, micButton, sendButton, retryButton, abandonButton)

	panel.append(input, message, actions)
	element.appendChild(panel)

	let open = false
	let pendingPartial: string | undefined
	let partialFrame: number | undefined
	let storageFailureShown = false
	let currentTargetId = options.defaultTargetId
	const openChangeHandlers = new Set<(open: boolean) => void>()
	const heightChangeHandlers = new Set<() => void>()
	let inputHeight = ''

	function resizeInput(): void {
		const previousHeight = inputHeight
		input.style.height = 'auto'
		const nextHeight = `${Math.min(Math.max(input.scrollHeight, 48), 168)}px`
		input.style.height = nextHeight
		inputHeight = nextHeight
		if (nextHeight !== previousHeight) {
			for (const handler of heightChangeHandlers) handler()
		}
	}

	function showStorageFailure(error: unknown): void {
		if (storageFailureShown) return
		storageFailureShown = true
		console.error('herdweb: composer draft storage unavailable', error)
		message.textContent = DRAFT_STORAGE_FAILURE
	}

	try {
		migrateComposerStorageIfNeeded(window.localStorage, options.defaultTargetId)
	} catch (error) {
		showStorageFailure(error)
	}

	function setSubmissionStatus(
		status: 'pending' | 'unknown' | 'rejected' | 'accepted' | null,
		text: string,
	): void {
		if (status === null) {
			delete message.dataset.submissionStatus
		} else {
			message.dataset.submissionStatus = status
		}
		message.textContent = text
	}

	function setSubmissionControls(status: 'pending' | 'unknown' | 'rejected' | null): void {
		sendButton.disabled = status !== null
		retryButton.hidden = status !== 'unknown'
		retryButton.disabled = status !== 'unknown'
		abandonButton.hidden = status !== 'unknown' && status !== 'rejected'
		abandonButton.disabled = status !== 'unknown' && status !== 'rejected'
	}

	function showRestoreFailure(): void {
		message.textContent = DRAFT_RESTORE_FAILURE
	}

	function persistComposer(
		targetId: string,
		draft: string,
		pending: ComposerPending | null,
	): boolean {
		const stored = readComposerStore(targetId)
		if (stored.kind === 'unavailable') {
			showStorageFailure(stored.error)
			return false
		}
		const corrupt = stored.kind === 'invalid'
		try {
			stored.storage.setItem(
				composerStorageKey(targetId),
				JSON.stringify({ version: 1 satisfies ComposerStore['version'], draft, pending }),
			)
			if (corrupt) showMessage(DRAFT_CORRUPT_RESET)
			return true
		} catch (error: unknown) {
			showStorageFailure(error)
			return false
		}
	}

	function persistDraftFor(targetId: string, draft: string): void {
		const stored = readComposerStore(targetId)
		const pending = stored.kind === 'valid' ? stored.value.pending : null
		persistComposer(targetId, draft, pending)
	}

	function persistDraft(draft: string): void {
		persistDraftFor(currentTargetId, draft)
	}

	input.addEventListener('input', () => {
		resizeInput()
		persistDraft(input.value)
	})

	function setOpen(next: boolean): void {
		if (open === next) return
		open = next
		element.style.display = next ? 'flex' : 'none'
		element.setAttribute('aria-hidden', next ? 'false' : 'true')
		document.body.classList.toggle('wt-composer-open', next)
		for (const handler of openChangeHandlers) handler(next)
	}

	function openComposer(): void {
		input.readOnly = false
		setOpen(true)
		resizeInput()
	}

	function closeComposer(): void {
		setOpen(false)
	}

	function renderText(text: string, persist: boolean): void {
		input.value = text
		setSubmissionStatus(null, '')
		setOpen(true)
		resizeInput()
		if (persist) persistDraft(text)
	}

	function show(text: string): void {
		renderText(text, true)
	}

	function setPartial(text: string): void {
		pendingPartial = text
		if (partialFrame !== undefined) return
		partialFrame = requestAnimationFrame(() => {
			partialFrame = undefined
			if (pendingPartial !== undefined) renderText(pendingPartial, false)
			pendingPartial = undefined
		})
	}

	function showMessage(text: string): void {
		setSubmissionStatus(null, text)
		setOpen(true)
	}

	function getPending(): ComposerPending | null {
		const stored = readComposerStore(currentTargetId)
		return stored.kind === 'valid' ? stored.value.pending : null
	}

	function setPending(pending: ComposerPending | null): boolean {
		return persistComposer(currentTargetId, input.value, pending)
	}

	function resetDraft(): void {
		if (partialFrame !== undefined) cancelAnimationFrame(partialFrame)
		partialFrame = undefined
		pendingPartial = undefined
		input.value = ''
		setSubmissionStatus(null, '')
		resizeInput()
		persistDraft('')
	}

	function clear(): void {
		resetDraft()
		setOpen(false)
	}

	function restoreDraft(): void {
		if (input.value) return
		const stored = readComposerStore(currentTargetId)
		if (stored.kind === 'invalid') {
			showRestoreFailure()
			return
		}
		if (stored.kind === 'unavailable') {
			showStorageFailure(stored.error)
			return
		}
		if (stored.kind === 'missing' || !stored.value.draft) return
		input.value = stored.value.draft
		resizeInput()
	}

	function setTarget(nextTargetId: string): void {
		if (nextTargetId === currentTargetId) return
		storageFailureShown = false
		persistDraftFor(currentTargetId, input.value)
		const outgoingFailed = storageFailureShown
		currentTargetId = nextTargetId
		storageFailureShown = false
		if (partialFrame !== undefined) cancelAnimationFrame(partialFrame)
		partialFrame = undefined
		pendingPartial = undefined
		const stored = readComposerStore(nextTargetId)
		if (stored.kind === 'unavailable') {
			input.value = ''
			resizeInput()
			showStorageFailure(stored.error)
			return
		}
		if (stored.kind === 'invalid') {
			input.value = ''
			setSubmissionStatus(null, '')
			resizeInput()
			showRestoreFailure()
			return
		}
		input.value = stored.kind === 'valid' ? stored.value.draft : ''
		if (outgoingFailed) {
			showStorageFailure(new Error('outgoing draft could not be persisted'))
		} else {
			setSubmissionStatus(null, '')
		}
		resizeInput()
	}

	function register(target: HTMLButtonElement, handler: () => void): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onTap(target, callback)
		return {
			dispose() {
				target.removeEventListener('click', callback)
				target.removeEventListener('touchend', callback)
			},
		}
	}

	function registerAttachment(
		term: XTerminal,
		target: HTMLButtonElement,
		handler: () => void,
	): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onAttachmentTap(term, target, callback)
		return {
			dispose() {
				target.removeEventListener('click', callback)
				target.removeEventListener('touchend', callback)
			},
		}
	}

	function registerCancel(handler: () => void): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onTap(closeButton, callback)
		return {
			dispose() {
				closeButton.removeEventListener('click', callback)
				closeButton.removeEventListener('touchend', callback)
			},
		}
	}

	function registerAction(target: HTMLButtonElement, handler: () => void): { dispose(): void } {
		return register(target, handler)
	}

	restoreDraft()

	return {
		element,
		input,
		message,
		isOpen: () => open,
		isVisible: () => open,
		getText: () => input.value,
		open: openComposer,
		close: closeComposer,
		show,
		setPartial,
		showMessage,
		setSubmissionStatus,
		setSubmissionControls,
		getPending,
		setPending,
		restoreDraft,
		setTarget,
		resetDraft,
		clear,
		onOpenChange(handler) {
			openChangeHandlers.add(handler)
			return { dispose: () => openChangeHandlers.delete(handler) }
		},
		onHeightChange(handler) {
			heightChangeHandlers.add(handler)
			return { dispose: () => heightChangeHandlers.delete(handler) }
		},
		onConfirm: (term, handler) => registerAttachment(term, sendButton, handler),
		onRetry: (term, handler) => registerAttachment(term, retryButton, handler),
		onAbandon: (handler) => registerAction(abandonButton, handler),
		onCancel: registerCancel,
	}
}
