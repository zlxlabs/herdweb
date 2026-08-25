import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
	type ImageDropController,
	createImageDropController,
} from '../src/controls/image-drop-controller'
import { type TargetSummary, X_HERDWEB_ATTACHMENT_ID_HEADER } from '../src/session-protocol'
import type { InputActionResult } from '../src/types'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.useRealTimers()
	GlobalRegistrator.unregister()
})

const PATH = '/tmp/herdweb-drop-1.png'
const png = () => new File(['x'], 'a.png', { type: 'image/png' })
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function jsonResponse(body: unknown, status = 200): Response {
	return { ok: status === 200, status, json: () => Promise.resolve(body) } as unknown as Response
}

function setup(
	options: {
		imageDrop?: 'local-path' | 'disabled'
		attachmentId?: string | null
		paste?: boolean
	} = {},
) {
	const sent: Array<{ id: string; data: string }> = []
	const listeners = new Set<(result: InputActionResult) => void>()
	const connectionListeners = new Set<(connected: boolean) => void>()
	const attachment = { id: options.attachmentId === undefined ? 'att-1' : options.attachmentId }
	let connected = attachment.id !== null
	const targets = [
		{
			id: 'default',
			capabilities: { imageDrop: options.imageDrop ?? 'local-path' },
		} as TargetSummary,
	]
	let aid = 0
	const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ path: PATH })))
	const writeText = vi.fn(() => Promise.resolve())
	const toastSpy = vi.fn()
	const pasteTarget = document.createElement('textarea')
	document.body.appendChild(pasteTarget)
	const controller = createImageDropController({
		term: {
			isConnected: () => connected && attachment.id !== null,
			onConnectionChange: (handler: (connected: boolean) => void) => {
				connectionListeners.add(handler)
				handler(connected)
				return { dispose: () => connectionListeners.delete(handler) }
			},
			getAttachmentId: () => attachment.id,
			getTargets: () => targets,
			getCurrentTargetId: () => 'default',
			sendInputAction: (id: string, data: string) => {
				sent.push({ id, data })
				return true
			},
			onInputActionResult: (handler: (result: InputActionResult) => void) => {
				listeners.add(handler)
				return { dispose: () => listeners.delete(handler) }
			},
		},
		basePath: '/herdweb',
		fetchFn: fetchMock as unknown as typeof fetch,
		clipboard: { writeText },
		createActionId: () => {
			aid += 1
			return `a${aid}`
		},
		ackTimeoutMs: 30,
		showToastFn: toastSpy,
		...(options.paste ? { pasteTarget } : {}),
	})
	const emit = (result: InputActionResult) => {
		for (const listener of listeners) listener(result)
	}
	const emitConnection = (next: boolean) => {
		connected = next
		for (const listener of connectionListeners) listener(next)
	}
	return {
		controller,
		attachment,
		sent,
		emit,
		emitConnection,
		fetchMock,
		writeText,
		toastSpy,
		pasteTarget,
	}
}

function query<T extends HTMLElement>(c: ImageDropController, sel: string): T {
	const found = c.element.querySelector<T>(sel)
	if (!found) throw new Error(`missing ${sel}`)
	return found
}

const statusText = (c: ImageDropController) => query(c, '.wt-image-drop-status').textContent

function pick(c: ImageDropController, file: File | null): void {
	const input = query<HTMLInputElement>(c, 'input')
	Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true })
	input.dispatchEvent(new Event('change'))
}

interface FakeClipboardItem {
	readonly kind: string
	readonly type: string
	readonly file?: File
}

function paste(target: HTMLElement, items: readonly FakeClipboardItem[]): ClipboardEvent {
	const clipboardData = {
		items: items.map((item) => ({
			kind: item.kind,
			type: item.type,
			getAsFile: () => item.file ?? null,
		})),
	} as unknown as DataTransfer
	const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
	target.dispatchEvent(event)
	return event
}

test('picker: cancel hides the panel; reset allows re-select; single-flight; raw File POST', async () => {
	const h = setup()
	const clickSpy = vi.spyOn(query<HTMLInputElement>(h.controller, 'input'), 'click')
	h.controller.open()
	pick(h.controller, null)
	expect(h.controller.element.style.display).toBe('none')
	h.controller.open()
	const file = png()
	pick(h.controller, file)
	h.controller.open()
	await flush()
	expect(clickSpy).toHaveBeenCalledTimes(2)
	expect(h.fetchMock).toHaveBeenCalledTimes(1)
	expect(h.fetchMock).toHaveBeenCalledWith('/herdweb/api/image-drop', {
		method: 'POST',
		body: file,
		headers: { [X_HERDWEB_ATTACHMENT_ID_HEADER]: 'att-1' },
	})
	expect(query<HTMLInputElement>(h.controller, 'input').value).toBe('')
	pick(h.controller, png())
	await flush()
	expect(h.fetchMock).toHaveBeenCalledTimes(2)
})

