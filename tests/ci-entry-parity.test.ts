import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')
const ciYmlPath = join(repoRoot, '.github/workflows/ci.yml')
const packageJsonPath = join(repoRoot, 'package.json')

/**
 * Environment-prep steps that belong in CI but not in `ci-check`.
 * Hardcoded exact strings — not pattern matching — so a new CI step cannot
 * silently join the exclusion list.
 */
const CI_CHECK_ENV_PREP_ALLOWLIST: readonly { command: string; reason: string }[] = [
	{
		command: 'python3 --version',
		reason: 'native-build prerequisite probe (node-pty source builds), not a verification step',
	},
	{
		command: 'node-gyp --version',
		reason: 'native-build prerequisite probe (node-pty source builds), not a verification step',
	},
	{
		command: 'pnpm install',
		reason: 'installs dependencies; environment preparation, not a check',
	},
	{
		command: 'pnpm exec playwright install --with-deps chromium webkit',
		reason: 'installs Playwright browser binaries; environment preparation, not a check',
	},
]

const UNIQUE_ENTRY = 'pnpm run ci-check'

/** Locked composition of `ci-check` once CI delegates to the unique entry. */
const EXPECTED_CI_CHECK_COMMANDS: readonly string[] = [
	'pnpm run test:coverage',
	'pnpm run build:dist',
	'pnpm run test:pw',
	'pnpm run check',
	'pnpm run lint:ox',
	'pnpm run lint:typos',
	'pnpm run lint:knip',
	'pnpm run lint:publint',
	'pnpm exec tsc --noEmit',
	'pnpm run test:deploy',
]

function extractJobRunCommands(yaml: string, jobName: string): string[] {
	const lines = yaml.split('\n')
	const jobHeader = new RegExp(`^ {2}${jobName}:\\s*$`)
	const nextJob = /^ {2}[A-Za-z0-9_-]+:\s*$/
	const commands: string[] = []
	let inJob = false
	let inLiteralBlock = false
	let literalIndent = 0

	for (const line of lines) {
		if (!inJob) {
			if (jobHeader.test(line)) inJob = true
			continue
		}
		if (nextJob.test(line)) break

		if (inLiteralBlock) {
			const indent = line.length - line.trimStart().length
			const content = line.trim()
			if (content === '') continue
			if (indent > literalIndent) {
				commands.push(content)
				continue
			}
			inLiteralBlock = false
		}

		const inline = line.match(/^\s+- run:\s+(\S.*)$/)
		if (inline?.[1] && !inline[1].startsWith('|') && !inline[1].startsWith('>')) {
			commands.push(inline[1].trim())
			continue
		}

		const block = line.match(/^(\s+)(?:- )?run:\s+\|\s*$/)
		if (block?.[1]) {
			inLiteralBlock = true
			literalIndent = block[1].length
		}
	}

	return commands
}

function parseCiCheckCommands(script: string): string[] {
	return script
		.split('&&')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

describe('CI check job ↔ ci-check parity', () => {
	const ciYml = readFileSync(ciYmlPath, 'utf8')
	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		scripts?: Record<string, string>
	}
	const ciCheckScript = pkg.scripts?.['ci-check']
	const allowlistCommands = CI_CHECK_ENV_PREP_ALLOWLIST.map((entry) => entry.command)

	test('allowlist is the four hardcoded env-prep commands with reasons', () => {
		expect(CI_CHECK_ENV_PREP_ALLOWLIST).toHaveLength(4)
		for (const entry of CI_CHECK_ENV_PREP_ALLOWLIST) {
			expect(entry.command.length).toBeGreaterThan(0)
			expect(entry.reason.length).toBeGreaterThan(0)
		}
		expect(allowlistCommands).toEqual([
			'python3 --version',
			'node-gyp --version',
			'pnpm install',
			'pnpm exec playwright install --with-deps chromium webkit',
		])
	})

	test('ci-check script exists and is a real command chain', () => {
		expect(typeof ciCheckScript).toBe('string')
		expect(ciCheckScript?.trim().length).toBeGreaterThan(0)
		const commands = parseCiCheckCommands(ciCheckScript ?? '')
		expect(commands.length).toBeGreaterThan(0)
		for (const command of commands) {
			expect(command.startsWith('pnpm '), `not an invocation: ${command}`).toBe(true)
		}
	})

	test('every allowlisted env-prep command is present in the check job', () => {
		const checkCommands = extractJobRunCommands(ciYml, 'check')
		for (const entry of CI_CHECK_ENV_PREP_ALLOWLIST) {
			expect(
				checkCommands,
				`allowlist command missing from CI check job (${entry.reason})`,
			).toContain(entry.command)
		}
	})

	test('allowlisted env-prep commands are not inside ci-check', () => {
		const ciCheckCommands = parseCiCheckCommands(ciCheckScript ?? '')
		for (const entry of CI_CHECK_ENV_PREP_ALLOWLIST) {
			expect(ciCheckCommands, `env-prep leaked into ci-check: ${entry.command}`).not.toContain(
				entry.command,
			)
		}
	})

	test('non-allowlisted CI check steps and ci-check commands match bidirectionally', () => {
		const checkCommands = extractJobRunCommands(ciYml, 'check')
		const verificationCommands = checkCommands.filter(
			(command) => !allowlistCommands.includes(command),
		)
		const ciCheckCommands = parseCiCheckCommands(ciCheckScript ?? '')

		const uniqueEntry =
			verificationCommands.length === 1 && verificationCommands[0] === UNIQUE_ENTRY

		if (uniqueEntry) {
			const missingFromEntry = EXPECTED_CI_CHECK_COMMANDS.filter(
				(command) => !ciCheckCommands.includes(command),
			)
			const extraInEntry = ciCheckCommands.filter(
				(command) => !EXPECTED_CI_CHECK_COMMANDS.includes(command),
			)
			expect(missingFromEntry, 'ci-check is missing a locked verification command').toEqual([])
			expect(extraInEntry, 'ci-check has a command not in the locked composition').toEqual([])
			return
		}

		const missingFromCiCheck = verificationCommands.filter(
			(command) => !ciCheckCommands.includes(command),
		)
		const extraInCiCheck = ciCheckCommands.filter(
			(command) => !verificationCommands.includes(command),
		)
		expect(missingFromCiCheck, 'CI verification step missing from ci-check').toEqual([])
		expect(extraInCiCheck, 'ci-check command missing from CI check job').toEqual([])
	})
})
