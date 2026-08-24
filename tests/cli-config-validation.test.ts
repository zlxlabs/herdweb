import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { collectStream, sleep, spawnProcess } from '../src/util/node-compat'

interface CliResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

const tempDirs: string[] = []
const repoRoot = join(import.meta.dirname, '..')

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (!dir) continue
		rmSync(dir, { recursive: true, force: true })
	}
})

function createTempDir(): string {
	// realpathSync resolves the macOS /private symlink so the path matches the child's
	// process.cwd() that the CLI echoes back in `Created: <path>`.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'herdweb-cli-validation-')))
	tempDirs.push(dir)
	return dir
}

function createIsolatedEnv(): NodeJS.ProcessEnv {
	// Point XDG_CONFIG_HOME at an empty temp dir so the child's config discovery
	// never sees the host's ~/.config/herdweb. spawnProcess replaces the whole
	// environment, so process.env must be spread in (the child needs PATH for tsx).
	return { ...process.env, XDG_CONFIG_HOME: createTempDir() }
}

async function runCli(args: readonly string[], cwd: string = repoRoot): Promise<CliResult> {
	const proc = spawnProcess(['tsx', join(repoRoot, 'cli.ts'), ...args], {
		cwd,
		env: createIsolatedEnv(),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		collectStream(proc.stdout),
		collectStream(proc.stderr),
	])

	return { exitCode, stdout, stderr }
}

function writeConfig(dir: string, source: string): string {
	const path = join(dir, 'herdweb.config.ts')
	writeFileSync(path, source)
	return path
}

function writeLocalConfig(dir: string, source: string): string {
	const path = join(dir, 'herdweb.config.local.ts')
	writeFileSync(path, source)
	return path
}

function writeLegacyConfig(dir: string, source: string): string {
	const legacyApp = 're' + 'mobi'
	const path = join(dir, `${legacyApp}.config.ts`)
	writeFileSync(path, source)
	return path
}

async function reservePort(): Promise<number> {
	const server = createServer()

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

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<string> {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url)
			if (response.ok) {
				return response.text()
			}
		} catch {
			// server not ready yet
		}

		await sleep(100)
	}

	throw new Error(`timed out waiting for ${url}`)
}

