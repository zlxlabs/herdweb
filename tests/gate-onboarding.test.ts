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
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
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
const readDedentedFixture = (name: string, width = 2): Record<string, unknown> =>
	parse(
		readFixture(name)
			.split('\n')
			.map((line) => line.replace(new RegExp(`^ {${width}}`), ''))
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

	it('declares the repo-owned prep chain then the final exec, in order (structure, not grep)', () => {
		// Quality-entry contract: the entry owns the FULL pipeline including
		// dependency prep (gate README @ f4213194…, lines 38–53); missing mise = shell 127.
		expect(effectiveLines).toEqual([
			'set -eu',
			'cd "$(dirname "$0")/.."',
			'mise trust --yes ./mise.toml',
			'mise install --yes',
			'mise exec -- pnpm install --frozen-lockfile',
			'mise exec -- pnpm exec playwright install --with-deps chromium webkit',
			'exec mise exec -- pnpm run ci-check',
		])
		const ciYaml = readText('.github/workflows/ci.yml')
		expect(ciYaml).toContain('pnpm run ci-check')
	})

	it('design doc pins the formal gate README contract (ref, blob, sha256) and drops the old only-exec clause', () => {
		const design = readText('docs/sessions/herdweb-261012-triage/design.md')
		expect(design).toContain('f4213194f162062bc22d57cd6ac5589e97d920af')
		expect(design).toContain('14b5655060e5979df58cf45ca89f2ccf19e147ea')
		expect(design).toContain('e71d6839b2635b57888bd85aaae846fe2dad3305d1e7127c9b7a42c1e048e07e')
		expect(design).not.toContain('内容只有 `exec pnpm run ci-check`')
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

	// --- real-entry subprocess producer: fake bin dir seals the environment ---

	const EXPECTED_ARGV: Record<string, string[]> = {
		trust: ['trust', '--yes', './mise.toml'],
		tools: ['install', '--yes'],
		deps: ['exec', '--', 'pnpm', 'install', '--frozen-lockfile'],
		browsers: 'exec -- pnpm exec playwright install --with-deps chromium webkit'.split(' '),
		quality: ['exec', '--', 'pnpm', 'run', 'ci-check'],
	}

	// Fake mise: binds each phase by subcommand + first operand (no call counting),
	// appends one observation block per call, exits with the phase's configured code.
	const FAKE_MISE = `#!/bin/sh
set -eu
case "\$1" in trust) phase=trust ;; install) phase=tools ;; exec) case "\${3:-}:\${4:-}" in pnpm:install) phase=deps ;; pnpm:exec) phase=browsers ;; pnpm:run) phase=quality ;; esac ;; *) phase=unknown ;; esac
{ printf 'phase=%s\\n' "\$phase"; printf 'cwd=%s\\n' "\$PWD"; for a in "\$@"; do printf 'arg=%s\\n' "\$a"; done; if [ -n "\${CI+x}" ]; then printf 'env:CI=%s\\n' "\$CI"; fi; if [ -n "\${GATE_ARTIFACT_DIR+x}" ]; then printf 'env:GATE_ARTIFACT_DIR=%s\\n' "\$GATE_ARTIFACT_DIR"; fi; printf -- '---\\n'; } >> "\$FAKE_MISE_RECORD"
case "\$phase" in trust) exit "\${FAKE_TRUST_EXIT:-0}" ;; tools) exit "\${FAKE_TOOLS_EXIT:-0}" ;; deps) exit "\${FAKE_DEPS_EXIT:-0}" ;; browsers) exit "\${FAKE_BROWSERS_EXIT:-0}" ;; quality) exit "\${FAKE_QUALITY_EXIT:-0}" ;; *) printf 'fake-mise: unbound argv\\n' >&2; exit 90 ;; esac
`

	// pnpm stub: a regressed entry calling pnpm directly (pre-prep H1) can only record and exit 95.
	const FAKE_PNPM_STUB = `#!/bin/sh
{ printf 'phase=pnpm-direct\\n'; printf 'cwd=%s\\n' "\$PWD"; for a in "\$@"; do printf 'arg=%s\\n' "\$a"; done; printf -- '---\\n'; } >> "\$FAKE_MISE_RECORD"
exit "\${FAKE_PNPM_EXIT:-95}"
`

	const readBlocks = (record: string) => {
		if (!existsSync(record)) {
			return []
		}
		return readFileSync(record, 'utf8')
			.split('---\n')
			.filter((chunk) => chunk !== '')
			.map((chunk) => {
				const lines = chunk.split('\n').filter((line) => line !== '')
				const env = Object.fromEntries(
					lines.filter((line) => line.startsWith('env:')).map((line) => line.slice(4).split('=')),
				) as Record<string, string>
				return {
					phase: lines[0].slice(6),
					cwd: lines[1].slice(4),
					args: lines.filter((line) => line.startsWith('arg=')).map((line) => line.slice(4)),
					env,
				}
			})
	}

	/** Runs the real entry as a subprocess. PATH is REPLACED (not prepended) with
	 * fakebin:/usr/bin:/bin so no real mise from the parent env can ever be
	 * reached; env overrides are fictional placeholders only. */
	const runEntry = (opts: {
		exitCodes?: Record<string, string>
		cwd?: string
		withMise?: boolean
	}) => {
		const dir = mkdtempSync(join(tmpdir(), 'gate-quality-prep-'))
		const bin = join(dir, 'bin')
		mkdirSync(bin, { recursive: true })
		if (opts.withMise !== false) {
			writeFileSync(join(bin, 'mise'), FAKE_MISE)
			chmodSync(join(bin, 'mise'), 0o755)
		}
		writeFileSync(join(bin, 'pnpm'), FAKE_PNPM_STUB)
		chmodSync(join(bin, 'pnpm'), 0o755)
		const record = join(dir, 'calls.txt')
		const result = spawnSync(scriptPath, [], {
			cwd: opts.cwd ?? repoRoot,
			env: {
				...process.env,
				PATH: `${bin}:/usr/bin:/bin`,
				FAKE_MISE_RECORD: record,
				CI: 'ci-placeholder',
				GATE_ARTIFACT_DIR: '/tmp/fictional-gate-artifacts',
				...(opts.exitCodes ?? {}),
			},
		})
		return { result, record, dir }
	}

	it('producer e2e: entry subprocess → fake mise, exact argv/cwd/env sequence even from a foreign cwd', () => {
		const foreign = mkdtempSync(join(tmpdir(), 'gate-quality-cwd-'))
		const { result, record, dir } = runEntry({ cwd: foreign })
		try {
			expect(result.status).toBe(0)
			const blocks = readBlocks(record)
			expect(blocks.map((block) => block.phase)).toEqual(Object.keys(EXPECTED_ARGV))
			for (const block of blocks) {
				expect(block.args).toEqual(EXPECTED_ARGV[block.phase])
				expect(realpathSync(block.cwd)).toBe(realpathSync(repoRoot))
				expect(block.env.CI).toBe('ci-placeholder')
				expect(block.env.GATE_ARTIFACT_DIR).toBe('/tmp/fictional-gate-artifacts')
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
			rmSync(foreign, { recursive: true, force: true })
		}
	})

	it('each failing phase propagates its own exit code and no later phase runs', () => {
		const failCodes = { trust: 17, tools: 19, deps: 23, browsers: 27, quality: 29 }
		const order = Object.keys(EXPECTED_ARGV)
		for (const [phase, code] of Object.entries(failCodes)) {
			const envVar = `FAKE_${phase.toUpperCase()}_EXIT`
			const { result, record, dir } = runEntry({ exitCodes: { [envVar]: String(code) } })
			try {
				expect(result.status, `${phase} must propagate exit ${code}`).toBe(code)
				const phases = readBlocks(record).map((block) => block.phase)
				expect(phases, `${phase} must be the last recorded call`).toEqual(
					order.slice(0, order.indexOf(phase) + 1),
				)
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		}
	})

	it('fails loud 127 with no mise on PATH and records no call at all', () => {
		const { result, record, dir } = runEntry({ withMise: false })
		try {
			expect(result.status).toBe(127)
			expect(result.stderr.toString()).toContain('mise')
			expect(result.stderr.toString()).toContain('not found')
			expect(existsSync(record)).toBe(false)
		} finally {
			rmSync(dir, { recursive: true, force: true })
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

	it('admits only trusted events at the job level (self-hosted never runs untrusted code)', () => {
		// Trust matrix: workflow_dispatch → maintainer-triggered, trusted, and
		// short-circuits before any PR-context field is evaluated. pull_request
		// → admitted only when the PR head branch lives in THIS repository
		// (external forks never match head.repo.full_name == github.repository)
		// AND the PR author is not dependabot[bot] (same-repo bot branches).
		// github.actor is deliberately unused: a re-trigger can swap the actor.
		const jobIf = String(job.if)
		expect(jobIf).toContain("github.event_name == 'workflow_dispatch'")
		expect(jobIf).toContain("github.event_name == 'pull_request'")
		expect(jobIf).toContain('github.event.pull_request.head.repo.full_name == github.repository')
		expect(jobIf).toContain("github.event.pull_request.user.login != 'dependabot[bot]'")
		expect(jobIf).not.toContain('github.actor')
		expect(jobIf.indexOf('workflow_dispatch')).toBeLessThan(
			jobIf.indexOf('pull_request.head.repo.full_name'),
		)
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
		expect(run).toContain('playwright-reporter-cli upload test-results/playwright-report')
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

	it('publishes via the shared composite action only after a successful upload', () => {
		const publishStep = stepByName('发布走查证据评论')
		expect(publishStep.uses).toBe('zlxlabs/gate-hub/.github/actions/ui-evidence-publish@main')
		// F3: the publish gate references the upload step's own outcome — a
		// failed upload leaves the job red and posts no new comment (the sticky
		// comment keeps its previous state). e2e-status stays the raw e2e
		// outcome: an upload-infrastructure failure is never re-labelled as a
		// test failure.
		expect(stepByName('直传走查证据到 PWRS').id).toBe('upload')
		const publishIf = String(publishStep.if)
		expect(publishIf).toContain('!cancelled()')
		expect(publishIf).toContain("github.event_name == 'pull_request'")
		expect(publishIf).toContain("steps.upload.outcome == 'success'")
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
			['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
		])
	})

	it('keeps report and test artifacts as siblings under test-results/ (never nested)', () => {
		// Playwright refuses an HTML report folder that clashes with the tests
		// output folder; visual artifacts get their own sibling directory so
		// neither is a subtree of the other (path math, not just two strings).
		expect(visualConfig.outputDir).toBe('test-results/visual-artifacts')
		const artifactsAbs = resolve(repoRoot, 'test-results/visual-artifacts')
		const reportAbs = resolve(repoRoot, 'test-results/playwright-report')
		expect(reportAbs.startsWith(`${artifactsAbs}${sep}`)).toBe(false)
		expect(artifactsAbs.startsWith(`${reportAbs}${sep}`)).toBe(false)
		expect(dirname(reportAbs)).toBe(dirname(artifactsAbs))
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
// ui-visual upload producer: real workflow run block → bash → argv (F4)
// ---------------------------------------------------------------------------

describe('ui-visual upload producer (real YAML run block executed under bash)', () => {
	const doc = readYaml('.github/workflows/herdweb-visual.yml')
	const jobs = requireRecord(doc.jobs, 'herdweb-visual.yml jobs')
	const job = requireRecord(jobs['ui-visual'], 'herdweb-visual.yml jobs.ui-visual')
	const steps = requireArray(job.steps, 'herdweb-visual.yml jobs.ui-visual.steps')
	const uploadStep = steps
		.map((step, index) => requireRecord(step, `step #${index}`))
		.find((record) => String(record.name).includes('直传走查证据到 PWRS'))
	if (!uploadStep) {
		throw new Error('upload step not found')
	}
	const uploadRun = String(uploadStep.run)

	// Real template slice: the upload step of gate-hub templates/ui-visual/
	// workflow.yml @ d39ee21af70dc8902878b273c3a5e1ee0f8ff6e4 (provenance in
	// SOURCE.md). The slice is one steps list item (`- name: …`), so the
	// dedented YAML parses as a one-element sequence; unwrap it. The adapter
	// deltas vs these bytes are asserted below.
	const templateSteps = readDedentedFixture('template-ui-visual-upload-step.yml', 6)
	const templateStep = (Array.isArray(templateSteps) ? templateSteps[0] : templateSteps) as Record<
		string,
		unknown
	>
	const templateRun = String(templateStep.run)

	// Neither the template nor the adapter declares `shell:` on the step, so
	// GitHub's documented Linux default applies: `bash -e {0}`. The spawn below
	// reproduces exactly that (no pipefail claim).
	const TOKEN_CHECK = [
		'# Fail loud on a missing reporter token; never print the value itself.',
		'if [ -z "$PWRS_REPORTER_TOKEN" ]; then',
		'  echo "HERDWEB_UI_REPORTER_TOKEN_MISSING" >&2',
		'  exit 1',
		'fi',
	].join('\n')

	const HEAD40 = '3f2a9c1e5b7d6084a2c4e6f8091b3d5f7a9c1e2b'
	const FICTIONAL_TOKEN = 'fictional-test-token-never-a-real-secret'

	it('upload-step fixture matches the frozen template slice bytes', () => {
		expect(fixtureSha256('template-ui-visual-upload-step.yml')).toBe(
			'9b75a98ff895550a343392ab7d25e527bdf0bea174dcd8bf4b95f22b176c99e6',
		)
	})

	it('SOURCE.md registers the frozen template provenance and slice hash', () => {
		const source = readFixture('SOURCE.md')
		for (const needle of [
			'd39ee21af70dc8902878b273c3a5e1ee0f8ff6e4',
			'1a184b6af6646eab6cb7f80daf4297897ef8587f',
			'5fa93c05234f74bd98d9a5c6dbfb4902e3398359491394255bd22618419e9a2f',
			'9b75a98ff895550a343392ab7d25e527bdf0bea174dcd8bf4b95f22b176c99e6',
			'template-ui-visual-upload-step.yml',
		]) {
			expect(source).toContain(needle)
		}
	})

	it('keeps the producer run block byte-tied to the real template slice (documented deltas only)', () => {
		expect(templateStep['working-directory']).toBe('e2e')
		expect(uploadStep['working-directory']).toBeUndefined()
		expect(templateStep.shell).toBeUndefined()
		expect(uploadStep.shell).toBeUndefined()
		const adaptedTemplate = templateRun.replace(
			'upload playwright-report',
			'upload test-results/playwright-report',
		)
		expect(adaptedTemplate).not.toBe(templateRun)
		expect(uploadRun).toBe(`${TOKEN_CHECK}\n${adaptedTemplate}`)
	})

	/** Runs the real run block under GitHub's default Linux shell mode, with a
	 * fake `npx` first on PATH capturing argv (NUL-delimited). All secret-ish
	 * inputs are explicitly overridden with fictional values — never the real
	 * environment. */
	const runUploadScript = (envOverrides: Record<string, string>) => {
		const dir = mkdtempSync(join(tmpdir(), 'ui-upload-producer-'))
		const script = join(dir, 'upload-run.sh')
		writeFileSync(script, uploadRun)
		writeFileSync(
			join(dir, 'npx'),
			'#!/bin/sh\nprintf \'%s\\0\' "$@" > "$FAKE_NPX_ARGFILE"\nexit "$FAKE_NPX_EXIT"\n',
		)
		chmodSync(join(dir, 'npx'), 0o755)
		return {
			result: spawnSync('bash', ['-e', script], {
				env: {
					...process.env,
					PATH: `${dir}:${process.env.PATH ?? ''}`,
					PWRS_BASE: 'https://pwrs.example.invalid',
					GITHUB_REPOSITORY: 'zlxlabs/herdweb',
					GITHUB_RUN_ID: '12345',
					GITHUB_REF_NAME: 'card/test-fixture',
					UI_EVIDENCE_HEAD_SHA: HEAD40,
					PWRS_REPORTER_TOKEN: FICTIONAL_TOKEN,
					FAKE_NPX_ARGFILE: join(dir, 'argv.bin'),
					FAKE_NPX_EXIT: '0',
					...envOverrides,
				},
			}),
			dir,
		}
	}

	it('sends the exact upload argv to real bash with a fake npx on PATH', () => {
		const { result, dir } = runUploadScript({})
		try {
			expect(result.status).toBe(0)
			const argv = readFileSync(join(dir, 'argv.bin')).toString('utf8').split('\0')
			expect(argv[argv.length - 1]).toBe('')
			argv.pop()
			expect(argv).toEqual([
				'--yes',
				'--package=@cyborgtests/reporter@3.0.0',
				'--package=streamx@2.28.1',
				'playwright-reporter-cli',
				'upload',
				'test-results/playwright-report',
				'--url',
				'https://pwrs.example.invalid',
				'--token',
				FICTIONAL_TOKEN,
				'--project',
				'zlxlabs/herdweb',
				'--title',
				`zlxlabs/herdweb ui-evidence ${HEAD40} (run 12345)`,
				'--meta',
				'branch=card/test-fixture',
				'--meta',
				'run_id=12345',
				'--meta',
				'environment=ui-evidence',
			])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('propagates a failing uploader exit code through the real shell', () => {
		const { result, dir } = runUploadScript({ FAKE_NPX_EXIT: '17' })
		try {
			expect(result.status).toBe(17)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('fails loud on an empty token without ever invoking npx', () => {
		const { result, dir } = runUploadScript({ PWRS_REPORTER_TOKEN: '' })
		try {
			expect(result.status).toBe(1)
			expect(result.stderr.toString()).toContain('HERDWEB_UI_REPORTER_TOKEN_MISSING')
			expect(existsSync(join(dir, 'argv.bin'))).toBe(false)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
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
