import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setupReconnect } from '../src/reconnect'
import type { ConnectionStatus, XTerminal } from '../src/types'

function mockConnectionTerminal(
	initial: ConnectionStatus = {
		state: 'disconnected',
		consecutivePreSyncFailures: 0,
		lastFailureReason: null,
	},
): XTerminal & { setStatus(status: ConnectionStatus): void; reconnectCalls: number } {
	let status = initial
	const listeners = new Set<(next: ConnectionStatus) => void>()
	const term = {
		reconnectCalls: 0,
		options: { fontSize: 14 },
		input() {},
		focus() {},
		onData() {
			return { dispose() {} }
		},
		isConnected: () => status.state === 'synced',
		onConnectionChange() {
			return { dispose() {} }
		},
		getConnectionStatus: () => status,
		onConnectionStatusChange(handler: (next: ConnectionStatus) => void) {
			listeners.add(handler)
			handler(status)
			return { dispose: () => listeners.delete(handler) }
		},
		requestReconnect() {
			term.reconnectCalls += 1
		},
		getSessionId() {
			return 'test-session'
		},
		sendInputAction() {
			return true
		},
		onInputActionResult() {
			return { dispose() {} }
		},
		setStatus(next: ConnectionStatus) {
			status = next
			for (const listener of listeners) listener(status)
		},
	}
	return term
}

function getOverlay(): HTMLElement | null {
	return document.getElementById('herdweb-reconnect-overlay')
}

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	// Clean up any overlay left behind
	getOverlay()?.remove()
	window.__herdwebSockets = undefined
	GlobalRegistrator.unregister()
})

