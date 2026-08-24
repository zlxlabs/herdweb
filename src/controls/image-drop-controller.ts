import { joinBasePath } from '../base-path'
import { X_HERDWEB_ATTACHMENT_ID_HEADER } from '../session-protocol'
import type { InputActionResult, XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

const IMAGE_DROP_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const IMAGE_DROP_ACK_TIMEOUT_MS = 15_000
const IMAGE_DROP_DONE_TOAST_MS = 2_500

type ImageDropState = 'idle' | 'uploading' | 'file-ready' | 'inserting' | 'done' | 'error'

interface ImageDropControllerDeps {
	readonly term: Pick<
		XTerminal,
		'isConnected' | 'onConnectionChange' | 'sendInputAction' | 'onInputActionResult'
	> &
		Pick<XTerminal, 'getAttachmentId' | 'getTargets' | 'getCurrentTargetId'>
	readonly basePath: string
	readonly fetchFn?: typeof fetch
	readonly clipboard?: { writeText(text: string): Promise<void> }
	readonly createActionId?: () => string
	readonly ackTimeoutMs?: number
}

export interface ImageDropController {
	readonly element: HTMLElement
	readonly open: () => void
	readonly dispose: () => void
}

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

	const invalidateStale = () => {
		if (state === 'done' || (path === null && state !== 'uploading' && state !== 'inserting'))
			return
		generation += 1
		clearAckTimer()
		actionId = path = null
		setState('error', 'Upload became stale — choose the image again.')
	}
	const attachmentMatches = () =>
		startAttachmentId !== null && term.getAttachmentId?.() === startAttachmentId
	const ensureLive = () => {
		if (attachmentMatches() && term.isConnected()) return true
		invalidateStale()
		return false
	}
	const showNotReady = () =>
		setState(
			'error',
			imageDropEnabled ? 'Not ready — still syncing.' : 'Image upload disabled for this target.',
		)

	function attemptInsert(gen: number): void {
		if (path === null || actionId === null) return
		setState('inserting', 'Inserting path…')
		if (!term.sendInputAction(actionId, ` ${path} `)) {
			if (!ensureLive()) return
			setState('file-ready', 'Not sent — still syncing. Tap Retry insert.')
			return
		}
		if (!ensureLive()) return
		clearAckTimer()
		ackTimer = setTimeout(() => {
			ackTimer = undefined
			if (disposed || gen !== generation || state !== 'inserting') return
			if (!ensureLive()) return
			setState('file-ready', 'No confirmation from terminal — tap Retry insert.')
		}, ackTimeoutMs)
	}

	function maybeAutoInsert(gen: number): void {
		if (ensureLive()) attemptInsert(gen)
	}

	function failUpload(gen: number, message: string): void {
		if (!disposed && gen === generation) setState('error', message)
	}

	input.addEventListener('change', () => {
		const file = input.files?.[0]
		input.value = ''
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
			if (!ensureLive()) return
			path = null
			setState('done', 'Inserted into agent input.')
			const gen = generation
			ackTimer = setTimeout(() => {
				ackTimer = undefined
				if (disposed || gen !== generation || state !== 'done') return
				setState('idle', '')
			}, IMAGE_DROP_DONE_TOAST_MS)
		} else {
			if (!ensureLive()) return
			const reason = result.reason ? ` (${result.reason})` : ''
			setState('file-ready', `Insert rejected${reason} — tap Retry insert.`)
		}
	})

	const connection = term.onConnectionChange((connected) => {
		if (!disposed && (!connected || !attachmentMatches())) invalidateStale()
	})

	onTap(retryBtn, () => {
		if (state !== 'file-ready') return
		if (!ensureLive()) return
		attemptInsert(generation)
	})

	onTap(copyBtn, () => {
		if (path === null || !ensureLive()) return
		const gen = generation
		clipboard.writeText(path).then(
			() =>
				gen === generation && !disposed && ensureLive() && setState(state, 'Copied to clipboard.'),
			() =>
				gen === generation &&
				!disposed &&
				ensureLive() &&
				setState(state, 'Copy failed — select the path and copy it manually.'),
		)
	})

	onTap(closeBtn, () => {
		generation += 1
		clearAckTimer()
		path = null
		actionId = null
		setState('idle', '')
	})

	return {
		element: panel,
		open() {
			if (state === 'uploading' || state === 'inserting') return
			if (pickAttachment() === null) return showNotReady()
			input.click()
		},
		dispose() {
			disposed = true
			clearAckTimer()
			subscription.dispose()
			connection.dispose()
		},
	}
}
