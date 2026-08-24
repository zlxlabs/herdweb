import { describe, expect, test } from 'vitest'
import { defineConfig } from '../src/config'
import {
	assertValidConfigOverrides,
	assertValidResolvedConfig,
	ConfigValidationError,
} from '../src/config-validate'
import type { HerdwebConfigOverrides } from '../src/types'

type TargetView = {
	id: string
	name: string
	command: readonly string[]
	imageDrop: string
}
type ConfigView = { targetMode: string; targets: readonly TargetView[]; defaultTargetId: string }

const target = (id = 'local', command: readonly string[] = ['herdr', '--session', 'local']) => ({
	id,
	name: 'Local target',
	command,
})

function resolve(overrides: Record<string, unknown> = {}): ConfigView {
	return defineConfig(overrides as HerdwebConfigOverrides) as unknown as ConfigView
}

function valid(overrides: Record<string, unknown>): void {
	assertValidConfigOverrides(overrides)
}

function invalid(overrides: Record<string, unknown>, message?: string): void {
	expect(() => assertValidConfigOverrides(overrides)).toThrow(ConfigValidationError)
	if (message) expect(() => assertValidConfigOverrides(overrides)).toThrow(message)
}

describe('target config resolution', () => {
	test('synthesizes the canonical single target', () => {
		const config = resolve()
		expect(config.targetMode).toBe('single')
		expect(config.defaultTargetId).toBe('default')
		expect(config.targets).toEqual([
			{ id: 'default', name: 'Default', command: ['herdr', '--session', 'default'], imageDrop: 'local-path' },
		])
	})

	test('accepts explicit targets in order and fills imageDrop', () => {
		const config = resolve({
			targets: [target('local'), { ...target('remote'), imageDrop: 'local-path' }],
			defaultTargetId: 'remote',
		})
		valid({
			targets: [target('local'), { ...target('remote'), imageDrop: 'local-path' }],
			defaultTargetId: 'remote',
		})
		expect(config.targetMode).toBe('explicit')
		expect(config.defaultTargetId).toBe('remote')
		expect(config.targets.map(({ id, imageDrop }) => ({ id, imageDrop }))).toEqual([
			{ id: 'local', imageDrop: 'disabled' },
			{ id: 'remote', imageDrop: 'local-path' },
		])
	})

	test('keeps the canonical target identity while resolving a custom command', () => {
		const config = resolve()
		expect(config.targets[0]).toMatchObject({ id: 'default', name: 'Default', imageDrop: 'local-path' })
	})

	test('rejects target count, default selection, and duplicate ids', () => {
		invalid({ targets: [], defaultTargetId: 'local' }, 'targets')
		invalid({ targets: [target('one'), target('one')], defaultTargetId: 'one' }, 'duplicate')
		invalid({ targets: [target('one')], defaultTargetId: 'missing' }, 'defaultTargetId')
		invalid({ targets: [target('one')] }, 'defaultTargetId')
		invalid({ targets: Array.from({ length: 9 }, (_, i) => target(`t${i}`)), defaultTargetId: 't0' }, '8')
	})

	test('enforces target field limits and safe values', () => {
		const base = { defaultTargetId: 'local' }
		for (const id of ['', 'Bad', 'bad id', 'bad/id', '-bad', 'a'.repeat(65)]) {
			invalid({ targets: [target(id)], ...base })
		}
		valid({ targets: [target('a'.repeat(64))], ...base, defaultTargetId: 'a'.repeat(64) })
		invalid({ targets: [{ ...target(), name: '' }], ...base })
		invalid({ targets: [{ ...target(), name: 'x'.repeat(81) }], ...base })
		invalid({ targets: [{ ...target(), name: 'bad\nname' }], ...base })
		invalid({ targets: [{ ...target(), command: [] }], ...base })
		invalid({ targets: [{ ...target(), command: Array.from({ length: 65 }, () => 'x') }], ...base })
		valid({ targets: [{ ...target(), command: ['🙂'.repeat(1024)] }], ...base })
		invalid({ targets: [{ ...target(), command: ['🙂'.repeat(1025)] }], ...base })
		invalid({ targets: [{ ...target(), imageDrop: 'other' }], ...base })
	})

	test('does not expose command values in validation errors', () => {
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

	test('does not permit targetMode in user overrides', () => {
		invalid({ targetMode: 'single' })
	})

	test('resolved target config is validated as a complete contract', () => {
		const config = resolve()
		assertValidResolvedConfig(config)
	})
})
