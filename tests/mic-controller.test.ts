import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
	AsrEngine,
	AsrErrorCode,
	AsrErrorHandler,
	AsrFinalHandler,
	AsrTextHandler,
} from '../src/asr/types'
import { defineConfig } from '../src/config'
import {
	createMicController,
	isVoiceInputSupported,
	sanitizeVoiceText,
} from '../src/controls/mic-controller'
import { createHookRegistry } from '../src/hooks/registry'
import type { InputActionResult, XTerminal } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminalWithSent } from './fixtures'

class FakeEngine implements AsrEngine {
	starts = 0
	stops = 0
	rejectStops = false
	private startResolve: (() => void) | undefined
	private startReject: ((error: unknown) => void) | undefined
	private partial: AsrTextHandler | undefined
	private final: AsrFinalHandler | undefined
	private error: AsrErrorHandler | undefined

	start(): Promise<void> {
		this.starts++
		return new Promise<void>((resolve, reject) => {
			this.startResolve = resolve
			this.startReject = reject
		})
	}

	resolveStart(): void {
		const resolve = this.startResolve
		this.startResolve = undefined
		this.startReject = undefined
		resolve?.()
	}

	rejectStart(error: unknown): void {
		const reject = this.startReject
		this.startResolve = undefined
		this.startReject = undefined
		reject?.(error)
	}

	stop(): Promise<void> {
		this.stops++
		return this.rejectStops ? Promise.reject(new Error('stop failed')) : Promise.resolve()
	}

	isSupported(): boolean {
		return true
	}

	onPartial(handler: AsrTextHandler): () => void {
		this.partial = handler
		return () => {
			if (this.partial === handler) this.partial = undefined
		}
	}

	onFinal(handler: AsrFinalHandler): () => void {
		this.final = handler
		return () => {
			if (this.final === handler) this.final = undefined
		}
	}

	onError(handler: AsrErrorHandler): () => void {
		this.error = handler
		return () => {
			if (this.error === handler) this.error = undefined
		}
	}

	emitPartial(text: string): void {
		this.partial?.(text)
	}

	emitFinal(text: string, sequence?: number): void {
		this.final?.(text, sequence)
	}

	emitError(code: AsrErrorCode): void {
		this.error?.(code)
	}
}

interface TestHarness {
	readonly button: HTMLButtonElement
	readonly composerButton: HTMLButtonElement
	readonly textarea: HTMLTextAreaElement | undefined
	readonly engine: FakeEngine
	readonly term: XTerminal & { readonly sent: string[] }
	readonly controller: NonNullable<ReturnType<typeof createMicController>>
	setConnected(connected: boolean): void
}

function createHarness(
	autoEnter = false,
	hooks = createHookRegistry(),
	withTextarea = false,
): TestHarness {
	const engine = new FakeEngine()
	const baseTerm = mockTerminalWithSent()
	const textarea = withTextarea ? document.createElement('textarea') : undefined
	if (textarea) document.body.append(textarea)
	let connected = true
	const listeners = new Set<(value: boolean) => void>()
	const actionResultListeners = new Set<(result: InputActionResult) => void>()
	const term = {
		...baseTerm,
		focus() {
			textarea?.focus()
		},
		isConnected: () => connected,
		onConnectionChange(handler: (value: boolean) => void) {
			listeners.add(handler)
			return { dispose: () => listeners.delete(handler) }
		},
		sendInputAction(id: string, data: string) {
			const sent = baseTerm.sendInputAction(id, data)
			queueMicrotask(() => {
				for (const handler of actionResultListeners) {
					handler({ id, accepted: true, reason: null })
				}
			})
			return sent
		},
		onInputActionResult(handler: (result: InputActionResult) => void) {
			actionResultListeners.add(handler)
			return { dispose: () => actionResultListeners.delete(handler) }
		},
	}
	const config = defineConfig({
		asr: { enabled: true, autoEnter, doubao: { apiKey: 'test-key' } },
	})
	const controller = createMicController({
		term,
		config,
		hooks,
		engine,
	})
	if (!controller) throw new Error('expected injected fake engine to create controller')
	const button = document.createElement('button')
	controller.attachMicButton(button)
	const composerButton = document.createElement('button')
	controller.attachComposerToggle(composerButton)
	document.body.append(button, composerButton)
	return {
		button,
		composerButton,
		textarea,
		engine,
		term,
		controller,
		setConnected(value) {
			connected = value
			for (const listener of listeners) listener(value)
		},
	}
}

