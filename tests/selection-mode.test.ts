import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createSelectionMode } from '../src/selection/selection-mode'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	document.body.innerHTML = ''
	GlobalRegistrator.unregister()
})

function addTerminalRows(...lines: string[]): void {
	document.body.innerHTML = `
		<div id="terminal-container">
			<div id="terminal">
				<div class="xterm">
					<div class="xterm-screen">
						<div class="xterm-rows">
							${lines.map((line) => `<div>${line}</div>`).join('')}
						</div>
					</div>
				</div>
			</div>
		</div>`
}

describe('createSelectionMode', () => {
	test('mounts a frozen, selectable text snapshot outside xterm-screen', async () => {
		addTerminalRows('first output', 'second output')
		const mode = createSelectionMode(mockTerminal())
		mode.mount()

		await mode.toggle()

		const overlay = document.querySelector('#wt-selection-mode')
		const snapshot = document.querySelector('#wt-selection-mode-snapshot')
		expect(overlay?.parentElement?.id).toBe('terminal-container')
		expect(overlay?.closest('.xterm-screen')).toBeNull()
		expect(snapshot?.textContent).toBe('first output\nsecond output')
		expect(mode.isOpen()).toBe(true)

		const rows = document.querySelector('.xterm-rows')
		if (!(rows instanceof HTMLElement)) throw new Error('missing test rows')
		rows.textContent = 'new live output'
		expect(snapshot?.textContent).toBe('first output\nsecond output')
	})

	test('closes from its button, toggling entry, and Escape', async () => {
		addTerminalRows('output')
		const mode = createSelectionMode(mockTerminal())
		mode.mount()

		await mode.toggle()
		document.querySelector<HTMLButtonElement>('#wt-selection-mode-close')?.click()
		expect(document.querySelector('#wt-selection-mode')).toBeNull()

		await mode.toggle()
		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
		)
		expect(document.querySelector('#wt-selection-mode')).toBeNull()

		await mode.toggle()
		await mode.toggle()
		expect(document.querySelector('#wt-selection-mode')).toBeNull()
	})

	test('dispose removes the Escape listener and overlay', async () => {
		addTerminalRows('output')
		const mode = createSelectionMode(mockTerminal())
		mode.mount()
		await mode.toggle()

		mode.dispose()
		expect(document.querySelector('#wt-selection-mode')).toBeNull()
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		expect(mode.isOpen()).toBe(false)
	})
})
