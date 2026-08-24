import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createTargetPicker } from '../src/controls/target-picker'
import type { TargetSummary } from '../src/session-protocol'
import type { ConnectionState, ConnectionStatus, XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

interface PickerMockTerm extends XTerminal {
	readonly selected: string[]
	readonly restarted: string[]
	setTargets(targets: readonly TargetSummary[]): void
	setCurrentTargetId(id: string | null): void
	fireStatus(state: ConnectionState): void
}

function target(
	id: string,
	processState: TargetSummary['processState'],
	name?: string,
): TargetSummary {
	return { id, name: name ?? id, processState, capabilities: { imageDrop: 'disabled' } }
}

function mockPickerTerm(): PickerMockTerm {
	const selected: string[] = []
	const restarted: string[] = []
	const targetsListeners: Array<() => void> = []
	const statusListeners: Array<(status: ConnectionStatus) => void> = []
	let targets: readonly TargetSummary[] = []
	let currentTargetId: string | null = null
	let connectionState: ConnectionState = 'synced'
	const base = mockTerminal()
	const term: PickerMockTerm = {
		...base,
		selected,
		restarted,
		getTargets: () => targets,
		getCurrentTargetId: () => currentTargetId,
		selectTarget(id: string) {
			selected.push(id)
			currentTargetId = id
			for (const listener of targetsListeners) listener()
		},
		restartTarget(id: string) {
			restarted.push(id)
		},
		onTargetsChange(handler: () => void) {
			targetsListeners.push(handler)
			return { dispose() {} }
		},
		getConnectionStatus() {
			return { state: connectionState, consecutivePreSyncFailures: 0, lastFailureReason: null }
		},
		onConnectionStatusChange(handler: (status: ConnectionStatus) => void) {
			statusListeners.push(handler)
			return { dispose() {} }
		},
		setTargets(next: readonly TargetSummary[]) {
			targets = next
			for (const listener of targetsListeners) listener()
		},
		setCurrentTargetId(id: string | null) {
			currentTargetId = id
			for (const listener of targetsListeners) listener()
		},
		fireStatus(state: ConnectionState) {
			connectionState = state
			const status: ConnectionStatus = {
				state,
				consecutivePreSyncFailures: 0,
				lastFailureReason: null,
			}
			for (const listener of statusListeners) listener(status)
		},
	}
	return term
}

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('target picker (T5)', () => {
	test('badge shows the current target name and opens the picker on tap', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([target('a', 'process-running', 'Alpha'), target('b', 'not-started', 'Beta')])
		term.setCurrentTargetId('a')

		expect(picker.badge.textContent).toContain('Alpha')
		expect(picker.element.classList.contains('open')).toBe(false)

		picker.badge.click()
		expect(picker.element.classList.contains('open')).toBe(true)
		const rows = picker.element.querySelectorAll('.wt-target-row')
		expect(rows).toHaveLength(2)
		expect(rows[0]?.textContent).toContain('Alpha')
		expect(rows[1]?.textContent).toContain('Beta')
	})

	test('rows show text+icon process states and the current row shows the browser state', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([
			target('idle', 'not-started'),
			target('booting', 'starting'),
			target('live', 'process-running'),
			target('dead', 'process-exited'),
		])
		term.setCurrentTargetId('live')
		term.fireStatus('synced')
		picker.open()

		const rowText = (id: string): string =>
			picker.element.querySelector(`[data-target-id="${id}"]`)?.textContent ?? ''
		expect(rowText('idle')).toContain('Not started')
		expect(rowText('booting')).toContain('Starting')
		expect(rowText('live')).toContain('Running')
		expect(rowText('live')).toContain('Connected')
		expect(rowText('dead')).toContain('Exited')

		term.fireStatus('syncing')
		expect(rowText('live')).toContain('Syncing')
	})

	test('tapping a row selects the target and closes the picker', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([
			target('a', 'process-running', 'Alpha'),
			target('b', 'process-running', 'Beta'),
		])
		term.setCurrentTargetId('a')
		picker.open()

		const row = picker.element.querySelector('[data-target-id="b"]')
		if (!(row instanceof HTMLElement)) throw new Error('row is not an element')
		row.click()

		expect(term.selected).toEqual(['b'])
		expect(picker.element.classList.contains('open')).toBe(false)
		expect(picker.badge.textContent).toContain('Beta')
	})

	test('restarting an exited target does not select it through the row', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([target('dead', 'process-exited')])
		picker.open()

		const restart = picker.element.querySelector('.wt-target-restart')
		if (!(restart instanceof HTMLButtonElement)) throw new Error('no restart button')
		restart.click()

		expect(term.restarted).toEqual(['dead'])
		expect(term.selected).toEqual([])
	})

	test('restart appears only on exited rows and sends restart for that target', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([target('live', 'process-running'), target('dead', 'process-exited')])
		term.setCurrentTargetId('dead')
		picker.open()

		const liveRow = picker.element.querySelector('[data-target-id="live"]')
		const deadRow = picker.element.querySelector('[data-target-id="dead"]')
		expect(liveRow?.querySelector('.wt-target-restart')).toBeNull()
		const restart = deadRow?.querySelector('.wt-target-restart')
		if (!(restart instanceof HTMLButtonElement)) throw new Error('no restart button')
		restart.click()
		expect(term.restarted).toEqual(['dead'])
	})

	test('Escape and backdrop close the picker without stealing focus', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		const other = document.createElement('button')
		document.body.append(other)
		other.focus()
		document.body.append(picker.badge, picker.element)
		term.setTargets([target('a', 'process-running')])
		term.setCurrentTargetId('a')

		picker.open()
		expect(document.activeElement).toBe(other)
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		expect(picker.element.classList.contains('open')).toBe(false)

		picker.open()
		const backdrop = picker.element.querySelector('.wt-target-picker-backdrop')
		if (!(backdrop instanceof HTMLElement)) throw new Error('no backdrop')
		backdrop.click()
		expect(picker.element.classList.contains('open')).toBe(false)
	})

	test('47-character names stay intact in the DOM with full-name title and aria label', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		const longName = 'a'.repeat(47)
		term.setTargets([target('long', 'process-running', longName)])
		term.setCurrentTargetId('long')
		picker.open()

		const row = picker.element.querySelector('[data-target-id="long"]')
		const nameEl = row?.querySelector('.wt-target-name')
		expect(nameEl?.textContent).toBe(longName)
		expect(nameEl?.getAttribute('title')).toBe(longName)
		expect(picker.badge.getAttribute('aria-label')).toContain(longName)
	})

	test('rows expose aria labels and the current row is marked', () => {
		const term = mockPickerTerm()
		const picker = createTargetPicker(term)
		document.body.append(picker.badge, picker.element)
		term.setTargets([target('a', 'process-running', 'Alpha'), target('b', 'not-started', 'Beta')])
		term.setCurrentTargetId('a')
		picker.open()

		const current = picker.element.querySelector('[data-target-id="a"]')
		const other = picker.element.querySelector('[data-target-id="b"]')
		expect(current?.getAttribute('aria-current')).toBe('true')
		expect(other?.getAttribute('aria-current')).toBeNull()
		expect(current?.getAttribute('aria-label')).toContain('Alpha')
		expect(other?.getAttribute('aria-label')).toContain('Not started')
	})
})
