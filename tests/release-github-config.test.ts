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

function readReleaseConfig(relativePath: string): ReleaseConfig {
	return readJson(relativePath) as ReleaseConfig
}

function readPackageJsonReleaseConfig(): ReleaseConfig {
	const packageJson = readJson('package.json') as { release: ReleaseConfig }
	return packageJson.release
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

describe('semantic-release github plugin config', () => {
	test.each([
		['.releaserc.json', readReleaseConfig('.releaserc.json')],
		['package.json release field', readPackageJsonReleaseConfig()],
	])('%s disables success comments on merged PRs', (_label, config) => {
		const options = getGithubPluginOptions(config)
		expect(options).toBeDefined()
		expect(options?.successComment).toBe(false)
	})
})
