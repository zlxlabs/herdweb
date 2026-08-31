import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
	createTargetRestoreOverlay,
	lastTargetStorageKey,
	persistLastTargetId,
	persistUrlTargetId,
	readLastTargetId,
	readUrlTargetId,
	resolveInitialTarget,
} from '../src/target-restore'

const TARGET_IDS = ['default', 'workbox', 'mac'] as const

function resolve(input: {
	mode: 'single' | 'explicit'
	url?: string | null
	last?: string | null
	storage?: 'ok' | 'unavailable'
}) {
	return resolveInitialTarget({
		mode: input.mode,
		urlTargetId: input.url ?? null,
		lastTarget:
			input.storage === 'unavailable'
				? { kind: 'unavailable' }
				: { kind: 'ok', value: input.last ?? null },
		targetIds: TARGET_IDS,
	})
}

describe('resolveInitialTarget', () => {
	test('single mode ignores a stale last target and attaches the default', () => {
		expect(resolve({ mode: 'single', last: 'workbox' })).toEqual({
			kind: 'attach',
			targetId: 'default',
		})
	})

	test('explicit mode prefers a valid URL target over the last target', () => {
		expect(resolve({ mode: 'explicit', url: 'mac', last: 'workbox' })).toEqual({
			kind: 'attach',
			targetId: 'mac',
		})
	})

	test('explicit mode falls back to a valid last target, then the default', () => {
		expect(resolve({ mode: 'explicit', last: 'workbox' })).toEqual({
			kind: 'attach',
			targetId: 'workbox',
		})
		expect(resolve({ mode: 'explicit' })).toEqual({ kind: 'attach', targetId: 'default' })
	})

	test('an unknown URL target blocks instead of falling back', () => {
		for (const mode of ['single', 'explicit'] as const) {
			const resolution = resolve({ mode, url: 'deleted', last: 'workbox' })
			expect(resolution.kind).toBe('blocked')
			if (resolution.kind === 'blocked') expect(resolution.reason).toContain('deleted')
		}
	})

	test('a removed last target blocks explicit restore without substitution', () => {
		const resolution = resolve({ mode: 'explicit', last: 'deleted' })
		expect(resolution.kind).toBe('blocked')
		if (resolution.kind === 'blocked') expect(resolution.reason).toContain('deleted')
	})

	test('unavailable storage blocks explicit restore', () => {
		expect(resolve({ mode: 'explicit', storage: 'unavailable' }).kind).toBe('blocked')
	})
})

describe('lastTargetId storage', () => {
	beforeEach(() => localStorage.clear())

	test('round-trips the committed target under the base-path-scoped key', () => {
		expect(readLastTargetId('/')).toEqual({ kind: 'ok', value: null })
		expect(persistLastTargetId('/', 'workbox')).toBe(true)
		expect(localStorage.getItem(lastTargetStorageKey('/'))).toBe('workbox')
		expect(readLastTargetId('/')).toEqual({ kind: 'ok', value: 'workbox' })
	})

	test('read failure is reported, not swallowed', () => {
		const original = window.localStorage
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('denied')
			},
		})
		try {
			expect(readLastTargetId('/').kind).toBe('unavailable')
			expect(persistLastTargetId('/', 'workbox')).toBe(false)
		} finally {
			Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
		}
	})
})

describe('readUrlTargetId', () => {
	test.each([
		['?target=workbox', 'workbox'],
		['?other=1', null],
		['', null],
	])('parses %s', (search, expected) => {
		expect(readUrlTargetId(search)).toBe(expected)
	})

	test('keeps an invalid id visible so restore can fail loud', () => {
		expect(readUrlTargetId('?target=bad%20id')).toBe('bad id')
	})
})

describe('persistUrlTargetId', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', 'http://localhost:3000/')
	})

	test('sets target query parameter in window.location', () => {
		persistUrlTargetId('workbox')
		expect(window.location.search).toBe('?target=workbox')
		expect(readUrlTargetId(window.location.search)).toBe('workbox')
	})

	test('updates existing target query parameter and preserves other params', () => {
		window.history.replaceState(null, '', 'http://localhost:3000/?foo=bar&target=one')
		persistUrlTargetId('two')
		expect(window.location.search).toBe('?foo=bar&target=two')
		expect(readUrlTargetId(window.location.search)).toBe('two')
	})

	test('invokes history.replaceState with null, empty title, and updated URL', () => {
		const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
		try {
			persistUrlTargetId('mac')
			expect(replaceStateSpy).toHaveBeenCalledTimes(1)
			const [state, title, url] = replaceStateSpy.mock.calls[0] ?? []
			expect(state).toBeNull()
			expect(title).toBe('')
			expect(String(url)).toContain('target=mac')
		} finally {
			replaceStateSpy.mockRestore()
		}
	})
})

describe('target restore overlay', () => {
	test('shows the reason and offers the default plus every target without stealing focus', () => {
		const chosen: string[] = []
		const overlay = createTargetRestoreOverlay((id) => chosen.push(id))
		document.body.appendChild(overlay.element)
		overlay.show('Unknown target "deleted".', [
			{ id: 'default', name: 'Default' },
			{ id: 'workbox', name: 'Workbox' },
		])

		expect(overlay.element.style.display).toBe('flex')
		expect(overlay.element.textContent).toContain('Unknown target "deleted".')
		const buttons = [...overlay.element.querySelectorAll('button')]
		expect(buttons.map((button) => button.textContent)).toEqual([
			'Continue with Default',
			'Default',
			'Workbox',
		])
		expect(document.activeElement).toBe(document.body)

		buttons[1]?.click()
		expect(chosen).toEqual(['default'])
		expect(overlay.element.style.display).toBe('none')
	})
})
