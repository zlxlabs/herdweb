import { describe, expect, test } from 'vitest'
import { defineConfig } from '../src/config'
import { ConfigValidationError, assertValidConfigOverrides } from '../src/config-validate'
import type { HerdwebConfigOverrides } from '../src/types'

type ConfigView = {
	targetMode: string
	defaultTargetId: string
	targets: readonly Record<string, unknown>[]
}
const target = (id = 'local', command: readonly string[] = ['herdr', '--session', 'local']) => ({
	id,
	name: 'Local target',
	command,
})
const resolve = (value: Record<string, unknown> = {}): ConfigView =>
	defineConfig(value as HerdwebConfigOverrides) as unknown as ConfigView
const invalid = (value: Record<string, unknown>) =>
	expect(() => assertValidConfigOverrides(value)).toThrow(ConfigValidationError)
const invalidTarget = (value: Record<string, unknown> = {}) =>
	invalid({ targets: [{ ...target(), ...value }], defaultTargetId: 'local' })

describe('target config resolution', () => {
	test('synthesizes the canonical single target', () => {
		const config = resolve()
		expect(config).toMatchObject({ targetMode: 'single', defaultTargetId: 'default' })
		expect(config.targets[0]).toMatchObject({
			id: 'default',
			name: 'Default',
			imageDrop: 'local-path',
		})
	})

	test('accepts eight explicit targets in order and fills imageDrop', () => {
		const targets = Array.from({ length: 8 }, (_, index) => target(`target-${index}`))
		const config = resolve({ targets, defaultTargetId: 'target-7' })
		expect(config.targetMode).toBe('explicit')
		expect(config.targets).toHaveLength(8)
		expect(config.targets[0]).toMatchObject({ id: 'target-0', imageDrop: 'disabled' })
	})

	test('rejects target counts, duplicate or unknown selection, and invalid imageDrop', () => {
		for (const value of [
			{ targets: [], defaultTargetId: 'local' },
			{ targets: Array.from({ length: 9 }, (_, i) => target(`t${i}`)), defaultTargetId: 't0' },
		])
			invalid(value)
		for (const value of [
			{ targets: [target('same'), target('same')], defaultTargetId: 'same' },
			{ targets: [target('one')], defaultTargetId: 'missing' },
			{ targets: [target('one')] },
		])
			invalid(value)
		invalidTarget({ imageDrop: 'other' })
	})

	test('enforces id, name, command, and UTF-8 limits', () => {
		for (const id of ['', 'Bad', 'bad id', 'bad/id', '-bad', 'a'.repeat(65)]) invalidTarget({ id })
		for (const value of [
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
		try {
			assertValidConfigOverrides({
				targets: [{ ...target(), command: [sentinel.repeat(300)] }],
				defaultTargetId: 'local',
			})
		} catch (error) {
			expect(String(error)).not.toContain(sentinel)
			return
		}
		throw new Error('expected target command validation to fail')
	})
})
