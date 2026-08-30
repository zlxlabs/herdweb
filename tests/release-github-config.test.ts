import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

type ReleasePlugin = string | [string, Record<string, unknown>]

interface ReleaseConfig {
	plugins: ReleasePlugin[]
}

function readJson(relativePath: string): unknown {
	const absolutePath = join(process.cwd(), relativePath)
	return JSON.parse(readFileSync(absolutePath, 'utf8'))
}

function readPackageJsonReleaseConfig(): ReleaseConfig {
	const packageJson = readJson('package.json') as { release: ReleaseConfig }
	return packageJson.release
}

function getPluginNames(config: ReleaseConfig): string[] {
	return config.plugins.map((plugin) => (typeof plugin === 'string' ? plugin : plugin[0]))
}

function getGithubPluginOptions(config: ReleaseConfig): Record<string, unknown> | undefined {
	for (const plugin of config.plugins) {
		if (typeof plugin === 'string') {
			if (plugin === '@semantic-release/github') {
				return undefined
			}
			continue
		}

		const [name, options] = plugin
		if (name === '@semantic-release/github') {
			return options
		}
	}

	throw new Error('Expected @semantic-release/github plugin in release config')
}

describe('semantic-release config in package.json', () => {
	test('disables success comments on merged PRs', () => {
		const config = readPackageJsonReleaseConfig()
		const options = getGithubPluginOptions(config)
		expect(options).toBeDefined()
		expect(options?.successComment).toBe(false)
	})

	// @semantic-release/git pushes release commits back to main, which fails against branch protection
	// (GH006: required status check 'check' is expected for GITHUB_TOKEN). Releases rely solely on git tags and GitHub Releases.
	test('does not include @semantic-release/git plugin to avoid branch protection failures', () => {
		const config = readPackageJsonReleaseConfig()
		const pluginNames = getPluginNames(config)
		expect(pluginNames).not.toContain('@semantic-release/git')
	})
})
