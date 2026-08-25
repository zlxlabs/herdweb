import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultActionRegistry } from '../src/actions/registry'
import { defineConfig } from '../src/config'
import { createDpad, defaultDpadKeys } from '../src/controls/dpad'
import { createScrollButtons } from '../src/controls/scroll-buttons'
import { createDrawer } from '../src/drawer/drawer'
import { createGestureLock } from '../src/gestures/lock'
import { attachScrollGesture, scrollSeq } from '../src/gestures/scroll'
import { attachSwipeGestures } from '../src/gestures/swipe'
import { createHookRegistry } from '../src/hooks/registry'
import { createToolbar } from '../src/toolbar/toolbar'
import type { ConnectionState, ConnectionStatus, XTerminal } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminal } from './fixtures'

interface GuardedMockTerm extends XTerminal {
	readonly sent: string[]
	readonly dataHandlers: Array<(data: string) => void>
	setAttachment(id: string | null): void
	fireStatus(state: ConnectionState): void
}

/** Mock terminal with a mutable attachment generation and unconditional input recording. */
function mockGuardedTerm(initialAttachment: string | null): GuardedMockTerm {
	const sent: string[] = []
	const dataHandlers: Array<(data: string) => void> = []
	const statusListeners: Array<(status: ConnectionStatus) => void> = []
	let attachmentId = initialAttachment
	const base = mockTerminal()
	return {
		...base,
		cols: 80,
		rows: 24,
		sent,
		dataHandlers,
		input(data: string, _wasUserInput: boolean) {
			sent.push(data)
		},
		onData(handler: (data: string) => void) {
			dataHandlers.push(handler)
			return { dispose() {} }
		},
		getAttachmentId() {
			return attachmentId
		},
		setAttachment(id: string | null) {
			attachmentId = id
		},
		onConnectionStatusChange(handler: (status: ConnectionStatus) => void) {
			statusListeners.push(handler)
			return { dispose() {} }
		},
		fireStatus(state: ConnectionState) {
			const status: ConnectionStatus = {
				state,
				consecutivePreSyncFailures: 0,
				lastFailureReason: null,
			}
			for (const listener of statusListeners) listener(status)
		},
	}
}

interface Deferred {
	readonly promise: Promise<void>
	readonly resolve: () => void
	readonly settled: () => boolean
}

function deferred(): Deferred {
	let settled = false
	let resolve!: () => void
	const promise = new Promise<void>((r) => {
		resolve = () => {
			settled = true
			r()
		}
	})
	return { promise, resolve, settled: () => settled }
}

function findButtonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
	for (const button of root.querySelectorAll('button')) {
		if (button.textContent === label) return button
	}
	throw new Error(`Button not found: ${label}`)
}

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

const sendToolbarConfig = () =>
	defineConfig({
		toolbar: {
			row1: [{ id: 'x', label: 'X', description: 'Send x', action: { type: 'send', data: 'x' } }],
			row2: [],
		},
	})

const ctrlToolbarConfig = () =>
	defineConfig({
		toolbar: {
			row1: [
				{
					id: 'ctrl-mod',
					label: 'Ctrl',
					description: 'Sticky Ctrl',
					action: { type: 'ctrl-modifier' },
				},
			],
			row2: [],
		},
	})

