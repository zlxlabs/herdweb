import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LEGACY_COMPOSER_STORAGE_KEY_PREFIX, createAsrPreview } from '../src/controls/asr-preview'

const COMPOSER_STORAGE_KEY = 'herdweb:composer:v1:/:default'
const LEGACY_COMPOSER_STORAGE_KEY = `${LEGACY_COMPOSER_STORAGE_KEY_PREFIX}/`
const DRAFT_RESTORE_FAILURE = 'Draft could not be restored; stored copy left untouched.'
const DRAFT_CORRUPT_RESET = 'Draft storage was corrupt and has been reset; your text is saved.'
const DRAFT_STORAGE_FAILURE = 'Draft is not protected on this device.'
let localStorageDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
	GlobalRegistrator.register()
	localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
	localStorage.clear()
})

afterEach(() => {
	if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
	localStorageDescriptor = undefined
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

function readStoredComposer(): unknown {
	const raw = localStorage.getItem(COMPOSER_STORAGE_KEY)
	if (raw === null) throw new Error('composer store was not written')
	return JSON.parse(raw) as unknown
}

describe('composer draft persistence', () => {
	test('serialises typed draft with the fixed schema', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.input.value = '第一行\n第二行\n第三行'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(readStoredComposer()).toEqual({
			version: 1,
			draft: '第一行\n第二行\n第三行',
			pending: null,
		})
	})

	test('restores a serialised draft when the composer is created', () => {
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: '长草稿', pending: null }),
		)

		const composer = createAsrPreview({ defaultTargetId: 'default' })

		expect(composer.getText()).toBe('长草稿')
		expect(composer.isOpen()).toBe(false)
		expect(composer.element.style.display).toBe('none')
		expect(composer.input.style.height).toBe('48px')
	})

	test('final text and reset preserve the stored pending value', () => {
		const pending = {
			id: 'a',
			sessionId: 'session',
			sourceText: 'source',
			data: 'data',
			status: 'pending',
		}
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'old', pending }),
		)
		const composer = createAsrPreview({ defaultTargetId: 'default' })

		composer.show('final text')
		expect(readStoredComposer()).toEqual({ version: 1, draft: 'final text', pending })

		composer.resetDraft()
		expect(readStoredComposer()).toEqual({ version: 1, draft: '', pending })
	})

	test('typing preserves a legal pending value', () => {
		const pending = {
			id: 'a',
			sessionId: 'session',
			sourceText: 'source',
			data: 'data',
			status: 'pending',
		}
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'old', pending }),
		)
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()
		composer.input.value = 'typed over pending'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(readStoredComposer()).toEqual({ version: 1, draft: 'typed over pending', pending })
	})

	test.each([
		['bad JSON', '{ corrupt json'],
		['wrong version', JSON.stringify({ version: 2, draft: 'old', pending: null })],
	])('typing over %s replaces it with the current draft', (_label, raw) => {
		localStorage.setItem(COMPOSER_STORAGE_KEY, raw)
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()
		expect(composer.isOpen()).toBe(true)

		composer.input.value = 'new draft after recovery'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(readStoredComposer()).toEqual({
			version: 1,
			draft: 'new draft after recovery',
			pending: null,
		})
		expect(composer.message.textContent).toBe(DRAFT_CORRUPT_RESET)

		composer.input.value = 'second draft'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))
		expect(readStoredComposer()).toEqual({ version: 1, draft: 'second draft', pending: null })
		expect(composer.message.textContent).toBe(DRAFT_CORRUPT_RESET)
	})

	test('partial text does not change the serialised draft', () => {
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'saved draft', pending: null }),
		)
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		const before = localStorage.getItem(COMPOSER_STORAGE_KEY)

		vi.useFakeTimers()
		composer.setPartial('intermediate result')
		vi.advanceTimersByTime(20)
		vi.useRealTimers()

		expect(localStorage.getItem(COMPOSER_STORAGE_KEY)).toBe(before)
	})

	test.each([
		['bad JSON', '{ bad JSON'],
		['wrong version', JSON.stringify({ version: 2, draft: 'x', pending: null })],
		['non-string draft', JSON.stringify({ version: 1, draft: 123, pending: null })],
	])('leaves %s stored data untouched when restoration fails', (_label, raw) => {
		localStorage.setItem(COMPOSER_STORAGE_KEY, raw)

		const composer = createAsrPreview({ defaultTargetId: 'default' })

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe(DRAFT_RESTORE_FAILURE)
		expect(composer.isOpen()).toBe(false)
		expect(localStorage.getItem(COMPOSER_STORAGE_KEY)).toBe(raw)
	})

	test('localStorage getter failure is visible and does not escape creation', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new DOMException('denied', 'SecurityError')
			},
		})

		const composer = createAsrPreview({ defaultTargetId: 'default' })

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
		expect(composer.isOpen()).toBe(false)
	})

	test('getItem failure is visible and leaves the textarea usable', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})

		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()
		composer.input.value = 'still editable'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(composer.getText()).toBe('still editable')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
		expect(composer.isOpen()).toBe(true)
	})

	test('setItem quota failure retries silently after the first visible warning', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError')
		})
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()

		composer.input.value = 'first draft'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))
		composer.input.value = 'second draft'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(composer.getText()).toBe('second draft')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
		expect(composer.isOpen()).toBe(true)
		expect(setItem).toHaveBeenCalledTimes(2)
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})

	test('migrates legacy composer key when new key is absent', () => {
		localStorage.setItem(
			LEGACY_COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'legacy draft', pending: null }),
		)

		const composer = createAsrPreview({ defaultTargetId: 'default' })

		expect(composer.getText()).toBe('legacy draft')
		expect(localStorage.getItem(COMPOSER_STORAGE_KEY)).toContain('legacy draft')
		expect(localStorage.getItem(LEGACY_COMPOSER_STORAGE_KEY)).toBeNull()
	})

	test('legacy composer key is ignored when new key already has a value', () => {
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'current', pending: null }),
		)
		localStorage.setItem(
			LEGACY_COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'stale', pending: null }),
		)

		const composer = createAsrPreview({ defaultTargetId: 'default' })

		expect(composer.getText()).toBe('current')
		expect(localStorage.getItem(LEGACY_COMPOSER_STORAGE_KEY)).not.toBeNull()
	})

	test('no legacy composer key — migration is a no-op', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		expect(composer.getText()).toBe('')
		expect(localStorage.getItem(COMPOSER_STORAGE_KEY)).toBeNull()
	})
})