test('failures: HTTP status, malformed 200, rejected, lost ACK — all keep a visible safe state', async () => {
	for (const status of [415, 500]) {
		const h = setup()
		h.fetchMock.mockResolvedValue(jsonResponse({}, status))
		pick(h.controller, png())
		await flush()
		expect(statusText(h.controller)).toContain(`HTTP ${status}`)
		expect(h.controller.element.style.display).toBe('flex')
	}
	const bad = setup()
	bad.fetchMock.mockResolvedValueOnce({
		ok: true,
		status: 200,
		json: () => Promise.reject(new Error('bad')),
	} as unknown as Response)
	pick(bad.controller, png())
	await flush()
	expect(statusText(bad.controller)).toContain('bad response')
	bad.fetchMock.mockResolvedValueOnce(jsonResponse({}))
	pick(bad.controller, png())
	await flush()
	expect(statusText(bad.controller)).toContain('no path')
	const h = setup()
	pick(h.controller, png())
	await flush()
	h.emit({ id: 'image-drop-a1', accepted: false, reason: 'id-conflict' })
	expect(statusText(h.controller)).toContain('Insert rejected (id-conflict)')
	expect(query(h.controller, '.wt-image-drop-path').textContent).toBe(PATH)
	const retryBtn = query<HTMLButtonElement>(h.controller, '.wt-image-drop-retry')
	retryBtn.click()
	expect(h.sent.map((s) => s.id)).toEqual(['image-drop-a1', 'image-drop-a1'])
	// Manual retry re-enters 'inserting' with the panel hidden — a toast must
	// carry the wait, or the user sits silent until the ACK timeout.
	expect(h.toastSpy).toHaveBeenLastCalledWith('Inserting path…')
	expect(h.controller.element.style.display).toBe('none')
	vi.useFakeTimers()
	h.emit({ id: 'image-drop-a1', accepted: false, reason: 'id-conflict' })
	retryBtn.click()
	h.attachment.id = 'att-2'
	h.emitConnection(false)
	expect(statusText(h.controller)).toContain('stale')
	await vi.advanceTimersByTimeAsync(31)
	expect(query(h.controller, '.wt-image-drop-path').style.display).toBe('none')
	expect(query(h.controller, '.wt-image-drop-actions').style.display).toBe('none')
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-copy').click()
	expect(h.writeText).not.toHaveBeenCalled()
	const rejectedStatus = statusText(h.controller)
	h.controller.dispose()
	h.emitConnection(false)
	expect(statusText(h.controller)).toBe(rejectedStatus)
})

test('gating: session/freshness guard auto-insert; stale ACKs are safe; success path toasts only', async () => {
	const h = setup()
	pick(h.controller, png())
	expect(h.toastSpy).toHaveBeenLastCalledWith('Uploading a.png…')
	expect(h.controller.element.style.display).toBe('none')
	await flush()
	expect(h.sent).toEqual([{ id: 'image-drop-a1', data: ` ${PATH} ` }])
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(h.toastSpy).toHaveBeenLastCalledWith('Inserted into agent input.')
	expect(h.controller.element.style.display).toBe('none')
	pick(h.controller, png())
	await flush()
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(h.toastSpy).toHaveBeenCalledTimes(5) // stale ACK: still inserting, no new toast
	h.emit({ id: 'image-drop-a2', accepted: true, reason: null })
	expect(h.toastSpy).toHaveBeenLastCalledWith('Inserted into agent input.')
	expect(h.controller.element.style.display).toBe('none')
})

