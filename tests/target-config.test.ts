import { describe, expect, test } from 'vitest'
import { defineConfig } from '../src/config'
import { ConfigValidationError, assertValidConfigOverrides } from '../src/config-validate'
import type { HerdwebConfigOverrides } from '../src/types'

const target = (id = 'local') => ({ id, name: 'Target', command: ['herdr', id] })
const resolve = (value: Record<string, unknown> = {}) =>
	defineConfig(value as HerdwebConfigOverrides)
const invalid = (value: Record<string, unknown>) =>
	expect(() => assertValidConfigOverrides(value)).toThrow(ConfigValidationError)
const invalidTarget = (value: Record<string, unknown> = {}) =>
	invalid({ targets: [{ ...target(), ...value }], defaultTargetId: 'local' })

describe('target config resolution', () => {
	test('synthesizes the canonical single target', () => {
		const config = resolve()
		expect(config).toMatchObject({ targetMode: 'single', defaultTargetId: 'default' })
		expect(config.targets[0]).toMatchObject({ id: 'default', name: 'Default' })
		expect(config.targets[0]?.imageDrop).toBe('local-path')
	})
	test('accepts eight explicit targets in order and fills imageDrop', () => {
		const targets = Array.from({ length: 8 }, (_, index) => target(`target-${index}`))
		const config = resolve({ targets, defaultTargetId: 'target-7' })
		expect(config.targetMode).toBe('explicit')
		expect(config.targets).toHaveLength(8)
		expect(config.targets.map(({ id }) => id)).toEqual(targets.map(({ id }) => id))
		expect(config.targets[0]).toMatchObject({ id: 'target-0', imageDrop: 'disabled' })
	})
	test('rejects target counts, duplicate or unknown selection, and invalid imageDrop', () => {
		for (const value of [
			{ targets: [], defaultTargetId: 'local' },
			{ targets: Array.from({ length: 9 }, (_, i) => target(`t${i}`)), defaultTargetId: 't0' },
			{ targets: [target('same'), target('same')], defaultTargetId: 'same' },
			{ targets: [target('one')], defaultTargetId: 'missing' },
			{ targets: [target('one')] },
		])
			invalid(value)
		invalidTarget({ imageDrop: 'other' })
	})
	test('enforces id, name, command, and UTF-8 limits', () => {
		for (const value of [
			...['', 'Bad', 'bad id', 'bad/id', '-bad', 'a'.repeat(65)].map((id) => ({ id })),
			{ name: '' },
			{ name: 'x'.repeat(81) },
			{ name: 'bad\nname' },
			{ command: [] },
			{ command: Array.from({ length: 65 }, () => 'x') },
			{ command: ['🙂'.repeat(1025)] },
		])
			invalidTarget(value)
		assertValidConfigOverrides({
			targets: [{ ...target('a'.repeat(64)), name: 'x'.repeat(80), command: ['🙂'.repeat(1024)] }],
			defaultTargetId: 'a'.repeat(64),
		})
	})
	test('redacts invalid target command values', () => {
		const sentinel = 'target-secret-command-sentinel'
		const invalidConfig = {
			targets: [{ ...target(), command: [sentinel.repeat(300)] }],
			defaultTargetId: 'local',
		}
		let message = ''
		try {
			assertValidConfigOverrides(invalidConfig)
		} catch (error) {
			message = String(error)
		}
		expect(message).toContain('redacted')
		expect(message).not.toContain(sentinel)
	})
})
