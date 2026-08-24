import { joinBasePath } from '../base-path'
import { X_HERDWEB_ATTACHMENT_ID_HEADER } from '../session-protocol'
import type { InputActionResult, XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

/** Single-file accept list — UX only; the server re-verifies via magic bytes. */
const IMAGE_DROP_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
/** How long to wait for input-accepted before falling back to file-ready. */
const IMAGE_DROP_ACK_TIMEOUT_MS = 15_000
/** How long the success toast stays visible before the panel auto-hides. */
const IMAGE_DROP_DONE_TOAST_MS = 2_500

type ImageDropState = 'idle' | 'uploading' | 'file-ready' | 'inserting' | 'done' | 'error'

interface ImageDropControllerDeps {
	/** Synced/fresh signals — only these term bridge methods are used. */
	readonly term: Pick<XTerminal, 'isConnected' | 'sendInputAction' | 'onInputActionResult'> &
		Pick<XTerminal, 'getAttachmentId' | 'getTargets' | 'getCurrentTargetId'>
	readonly basePath: string
	/** Test seams — production defaults: fetch / navigator.clipboard / crypto.randomUUID. */
	readonly fetchFn?: typeof fetch
	readonly clipboard?: { writeText(text: string): Promise<void> }
	readonly createActionId?: () => string
	readonly ackTimeoutMs?: number
}

export interface ImageDropController {
	readonly element: HTMLElement
	/** Open the file picker — single-flight: ignored while uploading or inserting. */
	readonly open: () => void
	readonly dispose: () => void
}

/**
 * Image drop flow: POST the picked raw File to {basePath}/api/image-drop, then auto-insert
 * ` ${path} ` (never Enter) only when the starting attachment is unchanged and synced.
 * Success is a transient toast — status text only, auto-hiding after ~2.5s (the inserted
 * path in the agent input is the success evidence; nothing to close). Only failure states
 * show the path text and the retry/copy/close actions.
 * Async callbacks re-check generation + actionId so stale ACKs can't clear newer picks.
 */
export function createImageDropController(deps: ImageDropControllerDeps): ImageDropController {
	const fetchFn = deps.fetchFn ?? fetch
	const clipboard = deps.clipboard ?? navigator.clipboard
	const newActionId = deps.createActionId ?? (() => crypto.randomUUID())
	const ackTimeoutMs = deps.ackTimeoutMs ?? IMAGE_DROP_ACK_TIMEOUT_MS
	const term = deps.term

	const input = el('input', { type: 'file', accept: IMAGE_DROP_ACCEPT, hidden: '' })
	const status = el('div', { class: 'wt-image-drop-status', role: 'status', 'aria-live': 'polite' })
	const pathText = el('code', { class: 'wt-image-drop-path' })
	const retryBtn = el('button', { type: 'button', class: 'wt-image-drop-retry' }, 'Retry insert')
	const copyBtn = el('button', { type: 'button', class: 'wt-image-drop-copy' }, 'Copy path')
	const closeBtn = el('button', { type: 'button', class: 'wt-image-drop-close' }, 'Close')
	const actions = el('div', { class: 'wt-image-drop-actions' }, retryBtn, copyBtn, closeBtn)
	const panel = el('div', { id: 'wt-image-drop' }, status, pathText, actions, input)

	let state: ImageDropState = 'idle'
	let generation = 0
	let path: string | null = null
	let actionId: string | null = null
	let startAttachmentId: string | null = null
	let imageDropEnabled = false
	let ackTimer: ReturnType<typeof setTimeout> | undefined
	let disposed = false

	function setState(next: ImageDropState, message: string): void {
		state = next
		panel.style.display = next === 'idle' ? 'none' : 'flex'
		status.textContent = message
		// done is a bare toast: the path text and action buttons belong to failure states.
		const showDetails = path !== null && next !== 'done'
		pathText.style.display = showDetails ? '' : 'none'
		actions.style.display = showDetails ? '' : 'none'
		if (path !== null) pathText.textContent = path
		retryBtn.disabled = next !== 'file-ready'
	}

	function clearAckTimer(): void {
		if (ackTimer !== undefined) clearTimeout(ackTimer)
		ackTimer = undefined
	}

	function pickAttachment(): string | null {
		const targetId = term.getCurrentTargetId?.()
		const id = term.getAttachmentId?.() ?? null
		const target = term.getTargets?.().find((item) => item.id === targetId)
		imageDropEnabled = target?.capabilities.imageDrop === 'local-path'
		return id !== null && term.isConnected() && imageDropEnabled ? id : null
	}

	const attachmentMatches = () =>
		startAttachmentId !== null && term.getAttachmentId?.() === startAttachmentId
	const showNotReady = () =>
		setState(
			'error',
			imageDropEnabled ? 'Not ready — still syncing.' : 'Image upload disabled for this target.',
		)

	function attemptInsert(gen: number): void {
		if (path === null || actionId === null) return
		setState('inserting', 'Inserting path…')
		if (!term.sendInputAction(actionId, ` ${path} `)) {
			setState('file-ready', 'Not sent — still syncing. Tap Retry insert.')
			return
		}
		clearAckTimer()
		ackTimer = setTimeout(() => {
			ackTimer = undefined
			if (disposed || gen !== generation || state !== 'inserting') return
			setState('file-ready', 'No confirmation from terminal — tap Retry insert.')
		}, ackTimeoutMs)
	}

	function maybeAutoInsert(gen: number): void {
		if (!attachmentMatches() || !term.isConnected()) {
			path = null
			setState('error', 'Upload became stale — choose the image again.')
			return
		}
		attemptInsert(gen)
	}

	function failUpload(gen: number, message: string): void {
		if (!disposed && gen === generation) setState('error', message)
	}

	input.addEventListener('change', () => {
		const file = input.files?.[0]
		input.value = '' // reset so the same file can be re-selected
		generation += 1
		clearAckTimer()
		if (!file) {
			path = null
			setState('idle', '')
			return
		}
		const gen = generation
		actionId = `image-drop-${newActionId()}`
		const attachment = pickAttachment()
		if (attachment === null) {
			path = startAttachmentId = null
			showNotReady()
			return
		}
		startAttachmentId = attachment
		path = null
		setState('uploading', `Uploading ${file.name || 'image'}…`)
		fetchFn(joinBasePath(deps.basePath, '/api/image-drop'), {
			method: 'POST',
			body: file,
			headers: { [X_HERDWEB_ATTACHMENT_ID_HEADER]: attachment },
		}).then(
			(res) => {
				if (!res.ok) return failUpload(gen, `Upload failed (HTTP ${res.status}).`)
				res.json().then(
					(data: { path?: unknown }) => {
						const dropped = data.path
						if (typeof dropped !== 'string' || dropped.length === 0) {
							return failUpload(gen, 'Upload failed — server returned no path.')
						}
						if (disposed || gen !== generation) return
						path = dropped
						maybeAutoInsert(gen)
					},
					() => failUpload(gen, 'Upload failed — bad response.'),
				)
			},
			() => failUpload(gen, 'Upload failed — network error.'),
		)
	})

	const subscription = term.onInputActionResult((result: InputActionResult) => {
		if (disposed || result.id !== actionId || state !== 'inserting') return
		clearAckTimer()
		if (result.accepted) {
			setState('done', 'Inserted into agent input.')
			// Transient toast: auto-hide after ~2.5s, reusing the ACK timer slot. The
			// generation guard keeps a stale timer from hiding a newer pick or close.
			const gen = generation
			ackTimer = setTimeout(() => {
				ackTimer = undefined
				if (disposed || gen !== generation || state !== 'done') return
				setState('idle', '')
			}, IMAGE_DROP_DONE_TOAST_MS)
		} else {
			const reason = result.reason ? ` (${result.reason})` : ''
			setState('file-ready', `Insert rejected${reason} — tap Retry insert.`)
		}
	})

	onTap(retryBtn, () => {
		if (state !== 'file-ready') return
		if (!attachmentMatches()) {
			path = null
			setState('error', 'Attachment changed — choose the image again.')
			return
		}
		if (!term.isConnected()) {
			setState('file-ready', 'Not sent — still syncing.')
			return
		}
		attemptInsert(generation)
	})

	onTap(copyBtn, () => {
		if (path === null) return
		clipboard.writeText(path).then(
			() => setState(state, 'Copied to clipboard.'),
			() => setState(state, 'Copy failed — select the path and copy it manually.'),
		)
	})

	onTap(closeBtn, () => {
		generation += 1 // invalidate any in-flight upload or pending ACK
		clearAckTimer()
		path = null
		actionId = null
		setState('idle', '')
	})

	return {
		element: panel,
		open() {
			if (state === 'uploading' || state === 'inserting') return // single-flight
			if (pickAttachment() === null) return showNotReady()
			input.click()
		},
		dispose() {
			disposed = true
			clearAckTimer()
			subscription.dispose()
		},
	}
}
