/**
 * Spin up a private `herdweb serve` instance for specs that need
 * process/session-specific terminal state (foreground processes, live mouse
 * modes) without sharing a PTY with another test.
 * Uses a temp HOME so the user's real ~/.config/herdweb/ config can't leak in.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnProcess } from '../../src/util/node-compat'

const repoRoot = join(import.meta.dirname, '../..')
const tsxBin = join(repoRoot, 'node_modules/.bin/tsx')
const READY_LINE_PREFIX = 'herdweb: serving on '
const HANG_GUARD_MS = 60_000

export async function reservePort(): Promise<number> {
	const server = createNetServer()

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})

	const address = server.address()
	if (!address || typeof address === 'string') {
		server.close()
		throw new Error('failed to reserve test port')
	}

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error)
				return
			}
			resolve()
		})
	})

	return address.port
}

type ServeProc = ReturnType<typeof spawnProcess>

function captureRecentLines(
	stream: ServeProc['stdout'] | ServeProc['stderr'] | undefined,
	maxLines = 20,
): () => string[] {
	if (!stream) return () => []
	const lines: string[] = []
	let rest = ''
	stream.setEncoding('utf8')
	stream.on('data', (chunk: string) => {
		const parts = (rest + chunk).split('\n')
		rest = parts.pop() ?? ''
		lines.push(...parts)
		if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
	})
	return () => (rest ? [...lines, rest].slice(-maxLines) : [...lines])
}

/** `proc` present: wait for `herdweb: serving on `. One-arg calls (proxy.spec.ts) poll HTTP. */
export async function waitForHttp(
	url: string,
	proc?: ServeProc,
	hangGuardMs = HANG_GUARD_MS,
): Promise<void> {
	if (!proc) {
		const deadline = Date.now() + hangGuardMs
		while (Date.now() < deadline) {
			try {
				const response = await fetch(url)
				if (response.ok) return
			} catch {
				// proxy not ready yet
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		throw new Error(`timed out waiting for ${url} (HTTP never became ready after ${hangGuardMs}ms)`)
	}

	const getStdout = captureRecentLines(proc.stdout)
	const getStderr = captureRecentLines(proc.stderr)
	let exitStatus: { code: number } | null = null
	proc.exited.then(
		(code) => {
			exitStatus = { code }
		},
		() => {
			exitStatus = { code: 1 }
		},
	)
	const getExitStatus = (): { code: number } | null => exitStatus
	const deadline = Date.now() + hangGuardMs
	while (Date.now() < deadline) {
		const earlyExit = getExitStatus()
		if (earlyExit !== null) {
			const stderrOutput = getStderr().length > 0 ? getStderr().join('\n') : '<no stderr>'
			throw new Error(
				`timed out waiting for ${url} (process exit code ${earlyExit.code})\nstderr:\n${stderrOutput}`,
			)
		}
		if (getStdout().some((line) => line.startsWith(READY_LINE_PREFIX))) return
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	const finalExit = getExitStatus()
	if (finalExit !== null) {
		const stderrOutput = getStderr().length > 0 ? getStderr().join('\n') : '<no stderr>'
		throw new Error(
			`timed out waiting for ${url} (process exit code ${finalExit.code})\nstderr:\n${stderrOutput}`,
		)
	}
	const stdoutOutput = getStdout().length > 0 ? getStdout().join('\n') : '<no stdout>'
	const stderrOutput = getStderr().length > 0 ? getStderr().join('\n') : '<no stderr>'
	throw new Error(
		`timed out waiting for ${url}: 就绪行未出现 (process still running after ${hangGuardMs}ms)\nstdout:\n${stdoutOutput}\nstderr:\n${stderrOutput}`,
	)
}

interface IsolatedServe {
	port: number
	url: string
	exited: Promise<number | null>
	/** Isolated HOME passed to the serve process (state lives under here). */
	home: string
	/**
	 * Isolated TMPDIR of the serve process when `isolateTmpDir` was requested —
	 * image drops land here instead of the real /tmp; removed by close().
	 */
	tmpDir: string | null
	close(): Promise<void>
}

export async function startIsolatedServe(
	options: {
		basePath?: string
		command?: string[]
		configPath?: string
		detached?: boolean
		isolateTmpDir?: boolean
		killWithParent?: boolean
	} = {},
): Promise<IsolatedServe> {
	const {
		basePath,
		command = ['bash', '--norc', '--noprofile'],
		configPath,
		detached = true,
		isolateTmpDir,
		killWithParent = true,
	} = options
	const port = await reservePort()
	const home = mkdtempSync(join(tmpdir(), 'herdweb-playwright-home-'))
	const serveTmp = isolateTmpDir ? mkdtempSync(join(tmpdir(), 'herdweb-playwright-tmp-')) : null

	const proc = spawnProcess(
		[
			tsxBin,
			'cli.ts',
			'serve',
			...(configPath ? ['--config', configPath] : []),
			'--port',
			String(port),
			...(basePath ? ['--base-path', basePath] : []),
			// Explicit-target configs reject a trailing command; pass [] to omit it.
			...(command.length > 0 ? ['--', ...command] : []),
		],
		{
			cwd: repoRoot,
			env: { ...process.env, HOME: home, ...(serveTmp ? { TMPDIR: serveTmp } : {}) },
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			detached,
			killWithParent,
		},
	)
	let exited = false
	void proc.exited.then(() => {
		exited = true
	})

	const cleanup = (): void => {
		rmSync(home, { recursive: true, force: true })
		if (serveTmp) rmSync(serveTmp, { recursive: true, force: true })
	}

	const url = `http://127.0.0.1:${port}${basePath ?? ''}`
	try {
		await waitForHttp(url, proc)
	} catch (error) {
		if (!exited) {
			proc.kill('SIGINT')
			await proc.exited
		}
		cleanup()
		throw error
	}

	return {
		port,
		url,
		exited: proc.exited,
		home,
		tmpDir: serveTmp,
		async close(): Promise<void> {
			if (!exited) {
				proc.kill('SIGINT')
				await proc.exited
			}
			cleanup()
		},
	}
}