describe('setupReconnect', () => {
	test.each([
		['disconnected', 'Disconnected'],
		['reconnecting', 'Reconnecting…'],
		['syncing', 'Syncing…'],
		['synced', 'Synced'],
	] as const)('renders the %s state', (state, text) => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		if (state !== 'disconnected') {
			term.setStatus({ state, consecutivePreSyncFailures: 0, lastFailureReason: null })
		}
		const overlay = getOverlay()
		expect(overlay?.dataset.connectionState).toBe(state)
		expect(overlay?.querySelector('div')?.textContent).toBe(text)
		expect(overlay?.style.display).toBe(state === 'synced' ? 'none' : 'flex')
		expect(overlay?.dataset.layout).toBe(state === 'synced' ? 'banner' : 'modal')
		dispose()
	})

	test('disabled mode does not render an overlay', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: false })
		expect(getOverlay()).toBeNull()
		dispose()
	})

	test('dispose removes overlay from DOM', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: true })
		expect(getOverlay()).not.toBeNull()
		dispose()
		expect(getOverlay()).toBeNull()
	})

	test('overlay contains reconnect button', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: true })
		const overlay = getOverlay()
		const buttons = [...(overlay?.querySelectorAll('button') ?? [])]
		expect(buttons.map((button) => button.textContent)).toEqual(['Retry now', 'Re-authenticate'])
		dispose()
	})

	test.each(['button', 'backdrop', 'message'] as const)(
		'clicking %s forwards immediate retry once',
		(target) => {
			const term = mockConnectionTerminal()
			const dispose = setupReconnect(term, { enabled: true })
			const overlay = getOverlay()
			const targetElement =
				target === 'button'
					? overlay?.querySelector('button')
					: target === 'message'
						? overlay?.querySelector('div')
						: overlay
			targetElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			expect(term.reconnectCalls).toBe(1)
			dispose()
		},
	)

	test.each([
		['socket-closed', 'Connection failed — you may need to re-authenticate.', 3, true],
		['protocol-error', 'Connection failed — refresh, and check the server version.', 3, false],
		['output-overflow', 'Output too fast — resyncing.', 1, false],
	] as const)('failure hint renders correctly for %s', (reason, message, failures, reloadable) => {
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: failures,
			lastFailureReason: reason,
		})
		const buttons = [...(getOverlay()?.querySelectorAll('button') ?? [])]
		expect(getOverlay()?.querySelector('div')?.textContent).toBe(message)
		expect(buttons[1]?.style.display).toBe(failures >= 3 ? 'block' : 'none')
		if (reloadable) {
			buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			expect(reload).toHaveBeenCalledTimes(1)
		}
		dispose()
		reload.mockRestore()
	})

	test('connection notice replaces the state message without a second overlay', () => {
		const term = mockConnectionTerminal({
			state: 'syncing',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		window.dispatchEvent(
			new CustomEvent('herdweb-connection-notice', { detail: 'Not sent — still syncing.' }),
		)
		expect(document.querySelectorAll('#herdweb-reconnect-overlay')).toHaveLength(1)
		expect(getOverlay()?.querySelector('div')?.textContent).toBe('Not sent — still syncing.')
		dispose()
	})

	test('session-ended notice hides re-authentication but keeps retry available', () => {
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
		const term = mockConnectionTerminal({
			state: 'reconnecting',
			consecutivePreSyncFailures: 3,
			lastFailureReason: 'socket-closed',
		})
		const dispose = setupReconnect(term, { enabled: true })
		window.dispatchEvent(
			new CustomEvent('herdweb-connection-notice', {
				detail: 'Session ended — restart herdweb to start a new one.',
			}),
		)
		const buttons = [...(getOverlay()?.querySelectorAll('button') ?? [])]
		expect(getOverlay()?.querySelector('div')?.textContent).toBe(
			'Session ended — restart herdweb to start a new one.',
		)
		expect(buttons[0]?.textContent).toBe('Retry now')
		expect(buttons[1]?.textContent).toBe('Re-authenticate')
		expect(buttons[1]?.style.display).toBe('none')
		buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(term.reconnectCalls).toBe(1)
		expect(reload).not.toHaveBeenCalled()
		dispose()
		reload.mockRestore()
	})

	test('first-load non-synced states use a fullscreen modal overlay', () => {
		const term = mockConnectionTerminal({
			state: 'syncing',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		const overlay = getOverlay()
		expect(overlay?.dataset.layout).toBe('modal')
		expect(overlay?.style.display).toBe('flex')
		expect(overlay?.style.inset).toBe('0')
		expect(overlay?.style.flexDirection).toBe('column')
		dispose()
	})

	test('after a prior sync, reconnecting uses a non-blocking banner', () => {
		const term = mockConnectionTerminal({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		const overlay = getOverlay()
		expect(overlay?.style.display).toBe('none')
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		expect(overlay?.dataset.layout).toBe('banner')
		expect(overlay?.style.display).toBe('flex')
		expect(overlay?.style.top).toBe('0px')
		expect(overlay?.style.bottom).toBe('auto')
		expect(overlay?.style.inset).toBe('')
		expect(overlay?.style.minHeight).toBe('44px')
		expect(overlay?.style.borderBottom).toBe('1px solid #cba6f7')
		expect(overlay?.querySelector('div')?.textContent).toBe('Reconnecting…')
		expect(overlay?.querySelectorAll('button')[0]?.textContent).toBe('Retry now')
		dispose()
	})

	test('banner keeps the four status messages and hides on synced', () => {
		const term = mockConnectionTerminal({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		const overlay = getOverlay()
		for (const [state, text] of [
			['disconnected', 'Disconnected'],
			['reconnecting', 'Reconnecting…'],
			['syncing', 'Syncing…'],
		] as const) {
			term.setStatus({ state, consecutivePreSyncFailures: 0, lastFailureReason: null })
			expect(overlay?.dataset.layout).toBe('banner')
			expect(overlay?.querySelector('div')?.textContent).toBe(text)
			expect(overlay?.style.display).toBe('flex')
		}
		term.setStatus({ state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null })
		expect(overlay?.style.display).toBe('none')
		dispose()
	})

	test('banner after three failures shows auth and only reloads from that button', () => {
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
		const term = mockConnectionTerminal({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: 3,
			lastFailureReason: 'socket-closed',
		})
		const overlay = getOverlay()
		expect(overlay?.dataset.layout).toBe('banner')
		expect(overlay?.querySelector('div')?.textContent).toBe(
			'Connection failed — you may need to re-authenticate.',
		)
		const buttons = [...(overlay?.querySelectorAll('button') ?? [])]
		expect(buttons[1]?.style.display).toBe('block')
		buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(reload).toHaveBeenCalledTimes(1)
		expect(term.reconnectCalls).toBe(0)
		dispose()
		reload.mockRestore()
	})

	test.each(['button', 'backdrop', 'message'] as const)(
		'banner click on %s forwards immediate retry once',
		(target) => {
			const term = mockConnectionTerminal({
				state: 'synced',
				consecutivePreSyncFailures: 0,
				lastFailureReason: null,
			})
			const dispose = setupReconnect(term, { enabled: true })
			term.setStatus({
				state: 'reconnecting',
				consecutivePreSyncFailures: 0,
				lastFailureReason: null,
			})
			const overlay = getOverlay()
			expect(overlay?.dataset.layout).toBe('banner')
			const targetElement =
				target === 'button'
					? overlay?.querySelector('button')
					: target === 'message'
						? overlay?.querySelector('div')
						: overlay
			targetElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			expect(term.reconnectCalls).toBe(1)
			dispose()
		},
	)

	test('synced clears an explicit session-ended notice', () => {
		const term = mockConnectionTerminal({
			state: 'reconnecting',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		window.dispatchEvent(
			new CustomEvent('herdweb-connection-notice', {
				detail: 'Session ended — restart herdweb to start a new one.',
			}),
		)
		term.setStatus({ state: 'synced', consecutivePreSyncFailures: 0, lastFailureReason: null })
		expect(getOverlay()?.querySelector('div')?.textContent).toBe('Synced')
		expect(getOverlay()?.style.display).toBe('none')
		dispose()
	})
})
