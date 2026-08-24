import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createAsrPreview } from '../src/controls/asr-preview'
import { _resetTouchGuard } from '../src/util/tap'

beforeEach(() => GlobalRegistrator.register())

afterEach(() => {
	_resetTouchGuard()
	GlobalRegistrator.unregister()
})

describe('voice composer shell', () => {
	test('has a multiline textarea and opens without focusing it', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		document.body.appendChild(composer.element)

		expect(composer.element.id).toBe('wt-asr-composer')
		expect(composer.element.getAttribute('aria-modal')).toBe('false')
		expect(composer.element.querySelector('h3')).toBeNull()
		expect(composer.input).toBeInstanceOf(HTMLTextAreaElement)
		expect(composer.input.getAttribute('rows')).toBe('1')
		expect(composer.input.placeholder).toBe('Speak or type…')
		expect(composer.element.querySelector('[data-herdweb-control="composer-mic"]')).not.toBeNull()
		expect(composer.element.querySelector('.wt-composer-send')?.textContent).toBe('Send')
		expect(
			composer.element
				.querySelector('.wt-asr-composer-actions')
				?.firstElementChild?.classList.contains('wt-asr-composer-close'),
		).toBe(true)
		composer.open()

		expect(composer.isOpen()).toBe(true)
		expect(document.body.classList.contains('wt-composer-open')).toBe(true)
		expect(composer.input.readOnly).toBe(false)
		expect(document.activeElement).not.toBe(composer.input)
		composer.close()
		expect(composer.isOpen()).toBe(false)
		expect(document.body.classList.contains('wt-composer-open')).toBe(false)
	})

	test('clear discards text and hides the composer', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()
		composer.input.value = 'discarded'
		composer.showMessage('status')
		composer.clear()

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe('')
		expect(composer.isOpen()).toBe(false)
	})

	test('resetDraft clears text and status without hiding the composer', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		composer.open()
		composer.input.value = 'draft'
		composer.showMessage('status')

		composer.resetDraft()

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe('')
		expect(composer.isOpen()).toBe(true)
	})

	test('notifies height consumers when textarea height changes', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		const heights: number[] = []
		Object.defineProperty(composer.input, 'scrollHeight', {
			configurable: true,
			value: 120,
		})
		composer.onHeightChange(() => heights.push(composer.input.clientHeight))

		composer.open()
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(composer.input.style.height).toBe('120px')
		expect(heights.length).toBeGreaterThan(0)
	})

	test('notifies height consumers only when open state changes', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		const states: boolean[] = []
		composer.onOpenChange((open) => states.push(open))

		composer.open()
		composer.showMessage('status')
		composer.close()

		expect(states).toEqual([true, false])
	})

	test('persists pending and exposes live status controls', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		const message = composer.message
		const retry = composer.element.querySelector<HTMLButtonElement>('.wt-composer-retry')
		const abandon = composer.element.querySelector<HTMLButtonElement>('.wt-composer-abandon')
		const send = composer.element.querySelector<HTMLButtonElement>('.wt-composer-send')
		if (!retry || !abandon || !send) throw new Error('missing composer action controls')

		composer.setSubmissionControls('unknown')
		composer.setSubmissionStatus(
			'unknown',
			'Result unknown — the terminal may or may not have received it.',
		)
		expect(message.getAttribute('aria-live')).toBe('polite')
		expect(message.dataset.submissionStatus).toBe('unknown')
		expect(retry.hidden).toBe(false)
		expect(retry.disabled).toBe(false)
		expect(abandon.hidden).toBe(false)
		expect(send.disabled).toBe(true)

		composer.setSubmissionControls('rejected')
		composer.setSubmissionStatus('rejected', 'Not received: duplicate submission id.')
		expect(retry.hidden).toBe(true)
		expect(retry.disabled).toBe(true)
		expect(abandon.hidden).toBe(false)
	})

	test('actions row keeps mic ahead of send with failure controls trailing', () => {
		const composer = createAsrPreview({ defaultTargetId: 'default' })
		const actions = composer.element.querySelector('.wt-asr-composer-actions')
		const classes = Array.from(actions?.children ?? []).map((child) => child.className)
		expect(classes).toEqual([
			'wt-asr-composer-close',
			'wt-composer-mic',
			'wt-composer-send',
			'wt-composer-retry',
			'wt-composer-abandon',
		])
	})
})

// One-handed layout is pure CSS; happy-dom has no layout engine, so lock the
// rules in the stylesheet source instead of asserting pixels.
const css = readFileSync(resolve(process.cwd(), 'styles/base.css'), 'utf8')

/** Extract the first declaration block for a selector (same approach as safe-area.test.ts). */
function blockFor(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
	expect(match, `selector ${selector} not found in base.css`).not.toBeNull()
	return match?.[1] ?? ''
}

describe('base.css composer one-handed layout', () => {
	test('mic is a 64px centred target instead of a 48px left-corner button', () => {
		const block = blockFor('#wt-asr-composer button.wt-composer-mic')
		expect(block).toContain('width: 64px')
		expect(block).toContain('height: 64px')
		expect(block).toContain('flex: 0 0 64px')
		expect(block).toContain('margin-inline: auto')
	})

	test('send keeps a fixed width on the right instead of stretching across the row', () => {
		const block = blockFor('#wt-asr-composer button.wt-composer-send')
		expect(block).not.toContain('flex: 1')
		expect(block).toContain('flex: 0 0 72px')
	})

	test('recording mic grows to 72px with a wider 6px pulse ring', () => {
		const block = blockFor('#wt-asr-composer button.wt-composer-mic.wt-mic-recording')
		expect(block).toContain('width: 72px')
		expect(block).toContain('height: 72px')
		expect(block).toContain('flex-basis: 72px')
		expect(block).toContain('animation: wt-mic-pulse-composer')
		expect(css).toContain('@keyframes wt-mic-pulse-composer')
		expect(css).toContain('0 0 0 6px rgba(243, 139, 168')
	})
})
