import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConfig } from '../src/config'
import { createHookRegistry } from '../src/hooks/registry'
import { init } from '../src/index'
import type { ConnectionStatus, XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

beforeEach(() => {
	GlobalRegistrator.register()
	Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
	Object.defineProperty(document, 'fonts', {
		configurable: true,
		value: { ready: Promise.resolve() },
	})
})

afterEach(() => {
	window.term = undefined
	GlobalRegistrator.unregister()
	vi.restoreAllMocks()
})

describe('mobile init attachment guard', () => {
	test('drops initData after an async hook crosses A→B', async () => {
		const sent: string[] = []
		let attachmentId = 'att-a'
		const status: ConnectionStatus = {
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		}
		const term: XTerminal = {
			...mockTerminal(),
			input(data: string) {
				sent.push(data)
			},
			getAttachmentId: () => attachmentId,
			getConnectionStatus: () => status,
			onConnectionStatusChange(handler: (next: ConnectionStatus) => void) {
				handler(status)
				return { dispose() {} }
			},
		}
		window.term = term
		const hooks = createHookRegistry()
		const gate = deferred()
		hooks.on('beforeSendData', async () => {
			await gate.promise
			return undefined
		})

		init(defineConfig({ mobile: { initData: 'init\r' } }), hooks)
		await vi.waitFor(() => expect(document.getElementById('wt-toolbar')).not.toBeNull())
		attachmentId = 'att-b'
		gate.resolve()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(sent).toEqual([])
	})
})
