/**
 * Spin up a private `herdweb serve` instance for specs that can't share the
 * suite-wide webServer PTY — e.g. because they flip modal terminal state
 * (foreground processes, live mouse modes) that would race parallel specs.
 * Uses a temp HOME so the user's real ~/.config/herdweb/ config can't leak in.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnProcess } from '../../src/util/node-compat'

const repoRoot = join(import.meta.dirname, '../..')
const tsxBin = join(repoRoot, 'node_modules/.bin/tsx')

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

export async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url)
			if (response.ok) {
				return
			}
		} catch {
			// server not ready yet
		}

		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	throw new Error(`timed out waiting for ${url}`)
}

interface IsolatedServe {
	port: number
	url: string
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
		isolateTmpDir?: boolean
	} = {},
): Promise<IsolatedServe> {
	const {
		basePath,
		command = ['bash', '--norc', '--noprofile'],
		configPath,
		isolateTmpDir,
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
			'--',
			...command,
		],
		{
			cwd: repoRoot,
			env: { ...process.env, HOME: home, ...(serveTmp ? { TMPDIR: serveTmp } : {}) },
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
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
		await waitForHttp(url, 30_000)
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
