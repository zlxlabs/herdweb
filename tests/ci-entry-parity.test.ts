import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

const repoRoot = join(import.meta.dirname, '..')
const ciYmlPath = join(repoRoot, '.github/workflows/ci.yml')
const packageJsonPath = join(repoRoot, 'package.json')

/**
 * The check job delegates every verification to one entry, so "what CI runs"
 * and "what ci-check runs" are the same thing rather than two sets to compare.
 * The only thing left to guard is that nobody adds another step to the job or
 * swaps the single entry for a different shape — which is a structural claim
 * about the steps list, not a reconstruction of what CI would execute.
 *
 * Reconstructing execution from text was tried twice and bypassed twice: a
 * referenced script was swapped for `true`, and the entry was reshaped into a
 * `uses:` step carrying `with: { run: ... }`. Both passed a text-scanning
 * guard. Hence: parse the YAML properly, and assert on step structure.
 */
const UNIQUE_ENTRY = 'pnpm run ci-check'

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

/**
 * Actions the check job may invoke. A `uses:` step runs code this test cannot
 * see, so anything outside this list counts as an unaccounted step — that is
 * what let `uses: actions/github-script` smuggle the entry away previously.
 */
const CI_CHECK_ENV_PREP_USES: readonly { uses: string; reason: string }[] = [
	{ uses: 'actions/checkout@v4', reason: 'checks out the repository; environment preparation' },
	{ uses: 'jdx/mise-action@v3', reason: 'installs the mise toolchain; environment preparation' },
]

/** Locked composition of `ci-check`. */
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

interface WorkflowStep {
	readonly uses?: unknown
	readonly run?: unknown
	readonly if?: unknown
}

function checkJobSteps(ciYml: string): WorkflowStep[] {
	const doc = parse(ciYml) as { jobs?: Record<string, { steps?: unknown }> }
	const steps = doc.jobs?.check?.steps
	if (!Array.isArray(steps)) throw new Error('CI check job has no steps list')
	return steps as WorkflowStep[]
}

/** Commands in one `run:` step; a literal block holds one command per line. */
function stepCommands(run: string): string[] {
	return run
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

/**
 * Split the check job into the unique-entry steps and everything this test
 * cannot account for. A step is accounted for only when it is an allowlisted
 * action, or a `run:` step whose commands are all allowlisted env-prep, or the
 * single verification entry.
 */
function classifyCheckJob(steps: readonly WorkflowStep[]): {
	entries: WorkflowStep[]
	unaccounted: string[]
} {
	const allowedCommands = CI_CHECK_ENV_PREP_ALLOWLIST.map((entry) => entry.command)
	const allowedUses = CI_CHECK_ENV_PREP_USES.map((entry) => entry.uses)
	const entries: WorkflowStep[] = []
	const unaccounted: string[] = []

	for (const step of steps) {
		if (typeof step.uses === 'string') {
			if (!allowedUses.includes(step.uses)) unaccounted.push(`uses: ${step.uses}`)
			continue
		}
		if (typeof step.run !== 'string') {
			unaccounted.push(`step with neither uses nor run: ${JSON.stringify(step)}`)
			continue
		}
		const commands = stepCommands(step.run)
		const verification = commands.filter((command) => !allowedCommands.includes(command))
		if (verification.length === 0) continue
		if (verification.length === 1 && verification[0] === UNIQUE_ENTRY && commands.length === 1) {
			entries.push(step)
			continue
		}
		unaccounted.push(...verification)
	}

	return { entries, unaccounted }
}

function parseCiCheckCommands(script: string): string[] {
	return script
		.split('&&')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

function referencedScriptName(command: string): string | undefined {
	return command.match(PNPM_RUN_INVOCATION)?.[1]
}

describe('CI check job ↔ ci-check parity', () => {
	const ciYml = readFileSync(ciYmlPath, 'utf8')
	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		scripts?: Record<string, string>
	}
	const ciCheckScript = pkg.scripts?.['ci-check']
	const allowlistCommands = CI_CHECK_ENV_PREP_ALLOWLIST.map((entry) => entry.command)

	test('allowlist is the hardcoded env-prep commands and actions with reasons', () => {
		expect(allowlistCommands).toEqual([
			'python3 --version',
			'node-gyp --version',
			'pnpm install',
			'pnpm exec playwright install --with-deps chromium webkit',
		])
		expect(CI_CHECK_ENV_PREP_USES.map((entry) => entry.uses)).toEqual([
			'actions/checkout@v4',
			'jdx/mise-action@v3',
		])
		for (const entry of [...CI_CHECK_ENV_PREP_ALLOWLIST, ...CI_CHECK_ENV_PREP_USES]) {
			expect(entry.reason.length).toBeGreaterThan(0)
		}
	})

	test('ci-check script exists and is a real command chain', () => {
		expect(typeof ciCheckScript).toBe('string')
		const commands = parseCiCheckCommands(ciCheckScript ?? '')
		expect(commands.length).toBeGreaterThan(0)
		for (const command of commands) {
			expect(command.startsWith('pnpm '), `not an invocation: ${command}`).toBe(true)
		}
	})

	test('the check job runs every verification through the single entry', () => {
		const { entries, unaccounted } = classifyCheckJob(checkJobSteps(ciYml))
		expect(unaccounted, 'check job has a step this guard cannot account for').toEqual([])
		expect(entries, `check job must hold exactly one \`${UNIQUE_ENTRY}\` step`).toHaveLength(1)
		expect(entries[0]?.if, 'the verification entry must not be conditional').toBeUndefined()
	})

	test('every allowlisted env-prep command is present in the check job', () => {
		const commands = checkJobSteps(ciYml).flatMap((step) =>
			typeof step.run === 'string' ? stepCommands(step.run) : [],
		)
		for (const entry of CI_CHECK_ENV_PREP_ALLOWLIST) {
			expect(commands, `allowlist command missing from CI check job (${entry.reason})`).toContain(
				entry.command,
			)
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

	test('ci-check composition matches the locked command set', () => {
		const ciCheckCommands = parseCiCheckCommands(ciCheckScript ?? '')

		// Set equality, not sequence: `&&` order in ci-check is not a contract
		// (lint-then-test and test-then-lint are both valid). Duplicates are not
		// expected in real maintenance and would not produce a false-green
		// (every locked command would still be present). Both directions use
		// Array.includes, which accepts reorder and repeats by design.
		const missing = EXPECTED_CI_CHECK_COMMANDS.filter(
			(command) => !ciCheckCommands.includes(command),
		)
		const extra = ciCheckCommands.filter((command) => !EXPECTED_CI_CHECK_COMMANDS.includes(command))
		expect(missing, 'ci-check is missing a locked verification command').toEqual([])
		expect(extra, 'ci-check has a command not in the locked composition').toEqual([])
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
			expect(expected, `ci-check references pnpm run ${name} with no locked body`).toBeDefined()
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
