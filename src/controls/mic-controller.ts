import { DoubaoEngine } from '../asr/doubao/engine'
import type { AsrEngine, AsrErrorCode } from '../asr/types'
import type { HookRegistry } from '../hooks/registry'
import type { ConnectionStatus, HerdwebConfig, InputActionResult, XTerminal } from '../types'
import { haptic } from '../util/haptic'
import { conditionalFocus, isKeyboardOpen } from '../util/keyboard'
import { onTap } from '../util/tap'
import { createAttachmentGuard } from '../util/terminal'
import { type AsrPreview, type ComposerPending, createAsrPreview } from './asr-preview'
import { suppressSynthesisedMouse } from './keyboard-controller'

export type MicState =
	| 'idle'
	| 'permission-requesting'
	| 'connecting'
	| 'recording'
	| 'stopping'
	| 'waiting-final'
	| 'preview'
	| 'error'
	| 'cancelled'

export interface MicController {
	readonly preview: AsrPreview
	readonly state: MicState
	attachComposerToggle(button: HTMLButtonElement): void
	attachMicButton(button: HTMLButtonElement): void
	setTarget(targetId: string): void
	dispose(): void
}

interface MicControllerOptions {
	readonly term: XTerminal
	readonly config: HerdwebConfig
	readonly hooks: HookRegistry
	readonly engine?: AsrEngine
	readonly closeComposerOverlays?: () => void
}

const CONNECT_TIMEOUT_MS = 5_000
const WAITING_FINAL_TIMEOUT_MS = 3_000
const RESULT_DEADLINE_MS = 15_000
const NON_PRINTING_FORMAT_OR_SEPARATOR = /[\p{Cf}\p{Zl}\p{Zp}]/u
const TRAILING_WHITESPACE = /\s$/u

const ERROR_MESSAGES: Record<AsrErrorCode, string> = {
	unsupported: 'Voice input is not supported in this browser.',
	'permission-denied': 'Microphone permission was denied.',
	'audio-context': 'The audio capture context failed.',
	'audio-interrupted': 'Audio input was interrupted.',
	'unsupported-sample-rate': 'The microphone sample rate is unsupported.',
	'worklet-load-failed': 'The audio capture module failed to load.',
	'connection-failed': 'Voice service connection failed. Check the key and network.',
	'socket-closed': 'Voice service connection closed before the final result.',
	'protocol-error': 'Voice service returned an invalid response.',
	'provider-error': 'Voice service rejected the request.',
	'network-too-slow': 'Voice service is too slow to keep up with the microphone.',
}

/** Browser capability gate used before rendering a voice-input toolbar button. */
export function isVoiceInputSupported(): boolean {
	return (
		globalThis.isSecureContext === true && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
	)
}

/** iOS Home Screen PWA only; other platforms leave `navigator.standalone` undefined. */
export function isIosStandalonePwa(): boolean {
	const standalone: unknown = Reflect.get(globalThis.navigator, 'standalone')
	return standalone === true
}

/** Keep terminal-safe printable text and U+0020 space; strip controls and format separators. */
export function sanitizeVoiceText(text: string): string {
	let result = ''
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f)) continue
		if (NON_PRINTING_FORMAT_OR_SEPARATOR.test(character)) continue
		result += character
	}
	return result
}

function errorMessage(code: AsrErrorCode): string {
	return ERROR_MESSAGES[code]
}

function joinDraft(baseDraft: string, utterance: string): string {
	if (!baseDraft) return utterance
	if (!utterance) return baseDraft
	return TRAILING_WHITESPACE.test(baseDraft)
		? `${baseDraft}${utterance}`
		: `${baseDraft} ${utterance}`
}