function dispatchTap(button: HTMLButtonElement): void {
	button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
}

function dispatchTouchTap(button: HTMLButtonElement): void {
	button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
}

function dispatchPreviewTap(harness: TestHarness, target: 'close' | 'send'): void {
	const selector = target === 'close' ? '.wt-asr-composer-close' : '.wt-composer-send'
	const button = harness.controller.preview.element.querySelector(selector)
	if (!(button instanceof HTMLButtonElement)) throw new Error(`missing composer ${target} button`)
	dispatchTap(button)
}

async function startRecording(harness: TestHarness): Promise<void> {
	dispatchTap(harness.button)
	harness.engine.resolveStart()
	await Promise.resolve()
	await Promise.resolve()
	expect(harness.controller.state).toBe('recording')
	expect(harness.button.getAttribute('aria-pressed')).toBe('true')
	expect(harness.button.classList.contains('wt-mic-recording')).toBe(true)
	expect(harness.controller.preview.isOpen()).toBe(true)
	expect(harness.controller.preview.message.textContent).toContain('Listening')
}

beforeEach(() => {
	GlobalRegistrator.register()
	localStorage.clear()
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: 'visible',
	})
	vi.useFakeTimers()
})

afterEach(() => {
	localStorage.clear()
	_resetTouchGuard()
	GlobalRegistrator.unregister()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('sanitizeVoiceText', () => {
	test('keeps printable bytes and spaces, strips C0/DEL/C1', () => {
		const input = 'A\x00B\tC\nD\rE\x7fF\x80G\x9fH \u4f60\u597d'
		expect(new TextEncoder().encode(sanitizeVoiceText(input))).toEqual(
			new TextEncoder().encode('ABCDEFGH \u4f60\u597d'),
		)
	})

	test('strips zero-width, format, bidi, line-separator, and paragraph-separator code points', () => {
		const input = 'A\u200bB\u202aC\u2028D\u2029E\ufeffF e\u0301'
		expect(new TextEncoder().encode(sanitizeVoiceText(input))).toEqual(
			new TextEncoder().encode('ABCDEF e\u0301'),
		)
	})

	test('empty input remains empty', () => {
		expect(sanitizeVoiceText('\x00\r\n\t\x7f\x80\x9f')).toBe('')
	})
})

describe('mic-controller tap-to-toggle state machine', () => {
	test('toolbar entry opens composer without starting ASR or focusing input', () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.starts).toBe(0)
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.input.readOnly).toBe(false)
		expect(document.activeElement).not.toBe(harness.controller.preview.input)
		harness.controller.dispose()
	})

	test('composer Mic is the only path that starts recording', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		expect(harness.controller.state).toBe('idle')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(1)
		harness.engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		harness.engine.emitPartial('partial composer text')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.input.value).toBe('partial composer text')
		harness.controller.dispose()
	})

	test('appends a new recording partial to the typed draft without accumulating frames', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'keep this draft'
		dispatchTap(harness.button)
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.getText()).toBe('keep this draft')
		harness.engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		expect(harness.controller.state).toBe('recording')
		expect(harness.controller.preview.getText()).toBe('keep this draft')
		harness.engine.emitPartial('')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('keep this draft')
		harness.engine.emitPartial('new spoken draft')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('keep this draft new spoken draft')
		harness.engine.emitPartial('new spoken')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('keep this draft new spoken')
		harness.controller.dispose()
	})

	test('does not add a separator after a draft that ends in whitespace', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'keep this '
		await startRecording(harness)
		harness.engine.emitPartial('new spoken')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('keep this new spoken')
		harness.controller.dispose()
	})

	test('recording Mic tap enters editable preview after final', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		dispatchTap(harness.button)
		harness.engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		dispatchTap(harness.button)
		harness.engine.emitFinal('preview text', 1)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.input.readOnly).toBe(false)
		harness.controller.dispose()
	})

	test('idle typed text can be sent through the composer', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'typed command'
		dispatchPreviewTap(harness, 'send')
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.term.sent).toEqual(['typed command'])
		expect(harness.controller.state).toBe('idle')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.getText()).toBe('')
		expect(document.body.classList.contains('wt-composer-open')).toBe(true)
		harness.controller.preview.input.value = 'second command'
		dispatchPreviewTap(harness, 'send')
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.term.sent).toEqual(['typed command', 'second command'])
		expect(harness.controller.preview.isOpen()).toBe(true)
		harness.controller.dispose()
	})

	test('sending clears the base before the next recording session', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'already sent'
		dispatchPreviewTap(harness, 'send')
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.controller.preview.getText()).toBe('')

		await startRecording(harness)
		harness.engine.emitPartial('new utterance')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('new utterance')
		harness.controller.dispose()
	})

	test('Enter in the textarea does not send the draft', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'line one\nline two'
		harness.controller.preview.input.dispatchEvent(
			new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
		)
		await Promise.resolve()
		expect(harness.term.sent).toEqual([])
		expect(harness.controller.preview.getText()).toBe('line one\nline two')
		harness.controller.dispose()
	})

	test('idle close button discards while composer clicks do not', () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'discard me'
		harness.controller.preview.element.dispatchEvent(
			new Event('click', { bubbles: true, cancelable: true }),
		)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.starts).toBe(0)
		expect(harness.engine.stops).toBe(0)
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.getText()).toBe('discard me')
		dispatchPreviewTap(harness, 'close')
		expect(harness.engine.stops).toBe(0)
		expect(harness.controller.preview.isOpen()).toBe(false)
		harness.controller.dispose()
	})

	test('tap starts connecting immediately and a second tap cancels', async () => {
		const harness = createHarness()
		expect(harness.button.getAttribute('aria-label')).toBe('Toggle microphone')
		expect(harness.button.getAttribute('aria-pressed')).toBe('false')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(1)
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.message.textContent).toContain('Connecting to voice service')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.stops).toBe(1)
		expect(harness.controller.preview.isOpen()).toBe(false)
		harness.controller.dispose()
	})

	test('touch tap does not toggle again on the synthesised click', () => {
		const harness = createHarness()
		harness.button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(1)
		harness.controller.dispose()
	})

	test('tap preserves terminal textarea focus with keyboard closed or open', () => {
		const closed = createHarness(false, createHookRegistry(), true)
		if (!closed.textarea) throw new Error('expected focus target')
		closed.textarea.focus()
		dispatchTouchTap(closed.button)
		expect(document.activeElement).toBe(closed.textarea)
		closed.controller.dispose()

		Object.defineProperty(window, 'innerHeight', {
			configurable: true,
			value: 800,
		})
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: { height: 400 },
		})
		const open = createHarness(false, createHookRegistry(), true)
		if (!open.textarea) throw new Error('expected focus target')
		open.textarea.focus()
		dispatchTouchTap(open.button)
		expect(document.activeElement).toBe(open.textarea)
		open.controller.dispose()
	})

	test('recording tap transitions to waiting-final', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('waiting-final')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.input.readOnly).toBe(true)
		expect(harness.controller.preview.message.textContent).toContain('Finishing')
		expect(harness.engine.stops).toBe(1)
		harness.controller.dispose()
	})

	test('Send during recording stops and sends after final', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('send this')
		vi.advanceTimersByTime(20)
		dispatchPreviewTap(harness, 'send')
		expect(harness.controller.state).toBe('waiting-final')
		expect(harness.term.sent).toEqual([])
		harness.engine.emitFinal('send this', 1)
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.term.sent).toEqual(['send this'])
		expect(harness.controller.state).toBe('idle')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.getText()).toBe('')
		harness.controller.dispose()
	})

	test('Cancel during recording discards the session', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchPreviewTap(harness, 'close')
		expect(harness.term.sent).toEqual([])
		expect(harness.controller.state).toBe('idle')
		expect(harness.controller.preview.isOpen()).toBe(false)
		harness.controller.dispose()
	})

	test('Send during waiting-final sends after final or partial timeout', async () => {
		const final = createHarness()
		await startRecording(final)
		dispatchTap(final.button)
		dispatchPreviewTap(final, 'send')
		expect(final.controller.state).toBe('waiting-final')
		final.engine.emitFinal('final text', 1)
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(final.term.sent).toEqual(['final text'])
		expect(final.controller.state).toBe('idle')
		final.controller.dispose()

		const timeout = createHarness()
		await startRecording(timeout)
		timeout.engine.emitPartial('partial fallback')
		vi.advanceTimersByTime(20)
		dispatchTap(timeout.button)
		dispatchPreviewTap(timeout, 'send')
		vi.advanceTimersByTime(3_000)
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(timeout.term.sent).toEqual(['partial fallback'])
		expect(timeout.controller.state).toBe('idle')
		timeout.controller.dispose()
	})

	test('Cancel during waiting-final discards the session', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		dispatchPreviewTap(harness, 'close')
		expect(harness.term.sent).toEqual([])
		expect(harness.controller.state).toBe('idle')
		harness.controller.dispose()
	})

	test('connecting tap cancels the started engine', () => {
		const harness = createHarness()
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.stops).toBe(1)
		harness.controller.dispose()
	})

	test('partial text is streamed through an animation frame', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('partial text')
		expect(harness.controller.preview.input.value).toBe('')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.input.value).toBe('partial text')
		expect(harness.controller.preview.input.hasAttribute('inputmode')).toBe(false)
		harness.controller.dispose()
	})

	test('final text overwrites partial and discards stale or late sequences', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitPartial('partial')
		vi.advanceTimersByTime(20)
		harness.engine.emitFinal('final-2', 2)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('final-2')
		expect(harness.controller.preview.input.readOnly).toBe(false)
		harness.engine.emitFinal('stale-1', 1)
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.engine.emitFinal('new-3', 3)
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.controller.dispose()
	})

	test('waiting-final timeout preserves recognized text for manual sending', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('keep me')
		vi.advanceTimersByTime(20)
		dispatchTap(harness.button)
		vi.advanceTimersByTime(3_000)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('keep me')
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow()
		expect(harness.controller.state).toBe('idle')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.message.textContent).toContain('background')
		harness.controller.dispose()
	})

	test('permission denial enters error and Mic tap starts a new session', async () => {
		const harness = createHarness()
		dispatchTap(harness.button)
		harness.engine.rejectStart(new DOMException('permission denied', 'NotAllowedError'))
		await Promise.resolve()
		await Promise.resolve()
		expect(harness.controller.state).toBe('error')
		expect(harness.controller.preview.message.textContent).toContain('permission')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(2)
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.message.textContent).toContain('Connecting to voice service')
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow()
		expect(harness.controller.state).toBe('idle')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.message.textContent).toContain('background')
		harness.controller.dispose()
	})

	test('connection timeout enters error and audio interruption keeps the composer visible', async () => {
		const timeout = createHarness()
		dispatchTap(timeout.button)
		vi.advanceTimersByTime(5_000)
		expect(timeout.controller.state).toBe('error')
		timeout.controller.dispose()

		const withPartial = createHarness()
		await startRecording(withPartial)
		withPartial.engine.emitPartial('keep interrupted text')
		vi.advanceTimersByTime(20)
		withPartial.engine.emitError('audio-interrupted')
		expect(withPartial.controller.state).toBe('preview')
		expect(withPartial.controller.preview.isOpen()).toBe(true)
		expect(withPartial.controller.preview.input.value).toBe('keep interrupted text')
		expect(withPartial.controller.preview.input.readOnly).toBe(false)
		expect(withPartial.controller.preview.message.textContent).toContain('interrupted')
		withPartial.controller.dispose()

		const withoutPartial = createHarness()
		await startRecording(withoutPartial)
		withoutPartial.engine.emitError('audio-interrupted')
		expect(withoutPartial.controller.state).toBe('error')
		expect(withoutPartial.controller.preview.isOpen()).toBe(true)
		expect(withoutPartial.controller.preview.message.textContent).toContain('interrupted')
		withoutPartial.controller.dispose()
	})

	test('stop rejection is observable while cancellation still reaches idle', async () => {
		const harness = createHarness()
		harness.engine.rejectStops = true
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		dispatchTap(harness.button)
		dispatchTap(harness.button)
		await Promise.resolve()
		expect(harness.controller.state).toBe('idle')
		expect(error).toHaveBeenCalledWith('herdweb: ASR stop failed', expect.any(Error))
		harness.controller.dispose()
	})

	test('audio interruption preserves an error composer before visibility cancellation', async () => {
		const first = createHarness()
		await startRecording(first)
		first.engine.emitError('audio-interrupted')
		expect(first.controller.state).toBe('error')
		expect(first.controller.preview.isOpen()).toBe(true)
		expect(first.controller.preview.message.textContent).toContain('interrupted')
		first.controller.dispose()

		const second = createHarness()
		await startRecording(second)
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'hidden',
		})
		document.dispatchEvent(new Event('visibilitychange'))
		expect(second.controller.state).toBe('idle')
		expect(second.controller.preview.isOpen()).toBe(true)
		expect(second.controller.preview.message.textContent).toContain('background')
		second.controller.dispose()
	})

	test('tap in preview does not start a new session', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('preview text', 1)
		dispatchTap(harness.composerButton)
		expect(harness.engine.starts).toBe(1)
		expect(harness.controller.state).toBe('preview')
		harness.controller.dispose()
	})

	test('preview Mic tap starts a replacement recording without closing composer', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('preview text', 1)
		expect(harness.controller.state).toBe('preview')
		dispatchTap(harness.button)
		expect(harness.engine.starts).toBe(2)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.controller.preview.isOpen()).toBe(true)
		expect(harness.controller.preview.getText()).toBe('preview text')
		harness.engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		harness.engine.emitPartial('continued text')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('preview text continued text')
		harness.controller.dispose()
	})

	test('appends final text across consecutive recording sessions', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('aaa')
		vi.advanceTimersByTime(20)
		dispatchTap(harness.button)
		harness.engine.emitFinal('aaa', 1)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.getText()).toBe('aaa')

		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		harness.engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		harness.engine.emitPartial('bbb')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('aaa bbb')
		dispatchTap(harness.button)
		harness.engine.emitFinal('bbb', 2)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.getText()).toBe('aaa bbb')
		harness.controller.dispose()
	})

	test('ASR final persists the complete appended draft', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'typed base'
		harness.controller.preview.input.dispatchEvent(new Event('input', { bubbles: true }))
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('spoken final', 1)

		expect(JSON.parse(localStorage.getItem('herdweb:composer:v1:/:default') ?? '')).toEqual({
			version: 1,
			draft: 'typed base spoken final',
			pending: null,
		})
		harness.controller.dispose()
	})
})

