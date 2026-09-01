import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { describe, expect, test } from 'vitest'

interface PluginCommandItem {
	command?: string[]
}

interface PluginManifest {
	version?: string
	build?: PluginCommandItem[]
	panes?: PluginCommandItem[]
	actions?: PluginCommandItem[]
}

const repoRoot = join(import.meta.dirname, '..')
const manifestPath = join(repoRoot, 'herdr-plugin.toml')
const packageJsonPath = join(repoRoot, 'package.json')

function isScriptPath(arg: string): boolean {
	return arg.startsWith('scripts/') || /\.(?:mjs|cjs|js|ts|sh)$/.test(arg)
}

function collectCommands(manifest: PluginManifest): Array<{ section: string; command: string[] }> {
	const sections: Array<[string, PluginCommandItem[] | undefined]> = [
		['build', manifest.build],
		['panes', manifest.panes],
		['actions', manifest.actions],
	]

	return sections.flatMap(([section, items]) =>
		(items ?? [])
			.filter((item): item is PluginCommandItem & { command: string[] } =>
				Array.isArray(item.command),
			)
			.map((item) => ({ section, command: item.command })),
	)
}

describe('plugin manifest contract', () => {
	const rawManifest = readFileSync(manifestPath, 'utf8')
	const manifest = parse(rawManifest) as unknown as PluginManifest
	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }

	test('herdr-plugin.toml version matches package.json version', () => {
		expect(typeof manifest.version).toBe('string')
		expect(typeof pkg.version).toBe('string')
		expect(manifest.version).toBe(pkg.version)
	})

	test('all script references in build, panes, and actions commands exist in repo', () => {
		const commands = collectCommands(manifest)
		expect(commands.length).toBeGreaterThan(0)

		const checkedScripts: string[] = []

		for (const { section, command } of commands) {
			for (const arg of command) {
				if (typeof arg === 'string' && isScriptPath(arg)) {
					const scriptPath = join(repoRoot, arg)
					expect(
						existsSync(scriptPath),
						`in-repo script declared in [[${section}]] command does not exist: ${arg} (${scriptPath})`,
					).toBe(true)
					checkedScripts.push(arg)
				}
			}
		}

		expect(checkedScripts.length).toBeGreaterThan(0)
	})
})
