import { describe, expect, test } from 'vitest'
import { defaultDrawerButtons } from '../src/drawer/commands'

describe('defaultDrawerButtons', () => {
	test('has 31 commands', () => {
		expect(defaultDrawerButtons).toHaveLength(31)
	})

	test('all commands have id, label, description, and action', () => {
		for (const cmd of defaultDrawerButtons) {
			expect(cmd.id).toBeTruthy()
			expect(cmd.label).toBeTruthy()
			expect(cmd.description).toBeTruthy()
			expect(cmd.action).toBeTruthy()
		}
	})

	test('herdr commands send herdr prefix (Ctrl-b); raw key sends do not', () => {
		for (const cmd of defaultDrawerButtons) {
			if (cmd.action.type !== 'send') continue
			if (cmd.id.startsWith('herdr-')) {
				expect(cmd.action.data.startsWith('\x02')).toBe(true)
			} else {
				expect(cmd.action.data.startsWith('\x02')).toBe(false)
			}
		}
	})

	test('includes window management commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('+ Win')
		expect(labels).toContain('Split |')
		expect(labels).toContain('Zoom')
		expect(labels).toContain('Kill')
	})

	test('includes herdr navigation commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('Spaces')
		expect(labels).toContain('Sidebar')
	})

	test('uses herdr bindings for split/workspace/sidebar/scrollback actions', () => {
		const byId = new Map(defaultDrawerButtons.map((button) => [button.id, button]))

		expect(byId.get('herdr-split-v')?.action).toEqual({ type: 'send', data: '\x02v' })
		expect(byId.get('herdr-split-h')?.action).toEqual({ type: 'send', data: '\x02-' })
		expect(byId.get('herdr-workspaces')?.action).toEqual({ type: 'send', data: '\x02w' })
		expect(byId.get('herdr-sidebar')?.action).toEqual({ type: 'send', data: '\x02b' })
		expect(byId.get('herdr-scrollback')?.action).toEqual({ type: 'send', data: '\x02e' })
	})

	test('includes scroll commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('PgUp')
		expect(labels).toContain('PgDn')
	})

	test('does not include legacy tmux drawer ids', () => {
		const ids = defaultDrawerButtons.map((button) => button.id)
		expect(ids).not.toContain('tmux-split-vertical')
		expect(ids).not.toContain('tmux-sessions')
		expect(ids).not.toContain('tmux-copy')
	})

	test('includes combo sender command', () => {
		const combo = defaultDrawerButtons.find((button) => button.id === 'combo-picker')
		expect(combo).toBeDefined()
		expect(combo?.action).toEqual({ type: 'combo-picker' })
	})

	test('includes font size and guide controls moved from the floating cluster', () => {
		const byId = new Map(defaultDrawerButtons.map((button) => [button.id, button]))

		expect(byId.get('font-decrease')?.label).toBe('Font −')
		expect(byId.get('font-decrease')?.action).toEqual({ type: 'font-size', delta: -2 })
		expect(byId.get('font-increase')?.label).toBe('Font +')
		expect(byId.get('font-increase')?.action).toEqual({ type: 'font-size', delta: 2 })
		expect(byId.get('guide')?.action).toEqual({ type: 'help' })
	})

	test('prefix button sends Ctrl-B without sticky modifier', () => {
		const prefix = defaultDrawerButtons.find((button) => button.id === 'prefix')
		expect(prefix?.action).toEqual({ type: 'prefix', data: '\x02' })
	})
})
