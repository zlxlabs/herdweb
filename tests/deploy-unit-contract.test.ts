import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { assertServeCommandCompatible, parseCliArgs } from '../src/cli/args'
import type { TargetMode } from '../src/types'

const repoRoot = join(import.meta.dirname, '..')
const debugUnitPath = join(repoRoot, 'systemd/herdweb-debug.service')
const prodUnitPath = join(repoRoot, 'systemd/herdweb.service')

function readExecStart(unitPath: string): string {
	const text = readFileSync(unitPath, 'utf8')
	const line = text.split('\n').find((entry) => entry.startsWith('ExecStart='))
	if (!line) throw new Error(`no ExecStart in ${unitPath}`)
	return line.slice('ExecStart='.length)
}

function cliArgvFromExecStart(execStart: string): string[] {
	const marker = ' serve'
	const idx = execStart.indexOf(marker)
	if (idx === -1) {
		throw new Error(`ExecStart has no serve invocation: ${execStart}`)
	}
	return execStart
		.slice(idx + 1)
		.trim()
		.split(/\s+/)
}

function layer2SkipReason(configPath: string): string | undefined {
	if (existsSync(configPath)) return undefined
	return `layer-2 skipped: config file not found at ${configPath} (.omo/ is gitignored; expected on CI)`
}

/** Load via tsx + defineConfig so inferred targetMode matches production (vite cannot import files outside the worktree). */
function loadResolvedTargetMode(configPath: string): TargetMode {
	const configModule = JSON.stringify(join(repoRoot, 'src/config.ts'))
	const configUrl = JSON.stringify(configPath)
	const code = [
		`import { defineConfig } from ${configModule}`,
		'import { pathToFileURL } from "node:url"',
		'void (async () => {',
		`  const mod = await import(pathToFileURL(${configUrl}).href)`,
		'  const config = defineConfig(mod.default)',
		'  process.stdout.write(config.targetMode)',
		'})()',
	].join('\n')
	const output = execFileSync('pnpm', ['exec', 'tsx', '-e', code], {
		encoding: 'utf8',
		cwd: repoRoot,
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim()
	const mode = output.split('\n').at(-1)?.trim()
	if (mode !== 'single' && mode !== 'explicit') {
		throw new Error(`unexpected targetMode from config load: ${output}`)
	}
	return mode
}

describe('deploy unit CLI contract', () => {
	test('debug unit ExecStart is accepted by parseCliArgs', () => {
		const argv = cliArgvFromExecStart(readExecStart(debugUnitPath))
		const parsed = parseCliArgs(argv)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) {
			expect(parsed.value.command).toBe('serve')
			expect(parsed.value.configPath).toBeDefined()
		}
	})

	test('prod unit ExecStart is accepted by parseCliArgs', () => {
		const argv = cliArgvFromExecStart(readExecStart(prodUnitPath))
		const parsed = parseCliArgs(argv)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) {
			expect(parsed.value.command).toBe('serve')
			expect(parsed.value.command_.length).toBeGreaterThan(0)
		}
	})

	test('layer-2 skip reason is explicit when config is missing', () => {
		const missing = join(repoRoot, '.omo', 'definitely-missing-herdweb-debug.config.ts')
		const reason = layer2SkipReason(missing)
		expect(reason).toBeDefined()
		expect(reason).toContain('layer-2 skipped')
		expect(reason).toContain(missing)
		expect(reason).toContain('gitignored')
	})

	test('layer-2: real debug unit config is compatible with ExecStart', async (ctx) => {
		const argv = cliArgvFromExecStart(readExecStart(debugUnitPath))
		const parsed = parseCliArgs(argv)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		const configPath = parsed.value.configPath
		expect(configPath, 'debug unit must pass --config').toBeDefined()
		const reason = layer2SkipReason(configPath ?? '')
		if (reason) {
			console.info(reason)
			ctx.skip(reason)
		}
		const targetMode = loadResolvedTargetMode(configPath as string)
		expect(() => assertServeCommandCompatible(targetMode, parsed.value.command_)).not.toThrow()
	})
})
