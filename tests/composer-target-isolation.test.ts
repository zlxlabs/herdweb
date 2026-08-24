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
import { createAsrPreview } from '../src/controls/asr-preview'
import { createMicController } from '../src/controls/mic-controller'
import { createHookRegistry } from '../src/hooks/registry'
import { serialiseClientMessage } from '../src/session-protocol'
import type { InputActionResult, XTerminal } from '../src/types'
import { mockTerminalWithSent } from './fixtures'

const key = (targetId: string): string => `herdweb:composer:v1:/:${targetId}`
const SINGLE_TARGET_KEY = 'herdweb:composer:v1:/'

function storedDraft(targetId: string): string | null {
	const raw = localStorage.getItem(key(targetId))
	if (raw === null) return null
	return (JSON.parse(raw) as { draft: string }).draft
}

function typeDraft(composer: { input: HTMLTextAreaElement }, text: string): void {
	composer.input.value = text
	composer.input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
	GlobalRegistrator.register()
	localStorage.clear()
})

afterEach(() => {
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

describe('composer target isolation (T6a)', () => {
	test('drafts are stored per target and restored on switch back', () => {
		const composer = createAsrPreview({ defaultTargetId: 'one' })
		composer.setTarget('one')
		typeDraft(composer, 'aaa')
		expect(storedDraft('one')).toBe('aaa')

		composer.setTarget('two')
		expect(composer.input.value).toBe('')
		typeDraft(composer, 'bb')
		expect(storedDraft('two')).toBe('bb')

		composer.setTarget('one')
		expect(composer.input.value).toBe('aaa')
		expect(storedDraft('two')).toBe('bb')
	})

	test('pending submissions are stored per target', () => {
		const composer = createAsrPreview({ defaultTargetId: 'one' })
		composer.setTarget('one')
		const pending = {
			id: 'p1',
			sessionId: 's1',
			sourceText: 'hello',
			data: 'hello\r',
			status: 'unknown' as const,
		}
		expect(composer.setPending(pending)).toBe(true)

		composer.setTarget('two')
		expect(composer.getPending()).toBeNull()

		composer.setTarget('one')
		expect(composer.getPending()).toEqual(pending)
	})

	test('migrates the old single-target key to the default target once, new key wins', () => {
		localStorage.setItem(
			SINGLE_TARGET_KEY,
			JSON.stringify({ version: 1, draft: '旧草稿', pending: null }),
		)
		const composer = createAsrPreview({ defaultTargetId: 'one' })
		expect(localStorage.getItem(SINGLE_TARGET_KEY)).toBeNull()
		expect(storedDraft('one')).toBe('旧草稿')
		expect(composer.input.value).toBe('旧草稿')

		// A stale single-target key must never overwrite the per-target store.
		localStorage.setItem(
			SINGLE_TARGET_KEY,
			JSON.stringify({ version: 1, draft: ' stale ', pending: null }),
		)
		createAsrPreview({ defaultTargetId: 'one' })
		expect(storedDraft('one')).toBe('旧草稿')
	})

	test('storage failure on switch is shown in the composer, never silent', () => {
		const composer = createAsrPreview({ defaultTargetId: 'one' })
		composer.setTarget('one')
		typeDraft(composer, 'aaa')
		const realStorage = window.localStorage
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			value: {
				getItem: (k: string) => realStorage.getItem(k),
				setItem: () => {
					throw new Error('denied')
				},
				removeItem: (k: string) => realStorage.removeItem(k),
			},
		})

		composer.setTarget('two')

		expect(composer.message.textContent).toBe('Draft is not protected on this device.')
	})
})

class FakeEngine implements AsrEngine {
	starts = 0
	stops = 0
	private final: AsrFinalHandler | undefined
	private partial: AsrTextHandler | undefined
	private error: AsrErrorHandler | undefined

