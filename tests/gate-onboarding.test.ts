/**
 * Contract tests for the #178 gate v2 onboarding (single PR):
 * - the three standard gate callers under .github/workflows/
 * - the scripts/gate-quality stable quality entry
 * - the independent UI visual pipeline (workflow + config + spec discovery)
 *
 * Producer baseline: real platform bytes in tests/fixtures/gate-onboarding/
 * (see SOURCE.md for provenance). Tests read repo files and fixtures only —
 * no network, no other-repo absolute paths at runtime.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import baseConfig from '../playwright.config'
import visualConfig from '../playwright.visual.config'

const repoRoot = join(import.meta.dirname, '..')
const fixtureDir = join(repoRoot, 'tests/fixtures/gate-onboarding')

const readText = (relativePath: string): string =>
	readFileSync(join(repoRoot, relativePath), 'utf8')

const readYaml = (relativePath: string): Record<string, unknown> =>
	parse(readText(relativePath)) as Record<string, unknown>

const readFixture = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8')

/** Fixture excerpts keep the producer's base indentation; dedent to parse. */
const readDedentedFixture = (name: string): Record<string, unknown> =>
	parse(
		readFixture(name)
			.split('\n')
			.map((line) => line.replace(/^ {2}/, ''))
			.join('\n'),
	) as Record<string, unknown>

const fixtureSha256 = (name: string): string =>
	createHash('sha256')
		.update(readFileSync(join(fixtureDir, name)))
		.digest('hex')

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} is not a YAML mapping`)
	}
	return value as Record<string, unknown>
}

function requireArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} is not a YAML list`)
	}
	return value
}

const SAFE_TRIGGER_EVENTS = new Set(['pull_request', 'push', 'workflow_dispatch', 'schedule'])
const DANGEROUS_TRIGGER_EVENTS = [
	'pull_request_target',
	'workflow_run',
	'issue_comment',
	'pull_request_review',
	'pull_request_review_comment',
]

const DISPOSITION_INPUTS = [
	'pr_number',
	'primary_run_id',
	'primary_run_attempt',
	'finding_id',
	'reason',
	'disposition',
	'counterevidence_json',
	'tracking_issue',
] as const

/** Glob (with `**`) to RegExp, mirroring Playwright's file-pattern matching. */
const globToRegExpSource = (glob: string): string => {
	let source = ''
	let index = 0
	while (index < glob.length) {
		if (glob.startsWith('**/', index)) {
			source += '(?:.*/)?'
			index += 3
		} else if (glob.startsWith('**', index)) {
			source += '.*'
			index += 2
		} else if (glob.charAt(index) === '*') {
			source += '[^/]*'
			index += 1
		} else {
			source += glob.charAt(index).replace(/[\\^$.+?()[\]{}|]/g, '\\$&')
			index += 1
		}
	}
	return source
}

const expectGlobMatches = (glob: string, path: string, expected: boolean): void => {
	expect(new RegExp(`^(?:.*/)?${globToRegExpSource(glob)}$`).test(path)).toBe(expected)
}

// ---------------------------------------------------------------------------
// gate.yml — required caller
// ---------------------------------------------------------------------------