describe('preview injection', () => {
	test('runs hook, sanitizes last, sends text then independent autoEnter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('ignored', 1)
		const hookCalls: string[] = []
		const hooks = createHookRegistry()
		hooks.on('beforeSendData', ({ data }) => {
			hookCalls.push(`before:${data}`)
			return { data: `${data}\r\n\t\x80\x7f\x9f` }
		})
		hooks.on('afterSendData', ({ data }) => {
			hookCalls.push(`after:${data}`)
		})
		// The controller's hook registry is fixed at construction; use a new
		// harness-shaped controller to assert the actual injection seam.
		harness.controller.dispose()
		localStorage.clear()
		const engine = new FakeEngine()
		const term = harness.term
		const config = defineConfig({
			asr: { enabled: true, autoEnter: true, doubao: { apiKey: 'test-key' } },
		})
		const controller = createMicController({ term, config, hooks, engine })
		if (!controller) throw new Error('expected controller')
		const button = document.createElement('button')
		controller.attachMicButton(button)
		document.body.append(button)
		dispatchTap(button)
		engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		dispatchTap(button)
		engine.emitFinal('printf "voice\x00-input\\n"', 1)
		const sendButton = controller.preview.element.querySelector('.wt-composer-send')
		sendButton?.dispatchEvent(new Event('click'))
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(term.sent).toEqual(['printf "voice-input\\n"\r'])
		expect(hookCalls[0]).toContain('before:')
		expect(hookCalls[1]).toBe('after:printf "voice-input\\n"\r')
		expect(controller.state).toBe('idle')
		controller.dispose()
	})

	test('disconnected terminal keeps preview and does not use send queue', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('kept text', 1)
		harness.setConnected(false)
		const sendButton = harness.controller.preview.element.querySelector('.wt-composer-send')
		sendButton?.dispatchEvent(new Event('click'))
		await Promise.resolve()
		expect(harness.term.sent).toEqual([])
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.message.textContent).toBe('Not sent — still syncing.')
		harness.controller.dispose()
	})

	test('disconnect during after-send hook blocks the independent autoEnter write', async () => {
		const hooks = createHookRegistry()
		const harness = createHarness(true, hooks)
		hooks.on('afterSendData', async () => {
			harness.setConnected(false)
			await Promise.resolve()
		})
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('typed command', 1)
		harness.controller.preview.input.value = 'typed command'
		harness.controller.preview.element
			.querySelector('.wt-composer-send')
			?.dispatchEvent(new Event('click'))
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.term.sent).toEqual(['typed command\r'])
		expect(harness.controller.state).toBe('idle')
		harness.controller.dispose()
	})

	test('pageshow restores only an empty composer and opening keeps its draft', () => {
		localStorage.setItem(
			'herdweb:composer:v1:/:default',
			JSON.stringify({ version: 1, draft: 'stored draft', pending: null }),
		)
		const harness = createHarness()
		expect(harness.controller.preview.getText()).toBe('stored draft')
		expect(harness.controller.preview.isOpen()).toBe(false)
		harness.controller.preview.input.value = ''
		window.dispatchEvent(new Event('pageshow'))
		expect(harness.controller.preview.getText()).toBe('stored draft')
		expect(harness.controller.preview.isOpen()).toBe(false)

		harness.controller.preview.open()
		expect(harness.controller.preview.getText()).toBe('stored draft')
		expect(harness.controller.preview.isOpen()).toBe(true)
		harness.controller.preview.input.value = 'newer draft'
		window.dispatchEvent(new Event('pageshow'))
		expect(harness.controller.preview.getText()).toBe('newer draft')
		expect(harness.controller.preview.isOpen()).toBe(true)

		harness.controller.preview.input.value = ''
		window.dispatchEvent(new Event('pageshow'))
		expect(harness.controller.preview.getText()).toBe('stored draft')
		expect(harness.controller.preview.isOpen()).toBe(true)
		harness.controller.dispose()
	})

	test('background cancellation drops partial text but keeps the persisted base draft', async () => {
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'typed base'
		harness.controller.preview.input.dispatchEvent(new Event('input', { bubbles: true }))
		await startRecording(harness)
		harness.engine.emitPartial('discarded partial')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.getText()).toBe('typed base discarded partial')

		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		document.dispatchEvent(new Event('visibilitychange'))

		expect(harness.controller.preview.getText()).toBe('typed base')
		expect(JSON.parse(localStorage.getItem('herdweb:composer:v1:/:default') ?? '')).toEqual({
			version: 1,
			draft: 'typed base',
			pending: null,
		})
		harness.controller.dispose()
	})

	test('late final after waiting timeout cannot overwrite edited preview text', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('recognized')
		vi.advanceTimersByTime(20)
		dispatchTap(harness.button)
		vi.advanceTimersByTime(3_000)
		expect(harness.controller.state).toBe('preview')
		harness.controller.preview.input.value = 'user edit'
		harness.engine.emitFinal('late provider result', 2)
		expect(harness.controller.preview.input.value).toBe('user edit')
		harness.controller.dispose()
	})

	test('empty preview does not inject or auto-enter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('', 1)
		const sendButton = harness.controller.preview.element.querySelector('.wt-composer-send')
		sendButton?.dispatchEvent(new Event('click'))
		await Promise.resolve()
		expect(harness.term.sent).toEqual([])
		harness.controller.dispose()
	})

	test.each([
		{
			name: 'empty without autoEnter',
			draft: '',
			autoEnter: false,
			sent: [],
			message: 'Type or speak something to send.',
		},
		{
			name: 'empty with autoEnter',
			draft: '',
			autoEnter: true,
			sent: [],
			message: 'Type or speak something to send.',
		},
		{
			name: 'non-printing with autoEnter',
			draft: '\u0000\u007f',
			autoEnter: true,
			sent: [],
			message: 'Speech contained no printable text.',
		},
		{
			name: 'hello without autoEnter',
			draft: 'hello',
			autoEnter: false,
			sent: ['hello'],
			message: undefined,
		},
		{
			name: 'hello with autoEnter',
			draft: 'hello',
			autoEnter: true,
			sent: ['hello\r'],
			message: undefined,
		},
	])('$name keeps the submit guards', async ({ draft, autoEnter, sent, message }) => {
		const harness = createHarness(autoEnter)
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = draft
		dispatchPreviewTap(harness, 'send')
		for (let index = 0; index < 8; index++) await Promise.resolve()

		expect(harness.term.sent).toEqual(sent)
		if (message !== undefined) {
			expect(harness.controller.preview.message.textContent).toBe(message)
		}
		harness.controller.dispose()
	})

	test('storage write failure keeps the composer sendable', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError')
		})
		const harness = createHarness()
		dispatchTap(harness.composerButton)
		harness.controller.preview.input.value = 'send despite storage failure'
		harness.controller.preview.input.dispatchEvent(new Event('input', { bubbles: true }))
		expect(harness.controller.preview.message.textContent).toBe(
			'Draft is not protected on this device.',
		)
		dispatchPreviewTap(harness, 'send')
		for (let index = 0; index < 8; index++) await Promise.resolve()

		expect(harness.term.sent).toEqual([])
		expect(harness.controller.preview.getText()).toBe('send despite storage failure')
		expect(errorSpy).toHaveBeenCalledTimes(1)
		harness.controller.dispose()
	})
})

describe('capability detection', () => {
	test('requires secure context and getUserMedia', () => {
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia() {} },
		})
		expect(isVoiceInputSupported()).toBe(false)
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
		expect(isVoiceInputSupported()).toBe(true)
	})
})