/** Tap-to-toggle controller: the only writer of the UI state is transition(). */
export function createMicController(options: MicControllerOptions): MicController | undefined {
	if (!options.config.asr.enabled) return undefined
	if (!options.engine && !isVoiceInputSupported()) return undefined

	let createdEngine: DoubaoEngine | undefined
	let engine: AsrEngine
	if (options.engine) {
		engine = options.engine
	} else {
		createdEngine = new DoubaoEngine({
			apiKey: options.config.asr.doubao.apiKey,
			resourceId: options.config.asr.doubao.resourceId,
			keepAlive: isIosStandalonePwa(),
		})
		engine = createdEngine
	}
	if (!engine.isSupported()) return undefined

	const preview = createAsrPreview({ defaultTargetId: options.config.defaultTargetId })
	const micButtons = new Set<HTMLButtonElement>()
	const composerButtons = new Set<HTMLButtonElement>()
	const buttonDisposers = new Map<HTMLButtonElement, () => void>()
	let currentState: MicState = 'idle'
	let generation = 0
	let connectTimer: ReturnType<typeof setTimeout> | undefined
	let finalTimer: ReturnType<typeof setTimeout> | undefined
	let engineUnsubscribers: Array<() => void> = []
	let appliedSeq = Number.NEGATIVE_INFINITY
	let pendingAction: 'send' | undefined
	let pendingSubmission: ComposerPending | null = preview.getPending()
	let resultDeadlineTimer: ReturnType<typeof setTimeout> | undefined
	let connectionEpoch = 0
	let syncedEpochActive = false
	const resentEpochs = new Set<number>()
	let baseDraft = ''
	let disposed = false
	let currentTargetId = options.config.defaultTargetId

	function transition(from: readonly MicState[], to: MicState, event: string): void {
		if (!from.includes(currentState)) {
			throw new Error(`Invalid mic transition ${currentState} -> ${to} (${event})`)
		}
		currentState = to
		preview.input.readOnly = to !== 'idle' && to !== 'preview' && to !== 'error'
		for (const button of micButtons) {
			button.dataset.micState = to
			button.setAttribute('aria-pressed', to === 'recording' ? 'true' : 'false')
			button.classList.toggle('wt-mic-recording', to === 'recording')
		}
	}

	function setComposerExpanded(expanded: boolean): void {
		for (const button of composerButtons) {
			button.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		}
	}

	function clearTimers(): void {
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		if (finalTimer !== undefined) clearTimeout(finalTimer)
		connectTimer = undefined
		finalTimer = undefined
	}

	function clearResultDeadline(): void {
		if (resultDeadlineTimer !== undefined) clearTimeout(resultDeadlineTimer)
		resultDeadlineTimer = undefined
	}

	function clearEngineHandlers(): void {
		for (const unsubscribe of engineUnsubscribers) unsubscribe()
		engineUnsubscribers = []
	}

	function cleanupSession(): void {
		clearTimers()
		clearEngineHandlers()
	}

	function stopEngine(): void {
		void engine.stop().catch((error: unknown) => {
			console.error('herdweb: ASR stop failed', error)
		})
	}

	function endAsIdle(): void {
		generation++
		cleanupSession()
		preview.close()
		setComposerExpanded(false)
		if (currentState !== 'idle') {
			transition(
				['preview', 'error', 'cancelled', 'permission-requesting', 'connecting'],
				'idle',
				'end',
			)
		}
	}

	function pendingStatusMessage(status: ComposerPending['status']): string {
		switch (status) {
			case 'pending':
				return 'Pending — waiting for terminal receipt.'
			case 'unknown':
				return 'Result unknown — the terminal may or may not have received it.'
			case 'rejected':
				return 'Not received.'
		}
	}

	function rejectedMessage(reason: NonNullable<ComposerPending['reason']>): string {
		return reason === 'id-conflict'
			? 'Not received: duplicate submission id.'
			: 'Not received: terminal session unavailable.'
	}

	function persistPending(next: ComposerPending | null): boolean {
		pendingSubmission = next
		const persisted = preview.setPending(next)
		preview.setSubmissionControls(next?.status ?? null)
		if (!persisted) {
			preview.showMessage('Draft is not protected on this device.')
		}
		return persisted
	}

	function setPendingStatus(
		next: ComposerPending,
		message = pendingStatusMessage(next.status),
	): void {
		if (persistPending(next)) preview.setSubmissionStatus(next.status, message)
	}

	function startResultDeadline(id: string): void {
		clearResultDeadline()
		resultDeadlineTimer = setTimeout(() => {
			resultDeadlineTimer = undefined
			const current = pendingSubmission
			if (!current || current.id !== id || current.status !== 'pending') return
			const next: ComposerPending = { ...current, status: 'unknown' }
			setPendingStatus(next)
		}, RESULT_DEADLINE_MS)
	}

	function handleInputActionResult(result: InputActionResult): void {
		const current = pendingSubmission
		if (disposed || !current || current.id !== result.id) return
		clearResultDeadline()
		if (!result.accepted) {
			if (result.reason === null) return
			const next: ComposerPending = {
				...current,
				status: 'rejected',
				reason: result.reason,
			}
			setPendingStatus(next, rejectedMessage(result.reason))
			return
		}

		const submitted = current
		const draftIsUnchanged = preview.getText() === submitted.sourceText
		persistPending(null)
		if (draftIsUnchanged) preview.resetDraft()
		preview.setSubmissionControls(null)
		preview.setSubmissionStatus('accepted', 'Received by terminal.')
		if (currentState === 'preview') {
			generation++
			cleanupSession()
			transition(['preview'], 'idle', 'action-accepted')
		}
		setComposerExpanded(true)
	}

	function sendPendingAction(submission: ComposerPending): boolean {
		const sent = options.term.sendInputAction(submission.id, submission.data)
		if (!sent) {
			preview.setSubmissionStatus('pending', 'Not sent — still syncing.')
			return false
		}
		if (!pendingSubmission || pendingSubmission.id !== submission.id) return true
		preview.setSubmissionStatus('pending', pendingStatusMessage('pending'))
		startResultDeadline(submission.id)
		return true
	}

	function resendAtEpoch(epoch: number): void {
		const current = pendingSubmission
		if (!current || (current.status !== 'pending' && current.status !== 'unknown')) return
		if (resentEpochs.has(epoch)) return
		if (!options.term.isConnected()) return
		const currentSessionId = options.term.getSessionId()
		if (currentSessionId === null) return
		if (current.sessionId !== currentSessionId) {
			const next: ComposerPending = { ...current, status: 'unknown' }
			setPendingStatus(next, 'Terminal session changed — last result unknown.')
			clearResultDeadline()
			return
		}

		resentEpochs.add(epoch)
		const submission =
			current.status === 'unknown' ? { ...current, status: 'pending' as const } : current
		if (submission !== current) setPendingStatus(submission)
		sendPendingAction(submission)
	}

	function retryPending(): void {
		const current = pendingSubmission
		if (disposed || !current || current.status !== 'unknown') return
		if (!options.term.isConnected()) {
			preview.setSubmissionStatus('unknown', 'Not sent — still syncing.')
			return
		}
		const sessionId = options.term.getSessionId()
		if (sessionId === null) {
			preview.setSubmissionStatus('unknown', 'Not sent — still syncing.')
			return
		}
		const submission: ComposerPending = {
			...current,
			sessionId,
			status: 'pending',
			reason: undefined,
		}
		if (!persistPending(submission)) return
		sendPendingAction(submission)
	}

	function abandonPending(): boolean {
		if (!pendingSubmission) return true
		clearResultDeadline()
		const abandoned = pendingSubmission
		if (!persistPending(null)) {
			pendingSubmission = abandoned
			preview.setSubmissionControls(abandoned.status)
			return false
		}
		preview.setSubmissionStatus(null, 'Removed from this device.')
		return true
	}

	function handleConnectionStatus(status: ConnectionStatus): void {
		if (status.state !== 'synced') {
			syncedEpochActive = false
			if (pendingSubmission?.status === 'pending') {
				preview.setSubmissionStatus('pending', 'Not sent — still syncing.')
			}
			return
		}
		if (syncedEpochActive) return
		syncedEpochActive = true
		connectionEpoch++
		resendAtEpoch(connectionEpoch)
	}

	if (pendingSubmission) {
		preview.setSubmissionControls(pendingSubmission.status)
		preview.setSubmissionStatus(
			pendingSubmission.status,
			pendingSubmission.status === 'rejected' && pendingSubmission.reason
				? rejectedMessage(pendingSubmission.reason)
				: pendingStatusMessage(pendingSubmission.status),
		)
	}

	function showError(code: AsrErrorCode, sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState === 'idle') return
		clearTimers()
		const hadText = preview.getText().length > 0
		transition(
			['permission-requesting', 'connecting', 'recording', 'stopping', 'waiting-final'],
			'error',
			`error:${code}`,
		)
		preview.showMessage(errorMessage(code))
		stopEngine()
		generation++
		cleanupSession()
		if (hadText) transition(['error'], 'preview', 'error-preview')
	}

	function cancelSession(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState === 'idle') return
		pendingAction = undefined
		clearTimers()
		transition(
			[
				'permission-requesting',
				'connecting',
				'recording',
				'stopping',
				'waiting-final',
				'preview',
				'error',
			],
			'cancelled',
			'cancel',
		)
		preview.clear()
		baseDraft = ''
		stopEngine()
		generation++
		cleanupSession()
		transition(['cancelled'], 'idle', 'cancelled-idle')
		setComposerExpanded(false)
	}

	function setTarget(nextTargetId: string): void {
		if (disposed || nextTargetId === currentTargetId) return
		currentTargetId = nextTargetId
		pendingAction = undefined
		clearResultDeadline()
		if (
			currentState === 'permission-requesting' ||
			currentState === 'connecting' ||
			currentState === 'recording' ||
			currentState === 'stopping' ||
			currentState === 'waiting-final'
		) {
			generation++
			cleanupSession()
			stopEngine()
			transition(
				['permission-requesting', 'connecting', 'recording', 'stopping', 'waiting-final'],
				'cancelled',
				'target-switch',
			)
			transition(['cancelled'], 'idle', 'target-switch-idle')
		}
		baseDraft = ''
		preview.setTarget(nextTargetId)
		pendingSubmission = preview.getPending()
		preview.setSubmissionControls(pendingSubmission?.status ?? null)
		if (pendingSubmission) {
			preview.setSubmissionStatus(
				pendingSubmission.status,
				pendingSubmission.status === 'rejected' && pendingSubmission.reason
					? rejectedMessage(pendingSubmission.reason)
					: pendingStatusMessage(pendingSubmission.status),
			)
		} else {
			preview.setSubmissionStatus(null, '')
		}
	}

	function finishPreview(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'waiting-final') return
		const shouldSend = pendingAction === 'send'
		pendingAction = undefined
		generation++
		cleanupSession()
		transition(['waiting-final'], 'preview', 'final-timeout')
		preview.showMessage('Ready to send. Edit the text or cancel.')
		if (shouldSend) confirmPreview()
	}

	function onFinal(text: string, sequence: number | undefined, sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'waiting-final') return
		if (sequence !== undefined) {
			if (sequence <= appliedSeq) return
			appliedSeq = sequence
		}
		preview.show(joinDraft(baseDraft, text))
		if (currentState === 'waiting-final') finishPreview(sessionGeneration)
	}

	function stopRecording(sessionGeneration: number): void {
		if (sessionGeneration !== generation || currentState !== 'recording') return
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		connectTimer = undefined
		transition(['recording'], 'stopping', 'tap')
		transition(['stopping'], 'waiting-final', 'stop-requested')
		preview.showMessage('Finishing…')
		finalTimer = setTimeout(() => finishPreview(sessionGeneration), WAITING_FINAL_TIMEOUT_MS)
		void engine.stop().catch((error: unknown) => {
			console.error('herdweb: ASR stop failed', error)
			if (currentState === 'waiting-final') showError('socket-closed', sessionGeneration)
		})
	}

	function bindEngine(sessionGeneration: number): void {
		engineUnsubscribers = [
			engine.onPartial((text) => {
				if (disposed || sessionGeneration !== generation || currentState !== 'recording') return
				preview.setPartial(joinDraft(baseDraft, text))
			}),
			engine.onFinal((text, sequence) => onFinal(text, sequence, sessionGeneration)),
			engine.onError((code) => {
				if (code === 'audio-interrupted') {
					showError(code, sessionGeneration)
					return
				}
				showError(code, sessionGeneration)
			}),
		]
	}

	async function startEngine(sessionGeneration: number): Promise<void> {
		try {
			await engine.start()
		} catch (error: unknown) {
			const code: AsrErrorCode =
				error instanceof Error && error.name === 'NotAllowedError'
					? 'permission-denied'
					: 'connection-failed'
			showError(code, sessionGeneration)
			return
		}
		if (disposed || sessionGeneration !== generation || currentState !== 'connecting') return
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		connectTimer = undefined
		transition(['connecting'], 'recording', 'engine-started')
		preview.showMessage('Listening…')
	}

	function beginConnecting(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'permission-requesting')
			return
		transition(['permission-requesting'], 'connecting', 'tap-start')
		preview.showMessage('Connecting to voice service…')
		connectTimer = setTimeout(
			() => showError('connection-failed', sessionGeneration),
			CONNECT_TIMEOUT_MS,
		)
		bindEngine(sessionGeneration)
		void startEngine(sessionGeneration)
	}

	function startSession(): void {
		if (disposed || currentState !== 'idle') return
		generation++
		const sessionGeneration = generation
		pendingAction = undefined
		appliedSeq = Number.NEGATIVE_INFINITY
		baseDraft = preview.getText()
		transition(['idle'], 'permission-requesting', 'tap-start')
		preview.showMessage('Requesting microphone…')
		haptic()
		beginConnecting(sessionGeneration)
	}

	function openComposer(): void {
		if (disposed || currentState !== 'idle') return
		options.closeComposerOverlays?.()
		preview.open()
		setComposerExpanded(true)
		haptic()
	}

	function canSendComposerText(sessionGeneration: number): boolean {
		return (
			!disposed &&
			sessionGeneration === generation &&
			(currentState === 'preview' || currentState === 'idle')
		)
	}

	function tapToggle(): void {
		if (disposed) return
		const kbWasOpen = isKeyboardOpen()
		const sessionGeneration = generation
		let toggled = false
		if (currentState === 'idle') {
			toggled = true
			startSession()
		} else if (currentState === 'recording') {
			toggled = true
			stopRecording(sessionGeneration)
		} else if (currentState === 'permission-requesting' || currentState === 'connecting') {
			toggled = true
			cancelSession(sessionGeneration)
		} else if (currentState === 'error') {
			toggled = true
			cancelSession(sessionGeneration)
			startSession()
		} else if (currentState === 'preview') {
			toggled = true
			transition(['preview'], 'idle', 'preview-rerecord')
			startSession()
		}
		if (toggled) conditionalFocus(options.term, kbWasOpen)
	}

	function confirmPreview(): void {
		if (disposed) return
		if (currentState === 'recording') {
			pendingAction = 'send'
			stopRecording(generation)
			return
		}
		if (currentState === 'stopping' || currentState === 'waiting-final') {
			pendingAction = 'send'
			return
		}
		if (currentState !== 'preview' && currentState !== 'idle') return
		if (
			pendingSubmission?.status === 'pending' ||
			pendingSubmission?.status === 'unknown' ||
			pendingSubmission?.status === 'rejected'
		) {
			return
		}
		const sessionGeneration = generation
		const sourceText = preview.getText()
		if (!sourceText) {
			preview.showMessage('Type or speak something to send.')
			return
		}
		if (!options.term.isConnected()) {
			preview.showMessage('Not sent — still syncing.')
			return
		}
		const isGenerationCurrent = createAttachmentGuard(options.term)
		void (async () => {
			const before = await options.hooks.runBeforeSendData({
				term: options.term,
				config: options.config,
				source: 'toolbar',
				actionType: 'voice-input',
				kbWasOpen: false,
				data: sourceText,
			})
			if (!canSendComposerText(sessionGeneration) || !options.term.isConnected()) return
			if (!isGenerationCurrent()) return
			if (before.blocked) return
			const body = sanitizeVoiceText(before.data)
			if (!body) {
				preview.showMessage('Speech contained no printable text.')
				return
			}
			const data = options.config.asr.autoEnter ? `${body}\r` : body
			const sessionId = options.term.getSessionId()
			if (sessionId === null) {
				preview.showMessage('Not sent — still syncing.')
				return
			}
			const submission: ComposerPending = {
				id: crypto.randomUUID(),
				sessionId,
				sourceText,
				data,
				status: 'pending',
			}
			if (!persistPending(submission)) return
			const sent = sendPendingAction(submission)
			if (!sent) return
			await options.hooks.runAfterSendData({
				term: options.term,
				config: options.config,
				source: 'toolbar',
				actionType: 'voice-input',
				kbWasOpen: false,
				data,
			})
		})()
	}

	function cancelPreview(): void {
		if (
			currentState === 'permission-requesting' ||
			currentState === 'connecting' ||
			currentState === 'recording' ||
			currentState === 'stopping' ||
			currentState === 'waiting-final'
		) {
			cancelSession(generation)
			return
		}
		if (currentState !== 'preview' && currentState !== 'error' && currentState !== 'idle') return
		if (pendingSubmission) {
			const confirmed = window.confirm(
				'Clear this draft and abandon the pending submission? This only removes it from this device.',
			)
			if (!confirmed) {
				preview.close()
				return
			}
			if (!abandonPending()) return
		}
		if (currentState === 'idle') {
			preview.clear()
			endAsIdle()
			return
		}
		preview.clear()
		stopEngine()
		endAsIdle()
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden' && currentState !== 'idle') {
			const preservedDraft = baseDraft
			cancelSession(generation)
			if (preservedDraft) preview.show(preservedDraft)
			preview.showMessage('Recording cancelled because the app went into the background.')
			setComposerExpanded(true)
		}
	}

	function onPageShow(): void {
		preview.restoreDraft()
	}

	const previewConfirm = preview.onConfirm(options.term, confirmPreview)
	const previewRetry = preview.onRetry(options.term, retryPending)
	const previewAbandon = preview.onAbandon(abandonPending)
	const previewCancel = preview.onCancel(cancelPreview)
	document.addEventListener('visibilitychange', onVisibilityChange)
	window.addEventListener('pageshow', onPageShow)
	const connection = options.term.onConnectionChange((connected) => {
		if (!connected && pendingSubmission?.status === 'pending') {
			preview.setSubmissionStatus('pending', 'Not sent — still syncing.')
		} else if (!connected && currentState === 'preview' && preview.getText()) {
			preview.showMessage('Terminal disconnected; text is kept here until it reconnects.')
		}
	})
	const actionResults = options.term.onInputActionResult(handleInputActionResult)
	const connectionStatus = options.term.onConnectionStatusChange(handleConnectionStatus)

	const controller: MicController = {
		preview,
		get state() {
			return currentState
		},
		setTarget,
		attachComposerToggle(button) {
			if (buttonDisposers.has(button)) return
			suppressSynthesisedMouse(button)
			onTap(button, openComposer)
			button.setAttribute('aria-label', 'Voice composer')
			button.setAttribute('aria-haspopup', 'dialog')
			button.setAttribute('aria-expanded', 'false')
			composerButtons.add(button)
			buttonDisposers.set(button, () => {})
		},
		attachMicButton(button) {
			if (buttonDisposers.has(button)) return
			suppressSynthesisedMouse(button)
			onTap(button, tapToggle)
			button.setAttribute('aria-label', 'Toggle microphone')
			button.setAttribute('aria-pressed', 'false')
			button.dataset.micState = 'idle'
			micButtons.add(button)
			buttonDisposers.set(button, () => {})
		},
		dispose() {
			if (disposed) return
			disposed = true
			generation++
			clearTimers()
			clearResultDeadline()
			if (createdEngine) {
				void createdEngine.dispose().catch((error: unknown) => {
					console.error('herdweb: ASR dispose failed', error)
				})
			} else {
				stopEngine()
			}
			for (const disposeButton of buttonDisposers.values()) disposeButton()
			buttonDisposers.clear()
			micButtons.clear()
			composerButtons.clear()
			clearEngineHandlers()
			previewConfirm.dispose()
			previewRetry.dispose()
			previewAbandon.dispose()
			previewCancel.dispose()
			connection.dispose()
			connectionStatus.dispose()
			actionResults.dispose()
			document.removeEventListener('visibilitychange', onVisibilityChange)
			window.removeEventListener('pageshow', onPageShow)
			preview.element.remove()
		},
	}

	return controller
}