describe('CLI command validation', () => {
	test('init scaffolds a plain default export without herdweb imports', async () => {
		const dir = createTempDir()

		const result = await runCli(['init'], dir)

		expect(result.exitCode).toBe(0)
		expect(result.stderr).toBe('')
		const configPath = join(dir, 'herdweb.config.ts')
		expect(result.stdout).toContain(`Created: ${configPath}`)
		const scaffold = readFileSync(configPath, 'utf8')
		expect(scaffold).toContain('export default {')
		expect(scaffold).not.toContain("from 'herdweb'")
		expect(scaffold).not.toContain('defineConfig(')
	})
	test('serve fails fast with nested validation errors', async () => {
		const dir = createTempDir()
		const configPath = writeConfig(
			dir,
			"export default { gestures: { scroll: { strategy: 'mouse' } } }",
		)

		const result = await runCli(['serve', '--config', configPath])

		expect(result.exitCode).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain(`Config validation failed for ${configPath}`)
		expect(result.stderr).toContain('config.gestures.scroll.strategy')
	})

	test('explicit targets reject a trailing command before any server starts', async () => {
		const dir = createTempDir()
		const configPath = writeConfig(
			dir,
			"export default { targets: [{ id: 'local', name: 'Local', command: ['herdr', '--session', 'local'] }], defaultTargetId: 'local' }",
		)
		const result = await runCli(['serve', '--config', configPath, '--', 'printf', 'spawn-sentinel'])
		expect(result.exitCode).toBe(1)
		expect(result.stdout).not.toContain('starting command')
		expect(result.stdout).not.toContain('spawn-sentinel')
		expect(result.stderr).toContain('Explicit targets')
	})

	test('single mode passes every trailing argv byte to the producer', async () => {
		const dir = createTempDir()
		const configPath = writeConfig(dir, 'export default {}')
		const argvPath = join(dir, 'argv.json')
		const port = await reservePort()
		const proc = spawnProcess(
			[
				'tsx',
				join(repoRoot, 'cli.ts'),
				'serve',
				'--config',
				configPath,
				'--port',
				String(port),
				'--',
				'node',
				'-e',
				"require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2))); setTimeout(() => {}, 30000)",
				argvPath,
				'sp ace',
				'值',
				'--literal',
			],
			{ cwd: repoRoot, env: createIsolatedEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
		)
		try {
			await waitForHttp(`http://127.0.0.1:${port}`)
			await sleep(100)
			expect(JSON.parse(readFileSync(argvPath, 'utf8'))).toEqual(['sp ace', '值', '--literal'])
		} finally {
			proc.kill('SIGTERM')
			await proc.exited
		}
	})

	test('build exits with a deprecation error', async () => {
		const result = await runCli(['build'])

		expect(result.exitCode).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('herdweb build is deprecated and no longer supported')
		expect(result.stderr).toContain('Use `herdweb serve` instead.')
	})

	test('inject exits with a deprecation error', async () => {
		const result = await runCli(['inject'])

		expect(result.exitCode).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('herdweb inject is deprecated and no longer supported')
		expect(result.stderr).toContain('Use `herdweb serve` instead.')
	})

	test('serve loads local config overrides from the .local sibling file', async () => {
		const dir = createTempDir()
		const configPath = writeConfig(dir, "export default { name: 'shared-name' }")
		writeLocalConfig(dir, "export default { name: 'local-override' }")
		const port = await reservePort()
		const proc = spawnProcess(
			[
				'tsx',
				join(repoRoot, 'cli.ts'),
				'serve',
				'--config',
				configPath,
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'sleep 30',
			],
			{
				cwd: repoRoot,
				env: createIsolatedEnv(),
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		)

		try {
			const html = await waitForHttp(`http://127.0.0.1:${port}`)
			expect(html).toContain('<title>local-override</title>')
		} finally {
			proc.kill('SIGINT')
			await proc.exited
		}
	})

	test('serve reports local config validation errors against the .local file', async () => {
		const dir = createTempDir()
		const configPath = writeConfig(dir, "export default { name: 'shared' }")
		const localPath = writeLocalConfig(dir, 'export default { unknownKey: true }')

		const result = await runCli(['serve', '--config', configPath])

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain(localPath)
		expect(result.stderr).toContain('config.unknownKey')
	})

	test('serve fails cleanly when the port is already in use', async () => {
		const port = await reservePort()
		const blocker = createServer()

		await new Promise<void>((resolve, reject) => {
			blocker.once('error', reject)
			blocker.listen(port, '127.0.0.1', () => resolve())
		})

		try {
			const result = await runCli([
				'serve',
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'sleep 30',
			])

			expect(result.exitCode).toBe(1)
			expect(result.stdout).not.toContain(`herdweb: serving on http://localhost:${port}`)
			expect(result.stderr).toContain(`port ${port} is already in use`)
		} finally {
			await new Promise<void>((resolve, reject) => {
				blocker.close((error) => {
					if (error) {
						reject(error)
						return
					}
					resolve()
				})
			})
		}
	})

	test('serve loads legacy config with rename hint when herdweb config is absent', async () => {
		const dir = createTempDir()
		const legacyPath = writeLegacyConfig(dir, "export default { name: 'legacy-name' }")
		const port = await reservePort()
		const proc = spawnProcess(
			[
				'tsx',
				join(repoRoot, 'cli.ts'),
				'serve',
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'sleep 30',
			],
			{ cwd: dir, env: createIsolatedEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
		)
		const stdoutChunks: string[] = []
		const stdoutStream = proc.stdout
		if (stdoutStream) {
			stdoutStream.on('data', (chunk: Buffer | string) => {
				stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
			})
		}

		try {
			const html = await waitForHttp(`http://127.0.0.1:${port}/`)
			expect(html).toContain('<title>legacy-name</title>')
			const stdout = stdoutChunks.join('')
			expect(stdout).toContain('loaded legacy config')
			expect(stdout).toContain(legacyPath)
			expect(stdout).toContain('consider renaming to herdweb.config.ts')
		} finally {
			proc.kill('SIGTERM')
			await proc.exited
		}
	})

	test('herdweb config takes priority over legacy config in the same directory', async () => {
		const dir = createTempDir()
		writeLegacyConfig(dir, "export default { name: 'legacy-name' }")
		writeConfig(dir, "export default { name: 'herdweb-name' }")
		const port = await reservePort()
		const proc = spawnProcess(
			[
				'tsx',
				join(repoRoot, 'cli.ts'),
				'serve',
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'sleep 30',
			],
			{ cwd: dir, env: createIsolatedEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
		)

		try {
			const html = await waitForHttp(`http://127.0.0.1:${port}/`)
			expect(html).toContain('herdweb-name')
			expect(html).not.toContain('legacy-name')
		} finally {
			proc.kill('SIGTERM')
			await proc.exited
		}
	})

	test('serve uses built-in defaults when no config files exist', async () => {
		const dir = createTempDir()
		const port = await reservePort()
		const proc = spawnProcess(
			[
				'tsx',
				join(repoRoot, 'cli.ts'),
				'serve',
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'sleep 30',
			],
			{ cwd: dir, env: createIsolatedEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
		)

		try {
			const html = await waitForHttp(`http://127.0.0.1:${port}/`)
			expect(html).toContain('herdweb')
		} finally {
			proc.kill('SIGTERM')
			await proc.exited
		}
	})
})