test('done toast: panel stays hidden, toast carries success, auto-returns to idle after ~2.5s', async () => {
	const h = setup()
	vi.useFakeTimers()
	const pathText = query(h.controller, '.wt-image-drop-path')
	const actions = query(h.controller, '.wt-image-drop-actions')

	pick(h.controller, png())
	await vi.advanceTimersByTimeAsync(0) // upload resolves → auto-insert
	expect(h.sent).toHaveLength(1)
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(h.toastSpy).toHaveBeenLastCalledWith('Inserted into agent input.')
	expect(h.toastSpy).toHaveBeenCalledTimes(3) // uploading → inserting → done
	h.emitConnection(false) // 'done' survives a connection blip without a stale error
	expect(h.toastSpy).toHaveBeenCalledTimes(3)
	expect(h.controller.element.style.display).toBe('none')
	expect(pathText.style.display).toBe('none')
	expect(actions.style.display).toBe('none')
	await vi.advanceTimersByTimeAsync(2_499)
	expect(statusText(h.controller)).toBe('Inserted into agent input.')
	await vi.advanceTimersByTimeAsync(1)
	expect(statusText(h.controller)).toBe('') // back to idle
	expect(h.controller.element.style.display).toBe('none')
})

test('dispose: a pending done-to-idle timer must not move state after dispose', async () => {
	const h = setup()
	vi.useFakeTimers()
	pick(h.controller, png())
	await vi.advanceTimersByTimeAsync(0)
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	h.controller.dispose()
	await vi.advanceTimersByTimeAsync(3_000)
	expect(statusText(h.controller)).toBe('Inserted into agent input.')
})

test('lifecycle: rejected path clears immediately on attachment switch', async () => {
	const h = setup()
	pick(h.controller, png())
	await flush()
	h.emit({ id: 'image-drop-a1', accepted: false, reason: 'id-conflict' })
	h.attachment.id = 'att-2'
	h.emitConnection(false)
	expect(statusText(h.controller)).toContain('stale')
	expect(query(h.controller, '.wt-image-drop-path').style.display).toBe('none')
	expect(query(h.controller, '.wt-image-drop-actions').style.display).toBe('none')
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-retry').click()
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-copy').click()
	expect(h.writeText).not.toHaveBeenCalled()
})

test('capability and attachment gates: no request when disabled or unsynced; switch blocks insert', async () => {
	const unsynced = setup({ attachmentId: null })
	pick(unsynced.controller, png())
	expect(unsynced.fetchMock).not.toHaveBeenCalled()
	expect(statusText(unsynced.controller)).toContain('syncing')

	const h = setup()
	h.fetchMock.mockResolvedValueOnce(jsonResponse({ path: PATH }))
	pick(h.controller, png())
	h.attachment.id = 'att-2'
	await flush()
	expect(h.sent).toHaveLength(0)
	expect(statusText(h.controller)).toContain('Upload became stale')
})

test('paste: clipboard image uploads via the same pipeline and prevents default', async () => {
	const h = setup({ paste: true })
	const file = png()
	const event = paste(h.pasteTarget, [
		{ kind: 'string', type: 'text/plain' },
		{ kind: 'file', type: 'image/png', file },
	])
	expect(event.defaultPrevented).toBe(true)
	expect(h.fetchMock).toHaveBeenCalledTimes(1)
	expect(h.fetchMock).toHaveBeenCalledWith('/herdweb/api/image-drop', {
		method: 'POST',
		body: file,
		headers: { [X_HERDWEB_ATTACHMENT_ID_HEADER]: 'att-1' },
	})
	await flush()
	expect(h.sent).toEqual([{ id: 'image-drop-a1', data: ` ${PATH} ` }])
})

test('paste: text-only clipboard is left to the terminal untouched', () => {
	const h = setup({ paste: true })
	const event = paste(h.pasteTarget, [{ kind: 'string', type: 'text/plain' }])
	expect(event.defaultPrevented).toBe(false)
	expect(h.fetchMock).not.toHaveBeenCalled()
})

test('paste: no pasteTarget wires no listener; unsynced paste reuses not-ready gate; dispose stops uploads', () => {
	const noTarget = setup()
	const stray = paste(noTarget.pasteTarget, [{ kind: 'file', type: 'image/png', file: png() }])
	expect(stray.defaultPrevented).toBe(false)
	expect(noTarget.fetchMock).not.toHaveBeenCalled()

	const unsynced = setup({ attachmentId: null, paste: true })
	paste(unsynced.pasteTarget, [{ kind: 'file', type: 'image/png', file: png() }])
	expect(unsynced.fetchMock).not.toHaveBeenCalled()
	expect(statusText(unsynced.controller)).toContain('syncing')

	const h = setup({ paste: true })
	h.controller.dispose()
	const afterDispose = paste(h.pasteTarget, [{ kind: 'file', type: 'image/png', file: png() }])
	expect(afterDispose.defaultPrevented).toBe(false)
	expect(h.fetchMock).not.toHaveBeenCalled()
})
