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

/**
 * Locked bodies of scripts that `ci-check` invokes via `pnpm run <name>`.
 * Compared against the live `package.json` after expanding each reference.
 * Replacing any referenced script with a no-op (`true`, `echo ok`) must fail —
 * the top-level `pnpm run X` strings would otherwise stay unchanged.
 *
 * `pnpm exec tsc --noEmit` is not a `pnpm run` invocation and has no `scripts`
 * entry; it stays locked only as a top-level command above.
 */
const EXPECTED_REFERENCED_SCRIPT_BODIES: Readonly<Record<string, string>> = {
	'test:coverage': 'vitest run --coverage',
	'build:dist': 'tsdown && pnpm run build:overlay',
	'test:pw': 'playwright test',
	check: 'biome check .',
	'lint:ox': 'oxlint --import-plugin --promise-plugin',
	'lint:typos': 'typos',
	'lint:knip': 'knip',
	'lint:publint': 'publint',
	'test:deploy':
		'bash tests/deploy/test-debug-unit.sh && bash tests/deploy/test-prod-unit.sh && bash tests/deploy/test-check-exposure.sh',
}

const PNPM_RUN_INVOCATION = /^pnpm run (\S+)$/

function referencedScriptName(command: string): string | undefined {
	return command.match(PNPM_RUN_INVOCATION)?.[1]
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim()
	if (trimmed.length >= 2) {
		const first = trimmed[0]
		const last = trimmed[trimmed.length - 1]
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return trimmed.slice(1, -1)
		}
	}
	return trimmed
}

function normalizeRunCommand(value: string): string {
	return unquoteYamlScalar(value).replace(/\s+/g, ' ').trim()
}

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
				commands.push(normalizeRunCommand(content))
				continue
			}
			inLiteralBlock = false
		}

		// `- run: ...` and the `- name: ...` / `run: ...` split form.
		const inline = line.match(/^\s+(?:-\s+)?run:\s+(\S.*)$/)
		if (inline?.[1] && !inline[1].startsWith('|') && !inline[1].startsWith('>')) {
			commands.push(normalizeRunCommand(inline[1]))
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

	test('each pnpm run in ci-check expands to the locked script body', () => {
		const scripts = pkg.scripts ?? {}
		const commands = parseCiCheckCommands(ciCheckScript ?? '')
		const seen: string[] = []
		for (const command of commands) {
			const name = referencedScriptName(command)
			if (name === undefined) continue
			seen.push(name)
			const expected = EXPECTED_REFERENCED_SCRIPT_BODIES[name]
			expect(
				expected,
				`ci-check references pnpm run ${name} with no locked body`,
			).toBeDefined()
			expect(
				scripts[name],
				`package.json scripts.${name} drifted from the locked verification command`,
			).toBe(expected)
		}
		const expectedNames = Object.keys(EXPECTED_REFERENCED_SCRIPT_BODIES)
		const missing = expectedNames.filter((name) => !seen.includes(name))
		const extra = seen.filter((name) => !(name in EXPECTED_REFERENCED_SCRIPT_BODIES))
		expect(missing, 'ci-check dropped a referenced script that the expansion table locks').toEqual(
			[],
		)
		expect(extra, 'ci-check gained a pnpm run with no locked body').toEqual([])
	})
})