	start(): Promise<void> {
		this.starts++
		return Promise.resolve()
	}
	stop(): Promise<void> {
		this.stops++
		return Promise.resolve()
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
	emitFinal(text: string, sequence?: number): void {
		this.final?.(text, sequence)
	}
	emitError(code: AsrErrorCode): void {
		this.error?.(code)
	}
}

interface MicHarness {
	readonly controller: NonNullable<ReturnType<typeof createMicController>>
	readonly engine: FakeEngine
	readonly term: XTerminal & { readonly sent: string[]; inputActionCalls: string[] }
	readonly wsFrames: string[]
	setAttachment(id: string | null): void
}

function touch(id: number, target: EventTarget): Touch {
	return { identifier: id, target, clientX: 0, clientY: 0 } as unknown as Touch
}

function createMicHarness(hooks = createHookRegistry()): MicHarness {
	const engine = new FakeEngine()
	const baseTerm = mockTerminalWithSent()
	const inputActionCalls: string[] = []
	const wsFrames: string[] = []
	const actionResultListeners = new Set<(result: InputActionResult) => void>()
	let attachmentId: string | null = 'att-one'
	const term = {
		...baseTerm,
		getAttachmentId: () => attachmentId,
		sendInputAction(id: string, data: string) {
			if (attachmentId === null) return false
			wsFrames.push(serialiseClientMessage({ type: 'input-action', attachmentId, id, data }))
			inputActionCalls.push(data)
			queueMicrotask(() => {
				for (const handler of actionResultListeners) handler({ id, accepted: true, reason: null })
			})
			return true
		},
		onInputActionResult(handler: (result: InputActionResult) => void) {
			actionResultListeners.add(handler)
			return { dispose: () => actionResultListeners.delete(handler) }
		},
	}
	const config = defineConfig({
		asr: { enabled: true, autoEnter: false, doubao: { apiKey: 'test-key' } },
		defaultTargetId: 'one',
	})
	const controller = createMicController({ term, config, hooks, engine })
	if (!controller) throw new Error('expected controller')
	document.body.appendChild(controller.preview.element)
	return {
		controller,
		engine,
		term: Object.assign(term, { inputActionCalls }),
		wsFrames,
		setAttachment(id: string | null) {
			attachmentId = id
		},
	}
}

describe('mic controller target isolation (T6a)', () => {
	test('switching mid-recording cancels A transiently and keeps A draft; B starts clean', async () => {
		const harness = createMicHarness()
		const { controller, engine } = harness
		controller.setTarget('one')
		typeDraft(controller.preview, 'hello')

		// Start recording on A.
		const micButton = document.createElement('button')
		controller.attachMicButton(micButton)
		document.body.appendChild(micButton)
		micButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(controller.state).toBe('recording')

		controller.setTarget('two')

		expect(controller.state).toBe('idle')
		expect(engine.stops).toBeGreaterThan(0)
		// A's draft survived; B shows nothing.
		expect(storedDraft('one')).toBe('hello')
		expect(controller.preview.input.value).toBe('')
		// A late final from the dead session never lands in B.
		engine.emitFinal('late words')
		expect(controller.preview.input.value).toBe('')

		controller.setTarget('one')
		expect(controller.preview.input.value).toBe('hello')
	})

	test('pending stays with A across a round trip and retry binds to A', async () => {
		const harness = createMicHarness()
		const { controller } = harness
		controller.setTarget('one')
		const pendingOnA = {
			id: 'p1',
			sessionId: 'test-session',
			sourceText: 'do the thing',
			data: 'do the thing',
			status: 'unknown' as const,
		}
		expect(controller.preview.setPending(pendingOnA)).toBe(true)

		controller.setTarget('two')
		expect(controller.preview.getPending()).toBeNull()
		expect(controller.preview.message.dataset.submissionStatus).toBeUndefined()

		controller.setTarget('one')
		expect(controller.preview.getPending()?.id).toBe(pendingOnA.id)
		expect(controller.preview.message.dataset.submissionStatus).toBe('unknown')
	})

	test.each([
		{
			label: 'Send',
			selector: '.wt-composer-send',
			prepare(controller: MicHarness['controller']) {
				controller.setTarget('one')
				typeDraft(controller.preview, 'A draft')
				controller.setTarget('two')
				typeDraft(controller.preview, 'B draft')
				controller.setTarget('one')
				controller.preview.show('A draft')
			},
		},
		{
			label: 'Retry',
			selector: '.wt-composer-retry',
			prepare(controller: MicHarness['controller']) {
				controller.setTarget('one')
				expect(
					controller.preview.setPending({
						id: 'p1',
						sessionId: 'test-session',
						sourceText: 'do the thing',
						data: 'do the thing',
						status: 'unknown',
					}),
				).toBe(true)
				controller.setTarget('two')
				typeDraft(controller.preview, 'B draft')
				controller.setTarget('one')
			},
		},
	])(
		'composer $label F1 on A then F2 on B: F1 end sends 0 att-two input-action frames',
		async ({ label, selector, prepare }) => {
			const harness = createMicHarness()
			prepare(harness.controller)
			const button = harness.controller.preview.element.querySelector(selector)
			if (!(button instanceof HTMLButtonElement)) throw new Error(`no ${label} button`)
			const f1 = touch(1, button)
			const f2 = touch(2, button)
			button.dispatchEvent(new TouchEvent('touchstart', { touches: [f1], changedTouches: [f1] }))
			harness.setAttachment('att-two')
			button.dispatchEvent(
				new TouchEvent('touchstart', { touches: [f1, f2], changedTouches: [f2] }),
			)
			button.dispatchEvent(new TouchEvent('touchend', { touches: [f2], changedTouches: [f1] }))
			for (let index = 0; index < 8; index++) await Promise.resolve()
			const toB = harness.wsFrames
				.map((payload) => JSON.parse(payload) as Record<string, unknown>)
				.filter((frame) => frame.type === 'input-action' && frame.attachmentId === 'att-two')
			expect(toB).toEqual([])
		},
	)

	test('composer confirm started on A sends nothing after the attachment switches to B', async () => {
		const gate = (() => {
			let resolve!: () => void
			const promise = new Promise<void>((r) => {
				resolve = r
			})
			return { promise, resolve }
		})()
		const hooks = createHookRegistry()
		hooks.on('beforeSendData', async () => {
			await gate.promise
			return undefined
		})
		const harness = createMicHarness(hooks)
		const { controller } = harness
		controller.setTarget('one')
		controller.preview.show('hello B should not get this')

		const sendButton = controller.preview.element.querySelector('.wt-composer-send')
		if (!(sendButton instanceof HTMLButtonElement)) throw new Error('no send button')
		sendButton.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		harness.setAttachment('att-two')
		gate.resolve()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(harness.term.inputActionCalls).toEqual([])
	})
})