describe('gate.yml (required gate caller)', () => {
	const doc = readYaml('.github/workflows/gate.yml')
	const jobs = requireRecord(doc.jobs, 'gate.yml jobs')
	const gateJob = requireRecord(jobs.gate, 'gate.yml jobs.gate')
	const withInputs = requireRecord(gateJob.with, 'gate.yml jobs.gate.with')

	it('keeps the required status-check context: workflow name and job id are both `gate`', () => {
		expect(doc.name).toBe('gate')
		expect(Object.keys(jobs)).toEqual(['gate'])
	})

	it('calls the platform callee via the moving @v2 tag, never a pinned SHA', () => {
		expect(gateJob.uses).toBe('zlxlabs/gate/.github/workflows/gate-v2.yml@v2')
	})

	it('passes the registry identity: tier personal / runner self / has_ui true', () => {
		expect(withInputs.tier).toBe('personal')
		expect(withInputs.runner).toBe('self')
		expect(withInputs.has_ui).toBe(true)
	})

	it('grants only actions:read, contents:read, pull-requests:write', () => {
		expect(doc.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'write' })
	})

	it('forwards exactly the three named secrets and never the PWRS reporter token', () => {
		const secrets = requireRecord(gateJob.secrets, 'gate.yml jobs.gate.secrets')
		expect(Object.keys(secrets)).toEqual([
			'FEISHU_CI_WEBHOOK',
			'SILO_ACCESS_KEY',
			'SILO_SECRET_KEY',
		])
		for (const name of Object.keys(secrets)) {
			expect(secrets[name]).toBe(`\${{ secrets.${name} }}`)
		}
	})

	it('triggers on the safe whitelist only and keeps the platform pull_request types', () => {
		const on = requireRecord(doc.on, 'gate.yml on')
		expect(Object.keys(on)).toEqual(['pull_request'])
		const templateCaller = readYaml('tests/fixtures/gate-onboarding/caller-ci.yml')
		const templateOn = requireRecord(templateCaller.on, 'caller template on')
		expect(on.pull_request).toEqual(templateOn.pull_request)
	})

	it('has no path filtering on the required gate (never skips on docs/retro paths)', () => {
		const on = requireRecord(doc.on, 'gate.yml on')
		const pullRequest = requireRecord(on.pull_request, 'gate.yml on.pull_request')
		expect(pullRequest.paths).toBeUndefined()
		expect(pullRequest['paths-ignore']).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// gate-shadow.yml — non-required calibration caller
// ---------------------------------------------------------------------------

describe('gate-shadow.yml (shadow caller)', () => {
	const doc = readYaml('.github/workflows/gate-shadow.yml')
	const jobs = requireRecord(doc.jobs, 'gate-shadow.yml jobs')
	const job = requireRecord(jobs['gate-shadow'], 'gate-shadow.yml jobs.gate-shadow')
	const withInputs = requireRecord(job.with, 'gate-shadow.yml jobs.gate-shadow.with')

	it('is named gate-shadow and never steals the required `gate` context', () => {
		expect(doc.name).toBe('gate-shadow')
		expect(doc.name).not.toBe('gate')
		expect(Object.keys(jobs)).toEqual(['gate-shadow'])
	})

	it('calls gate-shadow-v2 via @v2 with tier personal / runner self and no has_ui mirror', () => {
		expect(job.uses).toBe('zlxlabs/gate/.github/workflows/gate-shadow-v2.yml@v2')
		expect(withInputs.tier).toBe('personal')
		expect(withInputs.runner).toBe('self')
		expect(withInputs.has_ui).toBeUndefined()
	})

	it('receives no secrets (shadow never needs credentials)', () => {
		expect(job.secrets).toBeUndefined()
	})

	it('grants only actions:read and contents:read (no pull-requests write)', () => {
		expect(doc.permissions).toEqual({ actions: 'read', contents: 'read' })
	})

	it('triggers on pull_request only, with the docs-only paths-ignore convention', () => {
		const on = requireRecord(doc.on, 'gate-shadow.yml on')
		expect(Object.keys(on)).toEqual(['pull_request'])
		const pullRequest = requireRecord(on.pull_request, 'gate-shadow.yml on.pull_request')
		expect(pullRequest['paths-ignore']).toEqual(['**.md', 'docs/**'])
	})
})

// ---------------------------------------------------------------------------
// gate-disposition.yml — eight-input forwarding
// ---------------------------------------------------------------------------

describe('gate-disposition.yml (disposition caller)', () => {
	const doc = readYaml('.github/workflows/gate-disposition.yml')
	const on = requireRecord(doc.on, 'gate-disposition.yml on')
	const dispatch = requireRecord(on.workflow_dispatch, 'gate-disposition.yml on.workflow_dispatch')
	const declaredInputs = requireRecord(dispatch.inputs, 'gate-disposition.yml inputs')
	const jobs = requireRecord(doc.jobs, 'gate-disposition.yml jobs')
	const job = requireRecord(jobs.disposition, 'gate-disposition.yml jobs.disposition')
	const withInputs = requireRecord(job.with, 'gate-disposition.yml jobs.disposition.with')
	const calleeCall = requireRecord(
		requireRecord(
			readDedentedFixture('gate-v2-disposition-workflow-call.yml').workflow_call,
			'callee workflow_call',
		),
		'callee workflow_call',
	)
	const calleeInputs = requireRecord(calleeCall.inputs, 'callee workflow_call.inputs')

	it('declares exactly the eight contract inputs with the callee required flags', () => {
		expect(Object.keys(declaredInputs).sort()).toEqual([...DISPOSITION_INPUTS].sort())
		for (const name of DISPOSITION_INPUTS) {
			const declared = requireRecord(declaredInputs[name], `declared input ${name}`)
			const producer = requireRecord(calleeInputs[name], `callee input ${name}`)
			expect(declared.required).toBe(producer.required)
		}
	})

	it('forwards each input verbatim as the ${{ inputs.<name> }} expression', () => {
		for (const name of DISPOSITION_INPUTS) {
			expect(withInputs[name]).toBe(`\${{ inputs.${name} }}`)
		}
		expect(Object.keys(withInputs).sort()).toEqual([...DISPOSITION_INPUTS].sort())
	})

	it('does not forward the deprecated gate_ref compatibility input', () => {
		expect(calleeInputs.gate_ref).toBeDefined()
		expect(withInputs.gate_ref).toBeUndefined()
	})

	it('calls gate-v2-disposition via @v2 with secrets inherit', () => {
		expect(job.uses).toBe('zlxlabs/gate/.github/workflows/gate-v2-disposition.yml@v2')
		expect(job.secrets).toBe('inherit')
	})

	it('grants actions:write, contents:read, pull-requests:read at caller and job level', () => {
		const expected = { actions: 'write', contents: 'read', 'pull-requests': 'read' }
		expect(doc.permissions).toEqual(expected)
		expect(job.permissions).toEqual(expected)
	})

	it('triggers on workflow_dispatch only (maintainer-only credential event)', () => {
		expect(Object.keys(on)).toEqual(['workflow_dispatch'])
	})
})

// ---------------------------------------------------------------------------
// trigger safety across all gate-related workflows (parsed structure, not grep)
// ---------------------------------------------------------------------------

describe('trigger whitelist across gate workflows (parsed on: structure)', () => {
	const workflowPaths = [
		'.github/workflows/gate.yml',
		'.github/workflows/gate-shadow.yml',
		'.github/workflows/gate-disposition.yml',
		'.github/workflows/herdweb-visual.yml',
	]

	for (const path of workflowPaths) {
		it(`${path} uses only safe trigger events`, () => {
			const on = requireRecord(readYaml(path).on, `${path} on`)
			for (const event of Object.keys(on)) {
				expect(SAFE_TRIGGER_EVENTS.has(event)).toBe(true)
			}
			for (const dangerous of DANGEROUS_TRIGGER_EVENTS) {
				expect(on[dangerous]).toBeUndefined()
			}
		})
	}
})

// ---------------------------------------------------------------------------
// scripts/gate-quality — stable quality entry
// ---------------------------------------------------------------------------

describe('scripts/gate-quality (stable quality entry)', () => {
	const scriptPath = join(repoRoot, 'scripts/gate-quality')
	const lines = readFileSync(scriptPath, 'utf8').split('\n')
	const effectiveLines = lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))

	it('is executable with a shebang', () => {
		expect(statSync(scriptPath).mode & 0o111).not.toBe(0)
		expect(lines[0]).toBe('#!/bin/sh')
	})

	it('runs exactly one command: exec pnpm run ci-check (the repo CI parity command)', () => {
		expect(effectiveLines).toEqual(['exec pnpm run ci-check'])
		const ciYaml = readText('.github/workflows/ci.yml')
		expect(ciYaml).toContain('pnpm run ci-check')
	})

	it('matches the real callee contract: callee creates GATE_ARTIFACT_DIR and runs the entry', () => {
		const detectStep = readFixture('gate-v2-quality-entry-detect.yml')
		const runStep = readFixture('gate-v2-quality-entry-run.yml')
		expect(detectStep).toContain('scripts/gate-quality exists but is not executable')
		expect(detectStep).toContain('mode=entry')
		expect(detectStep).toContain('mkdir -p "$GATE_ARTIFACT_DIR"')
		expect(runStep).toContain("if: ${{ steps.quality-entry.outputs.mode == 'entry' }}")
		expect(runStep).toContain('run: ./scripts/gate-quality')
		const script = readFileSync(scriptPath, 'utf8')
		expect(script).not.toContain('GATE_ARTIFACT_DIR')
		expect(script).not.toContain('upload')
	})

	it('really invokes `pnpm run ci-check` and propagates the failure exit code (producer argv)', () => {
		const fakeDir = mkdtempSync(join(tmpdir(), 'gate-quality-fake-pnpm-'))
		const argFile = join(fakeDir, 'argv.txt')
		const fakePnpm = join(fakeDir, 'pnpm')
		writeFileSync(
			fakePnpm,
			`#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_PNPM_ARGFILE"\nexit "$FAKE_PNPM_EXIT"\n`,
		)
		chmodSync(fakePnpm, 0o755)
		const runEntry = (exitCode: string): ReturnType<typeof spawnSync> =>
			spawnSync(scriptPath, [], {
				env: {
					...process.env,
					PATH: `${fakeDir}:${process.env.PATH ?? ''}`,
					FAKE_PNPM_ARGFILE: argFile,
					FAKE_PNPM_EXIT: exitCode,
				},
			})

		try {
			const failing = runEntry('7')
			expect(failing.status).toBe(7)
			const recordedArgv = readFileSync(argFile, 'utf8')
				.split('\n')
				.filter((line) => line !== '')
			expect(recordedArgv).toEqual(['run', 'ci-check'])

			const passing = runEntry('0')
			expect(passing.status).toBe(0)
		} finally {
			rmSync(fakeDir, { recursive: true, force: true })
		}
	})
})

// ---------------------------------------------------------------------------
// herdweb-visual.yml — independent UI evidence pipeline
// ---------------------------------------------------------------------------

describe('herdweb-visual.yml (UI evidence pipeline)', () => {
	const doc = readYaml('.github/workflows/herdweb-visual.yml')
	const jobs = requireRecord(doc.jobs, 'herdweb-visual.yml jobs')
	const job = requireRecord(jobs['ui-visual'], 'herdweb-visual.yml jobs.ui-visual')
	const steps = requireArray(job.steps, 'herdweb-visual.yml jobs.ui-visual.steps')
	const stepRecords = steps.map((step, index) => requireRecord(step, `step #${index}`))
	const stepByName = (needle: string): Record<string, unknown> => {
		const step = stepRecords.find((record) => String(record.name).includes(needle))
		if (!step) {
			throw new Error(`step containing "${needle}" not found`)
		}
		return step
	}
	const HEAD_SHA_EXPRESSION = '${{ github.event.pull_request.head.sha || github.sha }}'

	it('is an independent non-required workflow, not named gate', () => {
		expect(doc.name).not.toBe('gate')
		expect(doc.name).not.toBe('gate-shadow')
	})

	it('runs on the self-hosted ci pool labels', () => {
		expect(job['runs-on']).toEqual(['self-hosted', 'ci'])
	})

	it('binds the full head SHA once and reuses the same expression for upload and publish', () => {
		const env = requireRecord(job.env, 'herdweb-visual.yml jobs.ui-visual.env')
		expect(env.UI_EVIDENCE_HEAD_SHA).toBe(HEAD_SHA_EXPRESSION)
		expect(env.PWRS_BASE).toBeDefined()
	})

	it('runs the visual config via playwright, never the shared blocking suite', () => {
		const e2eStep = requireRecord(
			stepRecords.find((record) => record.id === 'e2e'),
			'step id=e2e',
		)
		expect(String(e2eStep.run)).toContain('--config=playwright.visual.config.ts')
		expect(String(e2eStep.run)).not.toContain('playwright.config.ts')
		expect(String(e2eStep.run)).not.toContain('test:pw')
		expect(String(e2eStep.run)).not.toContain('--retries')
	})

	it('fails loud with a fixed marker when PWRS_REPORTER_TOKEN is missing', () => {
		const uploadStep = stepByName('直传走查证据到 PWRS')
		const run = String(uploadStep.run)
		expect(run).toContain('[ -z "$PWRS_REPORTER_TOKEN" ]')
		expect(run).toContain('HERDWEB_UI_REPORTER_TOKEN_MISSING')
		const uploadEnv = requireRecord(uploadStep.env, 'upload step env')
		expect(uploadEnv.PWRS_REPORTER_TOKEN).toBe('${{ secrets.PWRS_REPORTER_TOKEN }}')
		expect(run).not.toContain('echo "$PWRS_REPORTER_TOKEN"')
		expect(run).not.toContain('set -x')
		expect(run).not.toContain('printenv')
	})

	it('uploads the self-contained HTML report to PWRS with the head-SHA title', () => {
		const uploadStep = stepByName('直传走查证据到 PWRS')
		const run = String(uploadStep.run)
		expect(run).toContain('playwright-reporter-cli upload playwright-report')
		expect(run).toContain('--url "$PWRS_BASE"')
		expect(run).toContain(
			'--title "$GITHUB_REPOSITORY ui-evidence ${UI_EVIDENCE_HEAD_SHA} (run ${GITHUB_RUN_ID})"',
		)
	})

	it('keeps resolve, ping, and upload running on the failure path (!cancelled)', () => {
		for (const needle of ['解析 PWRS', '探活 PWRS', '直传走查证据到 PWRS']) {
			const step = stepByName(needle)
			expect(String(step.if)).toContain('!cancelled()')
		}
	})

	it('publishes via the shared composite action with matching e2e status and head SHA', () => {
		const publishStep = stepByName('发布走查证据评论')
		expect(publishStep.uses).toBe('zlxlabs/gate-hub/.github/actions/ui-evidence-publish@main')
		const withInputs = requireRecord(publishStep.with, 'publish step with')
		expect(withInputs['e2e-status']).toBe('${{ steps.e2e.outcome }}')
		expect(withInputs['head-sha']).toBe('${{ env.UI_EVIDENCE_HEAD_SHA }}')
		expect(withInputs.subject).toBeDefined()
	})

	it('cancels superseded runs of the same ref', () => {
		const concurrency = requireRecord(doc.concurrency, 'herdweb-visual.yml concurrency')
		expect(String(concurrency.group)).toContain('github.ref')
		expect(concurrency['cancel-in-progress']).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// playwright.visual.config.ts + playwright.config.ts boundary
// ---------------------------------------------------------------------------

describe('playwright.visual.config.ts (visual walkthrough config)', () => {
	it('discovers only the visual spec', () => {
		expect(visualConfig.testMatch).toBe('**/herdweb-visual.spec.ts')
		expectGlobMatches(
			String(visualConfig.testMatch),
			'tests/playwright/herdweb-visual.spec.ts',
			true,
		)
		expectGlobMatches(String(visualConfig.testMatch), 'tests/playwright/smoke.spec.ts', false)
		expectGlobMatches(String(visualConfig.testMatch), 'tests/playwright/dpad.spec.ts', false)
	})

	it('overrides any inherited ignore so visual discovery is never empty', () => {
		expect(visualConfig.testIgnore).toEqual([])
	})

	it('is single worker, zero retries, serial — no retry washing', () => {
		expect(visualConfig.workers).toBe(1)
		expect(visualConfig.retries).toBe(0)
		expect(visualConfig.fullyParallel).toBe(false)
	})

	it('actually produces video, trace, and screenshot media', () => {
		expect(visualConfig.use).toMatchObject({ video: 'on', trace: 'on', screenshot: 'on' })
	})

	it('writes a single self-contained HTML report to the directory the workflow uploads', () => {
		expect(visualConfig.reporter).toEqual([
			['html', { outputFolder: 'playwright-report', open: 'never' }],
		])
	})

	it('keeps the chromium-only matrix and the shared suite timeout', () => {
		expect(visualConfig.projects?.map((project) => project.name)).toEqual(['chromium-android'])
		expect(visualConfig.timeout).toBe(baseConfig.timeout)
	})
})

describe('playwright.config.ts (blocking suite unchanged + precise isolation)', () => {
	it('ignores exactly the visual spec — nothing else', () => {
		expect(baseConfig.testIgnore).toEqual(['**/herdweb-visual.spec.ts'])
		expectGlobMatches('**/herdweb-visual.spec.ts', 'tests/playwright/herdweb-visual.spec.ts', true)
		expectGlobMatches('**/herdweb-visual.spec.ts', 'tests/playwright/smoke.spec.ts', false)
	})

	it('keeps the original projects, dir, timeout, retry, and flaky-failure semantics', () => {
		expect(baseConfig.projects?.map((project) => project.name)).toEqual([
			'chromium-android',
			'webkit-iphone',
		])
		expect(baseConfig.testDir).toBe('./tests/playwright')
		expect(baseConfig.timeout).toBe(30_000)
		expect(baseConfig.retries).toBe(process.env.CI ? 2 : 0)
		expect(baseConfig.failOnFlakyTests).toBe(Boolean(process.env.CI))
	})
})

// ---------------------------------------------------------------------------
// fixture integrity (real producer bytes must not drift)
// ---------------------------------------------------------------------------

describe('gate-onboarding fixtures (real producer bytes)', () => {
	const expectedHashes: Record<string, string> = {
		'caller-ci.yml': '4ce3fef5b18a08ba15cc56551bb1edc74ca9497aad5a7b6e6e880ca43b0ab900',
		'caller-disposition-ci.yml': '9ee6318f867c9419be30b390fe44d447d341864873de7c17e36713d97d12ed0a',
		'caller-shadow-ci.yml': '623eb4d746ec23c48962f5ee4d6e6e55fe8e79b6ce18d475c0fb0635b76be903',
		'gate-v2-disposition-workflow-call.yml':
			'fb82a4957bc3337924e353703dbb5ab8b32939a70b9d14bf34f4f10954b5989d',
		'gate-v2-quality-entry-detect.yml':
			'b79ff876b65faa2af6fcabb43f8801dc929032079453e75f7d9159e0c1b7eed4',
		'gate-v2-quality-entry-run.yml':
			'fecd4fb14e1ac49d3aac19293b3c72f8f16412a61a2976a50903e5ff922976d0',
	}

	for (const [name, expected] of Object.entries(expectedHashes)) {
		it(`${name} matches the recorded platform bytes`, () => {
			expect(fixtureSha256(name)).toBe(expected)
		})
	}

	it('records the verified platform refs in SOURCE.md', () => {
		const source = readFixture('SOURCE.md')
		expect(source).toContain('0a57417785b3ea80b0d260af7c1feb915873155d')
		expect(source).toContain('f4213194f162062bc22d57cd6ac5589e97d920af')
	})
})