const prefixToolbarConfig = () =>
	defineConfig({
		toolbar: {
			row1: [
				{
					id: 'prefix',
					label: 'P',
					description: 'tmux prefix',
					action: { type: 'prefix', data: '\x02' },
				},
			],
			row2: [],
		},
	})

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('T4b delayed-input attachment guard', () => {
	test('horizontal swipe captured on A sends 0 after A→B before touchend', () => {
		const term = mockGuardedTerm('att-a')
		const screen = document.createElement('div')
		screen.className = 'xterm-screen'
		document.body.appendChild(screen)
		attachSwipeGestures(
			term,
			{
				enabled: true,
				left: 'L',
				right: 'R',
				leftLabel: 'L',
				rightLabel: 'R',
				threshold: 30,
				maxDuration: 500,
			},
			() => false,
		)
		const touch = (clientX: number): Touch => ({ clientX, clientY: 100 }) as unknown as Touch

		screen.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(100)] }))
		term.setAttachment('att-b')
		screen.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(0)] }))
		expect(term.sent).toEqual([])

		term.setAttachment('att-a')
		screen.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(100)] }))
		screen.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(0)] }))
		expect(term.sent).toEqual(['L'])
		document.body.removeChild(screen)
	})

	test('d-pad touch captured on A sends 0 after A→B before touchend', () => {
		const term = mockGuardedTerm('att-a')
		const { element } = createDpad(term, defaultDpadKeys, { executeAction: () => {} })
		const button = element.querySelector('button')
		if (!button) throw new Error('no d-pad button')
		const t = (id: number) =>
			({ identifier: id, target: button, clientX: 0, clientY: 0 }) as unknown as Touch

		button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t(1)] }))
		term.setAttachment('att-b')
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(1)] }))
		expect(term.sent).toEqual([])

		term.setAttachment('att-a')
		button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t(2)] }))
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(2)] }))
		button.dispatchEvent(new Event('click'))
		expect(term.sent).toEqual(['\x7f'])
	})

	test('toolbar touch action captured on A sends 0 after A→B before touchend', async () => {
		const term = mockGuardedTerm('att-a')
		const { element: toolbar } = createToolbar(
			term,
			sendToolbarConfig(),
			() => {},
			createHookRegistry(),
		)
		const button = findButtonByLabel(toolbar, 'X')

		const t = (id: number) =>
			({ identifier: id, target: button, clientX: 0, clientY: 0 }) as unknown as Touch
		button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t(1)] }))
		term.setAttachment('att-b')
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(1)] }))
		await flushMicrotasks()
		expect(term.sent).toEqual([])

		term.setAttachment('att-a')
		_resetTouchGuard()
		button.dispatchEvent(new Event('click'))
		await flushMicrotasks()
		expect(term.sent).toEqual(['x'])
	})

	test('toolbar send started on A delivers nothing after switching to B mid-hook', async () => {
		const term = mockGuardedTerm('att-a')
		const hooks = createHookRegistry()
		const gate = deferred()
		hooks.on('beforeSendData', async () => {
			await gate.promise
			return undefined
		})
		const { element: toolbar } = createToolbar(term, sendToolbarConfig(), () => {}, hooks)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'X').click()
		// Let the send chain reach the pending hook before switching targets.
		await flushMicrotasks()
		term.setAttachment('att-b')
		gate.resolve()
		await flushMicrotasks()

		expect(term.sent).toEqual([])
	})

	test('toolbar send on an unchanged generation still delivers', async () => {
		const term = mockGuardedTerm('att-a')
		const hooks = createHookRegistry()
		const gate = deferred()
		hooks.on('beforeSendData', async () => {
			await gate.promise
			return undefined
		})
		const { element: toolbar } = createToolbar(term, sendToolbarConfig(), () => {}, hooks)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'X').click()
		await flushMicrotasks()
		gate.resolve()
		await flushMicrotasks()

		expect(term.sent).toEqual(['x'])
	})

	test('deferred clipboard paste captured on A sends 0 frames after A→B', async () => {
		const term = mockGuardedTerm('att-a')
		const clipboardText = deferred()
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: async () => {
					await clipboardText.promise
					return 'hello'
				},
			},
			configurable: true,
		})
		const registry = createDefaultActionRegistry()
		const pending = registry.execute(
			{ type: 'paste' },
			{
				term,
				kbWasOpen: false,
				focusIfNeeded() {},
				sendText: async (data: string) => {
					term.input(data, true)
				},
			},
		)

		// Let the paste queue reach clipboard.readText before resolving it.
		await flushMicrotasks()
		term.setAttachment('att-b')
		clipboardText.resolve()
		await pending

		expect(term.sent).toEqual([])
	})

	test('deferred clipboard paste on an unchanged generation still delivers', async () => {
		const term = mockGuardedTerm('att-a')
		const clipboardText = deferred()
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: async () => {
					await clipboardText.promise
					return 'hello'
				},
			},
			configurable: true,
		})
		const registry = createDefaultActionRegistry()
		const pending = registry.execute(
			{ type: 'paste' },
			{
				term,
				kbWasOpen: false,
				focusIfNeeded() {},
				sendText: async (data: string) => {
					term.input(data, true)
				},
			},
		)

		await flushMicrotasks()
		clipboardText.resolve()
		await pending

		expect(term.sent).toEqual(['hello'])
	})

	test('sticky Ctrl is cancelled at switch start and sends 0 frames to B', async () => {
		const term = mockGuardedTerm('att-a')
		const { element: toolbar } = createToolbar(
			term,
			ctrlToolbarConfig(),
			() => {},
			createHookRegistry(),
		)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'Ctrl').click()
		term.fireStatus('syncing')
		term.setAttachment('att-b')
		term.fireStatus('synced')
		for (const handler of term.dataHandlers) handler('q')
		await flushMicrotasks()

		expect(term.sent).toEqual([])
	})

	test('sticky Ctrl send is generation-guarded even without a status transition', async () => {
		const term = mockGuardedTerm('att-a')
		const { element: toolbar } = createToolbar(
			term,
			ctrlToolbarConfig(),
			() => {},
			createHookRegistry(),
		)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'Ctrl').click()
		term.setAttachment('att-b')
		for (const handler of term.dataHandlers) handler('q')
		await flushMicrotasks()

		expect(term.sent).toEqual([])
	})

	test('active fling captured on A sends 0 frames after A→B', () => {
		const term = mockGuardedTerm('att-a')
		const lock = createGestureLock()
		const screen = document.createElement('div')
		screen.className = 'xterm-screen'
		Object.defineProperty(screen, 'getBoundingClientRect', {
			value: () => ({
				left: 0,
				top: 0,
				width: 800,
				height: 480,
				right: 800,
				bottom: 480,
				x: 0,
				y: 0,
				toJSON() {},
			}),
		})
		document.body.appendChild(screen)

		const rafQueue: FrameRequestCallback[] = []
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafQueue.push(cb)
			return rafQueue.length
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())

		const scrollConfig = {
			enabled: true,
			strategy: 'wheel' as const,
			speedMultiplier: 1,
			linesPerWheel: 1,
			momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
			maxLinesPerSend: 24,
			sendIntervalMs: 0,
		}
		attachScrollGesture(term, scrollConfig, lock, () => false)

		const makeTouch = (clientY: number): Touch =>
			({
				identifier: 0,
				target: screen,
				clientX: 400,
				clientY,
			}) as unknown as Touch
		screen.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [makeTouch(400)],
			}),
		)
		// Fast upward strokes → velocity above minVelocity → fling on touchend.
		for (let i = 1; i <= 5; i++) {
			screen.dispatchEvent(
				new TouchEvent('touchmove', {
					bubbles: true,
					cancelable: true,
					touches: [makeTouch(400 - i * 40)],
				}),
			)
		}
		screen.dispatchEvent(
			new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }),
		)

		// Switch target while the fling is still animating.
		term.setAttachment('att-b')
		let now = 0
		while (rafQueue.length > 0) {
			now += 16
			rafQueue.shift()?.(now)
		}

		expect(term.sent).toEqual([])
		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})

	test('scroll remainder from A is cleared before a new B gesture', () => {
		const term = mockGuardedTerm('att-a')
		const lock = createGestureLock()
		const screen = document.createElement('div')
		screen.className = 'xterm-screen'
		Object.defineProperty(screen, 'getBoundingClientRect', {
			value: () => ({
				left: 0,
				top: 0,
				width: 800,
				height: 480,
				right: 800,
				bottom: 480,
				x: 0,
				y: 0,
				toJSON() {},
			}),
		})
		document.body.appendChild(screen)
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(16)
			return 1
		})
		vi.stubGlobal('cancelAnimationFrame', vi.fn())
		const config = {
			enabled: true,
			strategy: 'wheel' as const,
			speedMultiplier: 1,
			linesPerWheel: 1,
			momentum: { enabled: false, friction: 0.95, minVelocity: 0.02 },
			maxLinesPerSend: 24,
			sendIntervalMs: 0,
		}
		attachScrollGesture(term, config, lock, () => false)
		const touch = (clientY: number): Touch =>
			({
				identifier: 0,
				target: screen,
				clientX: 400,
				clientY,
			}) as unknown as Touch

		screen.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(100)] }))
		screen.dispatchEvent(new TouchEvent('touchmove', { cancelable: true, touches: [touch(139)] }))
		expect(term.sent).toEqual([scrollSeq('up', 41, 6)])
		term.sent.length = 0
		term.fireStatus('syncing')
		term.setAttachment('att-b')
		term.fireStatus('synced')
		screen.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(200)] }))
		screen.dispatchEvent(new TouchEvent('touchmove', { cancelable: true, touches: [touch(221)] }))

		expect(term.sent).toEqual([scrollSeq('up', 41, 11)])
		document.body.removeChild(screen)
		vi.unstubAllGlobals()
	})

	test('long-press repeat is guarded and stops on target switch', () => {
		vi.useFakeTimers()
		const term = mockGuardedTerm('att-a')
		const { element } = createScrollButtons(term, {
			enabled: true,
			strategy: 'keys',
			speedMultiplier: 1,
			linesPerWheel: 1,
			momentum: { enabled: false, friction: 0.95, minVelocity: 0.02 },
			maxLinesPerSend: 24,
			sendIntervalMs: 0,
		})
		const button = element.querySelector('button')
		if (!(button instanceof HTMLButtonElement)) throw new Error('no scroll button')
		button.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, touches: [] }))
		vi.advanceTimersByTime(500)
		const sentOnA = term.sent.length
		expect(sentOnA).toBeGreaterThan(1)

		term.setAttachment('att-b')
		term.fireStatus('syncing')
		vi.advanceTimersByTime(500)

		expect(term.sent).toHaveLength(sentOnA)
		vi.useRealTimers()
	})

	test('prefix combo pick captured on A sends 0 frames after A→B', async () => {
		const term = mockGuardedTerm('att-a')
		const hooks = createHookRegistry()
		let pickerSendText: ((data: string) => Promise<void>) | undefined
		const { element: toolbar } = createToolbar(
			term,
			prefixToolbarConfig(),
			() => {},
			hooks,
			undefined,
			(options) => {
				pickerSendText = options.sendText
			},
		)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'P').click()
		await flushMicrotasks()
		// The prefix byte itself went out immediately on A.
		expect(term.sent).toEqual(['\x02'])
		const sendPick = pickerSendText
		if (!sendPick) throw new Error('combo picker did not open')

		term.setAttachment('att-b')
		await sendPick('r')

		expect(term.sent).toEqual(['\x02'])
	})

	test('prefix combo pick on an unchanged generation still delivers', async () => {
		const term = mockGuardedTerm('att-a')
		const hooks = createHookRegistry()
		let pickerSendText: ((data: string) => Promise<void>) | undefined
		const { element: toolbar } = createToolbar(
			term,
			prefixToolbarConfig(),
			() => {},
			hooks,
			undefined,
			(options) => {
				pickerSendText = options.sendText
			},
		)
		document.body.appendChild(toolbar)

		findButtonByLabel(toolbar, 'P').click()
		await flushMicrotasks()
		const sendPick = pickerSendText
		if (!sendPick) throw new Error('combo picker did not open')

		await sendPick('r')

		expect(term.sent).toEqual(['\x02', 'r'])
	})

	test('drawer send started on A delivers nothing after switching to B mid-hook', async () => {
		const term = mockGuardedTerm('att-a')
		const hooks = createHookRegistry()
		const gate = deferred()
		hooks.on('beforeSendData', async () => {
			await gate.promise
			return undefined
		})
		const config = defineConfig({
			drawer: {
				buttons: [
					{ id: 'd', label: 'D', description: 'Drawer send', action: { type: 'send', data: 'd' } },
				],
			},
		})
		const drawer = createDrawer(term, config.drawer.buttons, { hooks, appConfig: config })
		document.body.appendChild(drawer.drawer)

		findButtonByLabel(drawer.drawer, 'D').click()
		// Let the send chain reach the pending hook before switching targets.
		await flushMicrotasks()
		term.setAttachment('att-b')
		gate.resolve()
		await flushMicrotasks()

		expect(term.sent).toEqual([])
	})
})
