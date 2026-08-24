import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { XTerminal } from '../src/types'
import { _resetTouchGuard, onAttachmentTap, onTap } from '../src/util/tap'

function touch(id: number, target: EventTarget): Touch {
	return { identifier: id, target, clientX: 0, clientY: 0 } as unknown as Touch
}

function mockAttachmentTerm(
	initial: string | null,
): XTerminal & { setAttachment(id: string | null): void } {
	let attachmentId = initial
	return {
		getAttachmentId: () => attachmentId,
		setAttachment(id: string | null) {
			attachmentId = id
		},
	} as XTerminal & { setAttachment(id: string | null): void }
}

describe('onTap', () => {
	beforeEach(() => {
		_resetTouchGuard()
	})

	test('fires handler on click', () => {
		const element = document.createElement('button')
		const handler = vi.fn()
		onTap(element, handler)
		element.click()
		expect(handler).toHaveBeenCalledOnce()
	})

	test('fires handler on touchend', () => {
		const element = document.createElement('button')
		const handler = vi.fn()
		onTap(element, handler)
		element.dispatchEvent(new TouchEvent('touchend'))
		expect(handler).toHaveBeenCalledOnce()
	})

	test('does not double-fire when touchend precedes click', () => {
		const element = document.createElement('button')
		const handler = vi.fn()
		onTap(element, handler)
		element.dispatchEvent(new TouchEvent('touchend'))
		element.click()
		expect(handler).toHaveBeenCalledOnce()
	})

	test('touchend does not call preventDefault', () => {
		const element = document.createElement('button')
		onTap(element, () => {})
		const event = new TouchEvent('touchend')
		element.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(false)
	})

	test('click fires again after guard timeout', () => {
		vi.useFakeTimers()
		const element = document.createElement('button')
		const handler = vi.fn()
		onTap(element, handler)

		element.dispatchEvent(new TouchEvent('touchend'))
		expect(handler).toHaveBeenCalledOnce()

		vi.advanceTimersByTime(400)
		element.click()
		expect(handler).toHaveBeenCalledTimes(2)

		vi.useRealTimers()
	})

	test('touchend on element A suppresses click on element B', () => {
		const a = document.createElement('button')
		const b = document.createElement('button')
		const handlerA = vi.fn()
		const handlerB = vi.fn()
		onTap(a, handlerA)
		onTap(b, handlerB)

		a.dispatchEvent(new TouchEvent('touchend'))
		b.dispatchEvent(new Event('click'))

		expect(handlerA).toHaveBeenCalledOnce()
		expect(handlerB).not.toHaveBeenCalled()
	})

	test('cross-element click works after guard timeout', () => {
		vi.useFakeTimers()
		const a = document.createElement('button')
		const b = document.createElement('button')
		const handlerA = vi.fn()
		const handlerB = vi.fn()
		onTap(a, handlerA)
		onTap(b, handlerB)

		a.dispatchEvent(new TouchEvent('touchend'))
		vi.advanceTimersByTime(400)
		b.dispatchEvent(new Event('click'))

		expect(handlerB).toHaveBeenCalledOnce()

		vi.useRealTimers()
	})
})

describe('onAttachmentTap', () => {
	beforeEach(() => {
		_resetTouchGuard()
	})

	test('F1 on A then F2 on B: F1 end zero bytes, F2 end exactly one', () => {
		const term = mockAttachmentTerm('att-a')
		const button = document.createElement('button')
		const handler = vi.fn()
		onAttachmentTap(term, button, handler)
		const f1 = touch(1, button)
		const f2 = touch(2, button)
		button.dispatchEvent(new TouchEvent('touchstart', { touches: [f1], changedTouches: [f1] }))
		term.setAttachment('att-b')
		button.dispatchEvent(new TouchEvent('touchstart', { touches: [f1, f2], changedTouches: [f2] }))
		button.dispatchEvent(new TouchEvent('touchend', { touches: [f2], changedTouches: [f1] }))
		expect(handler).not.toHaveBeenCalled()
		button.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [f2] }))
		expect(handler).toHaveBeenCalledOnce()
	})

	test('touchcancel, unknown identifier, and empty changedTouches all fail closed', () => {
		const term = mockAttachmentTerm('att-a')
		const button = document.createElement('button')
		const handler = vi.fn()
		onAttachmentTap(term, button, handler)
		button.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [touch(1, button)] }))
		button.dispatchEvent(new TouchEvent('touchcancel', { changedTouches: [touch(1, button)] }))
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(1, button)] }))
		button.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(9, button)] }))
		button.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [] }))
		expect(handler).not.toHaveBeenCalled()
	})
})
