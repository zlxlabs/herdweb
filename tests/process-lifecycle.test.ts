// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import WebSocket from 'ws'
import { sleep, spawnProcess } from '../src/util/node-compat'

const repoRoot = join(import.meta.dirname, '..')
const tsxLoader = join(repoRoot, 'node_modules/tsx/dist/loader.mjs')
const tsx = join(repoRoot, 'node_modules/.bin/tsx')

function isPortListening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port })
		let settled = false
		const settle = (listening: boolean): void => {
			if (settled) return
			settled = true
			socket.destroy()
			resolve(listening)
		}
		socket.once('connect', () => settle(true))
		socket.once('error', () => settle(false))
		setTimeout(() => settle(false), 1_000)
	})
}

async function waitForPort(port: number, listening: boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if ((await isPortListening(port)) === listening) return
		await sleep(100)
	}
	throw new Error(`timed out waiting for port ${port} to be ${listening ? 'open' : 'closed'}`)
}

async function reservePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('failed to reserve test port')
	const port = address.port
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()))
	})
	return port
}

async function waitForStderr(proc: ReturnType<typeof spawnProcess>, marker: string): Promise<void> {
	const stderr = proc.stderr
	if (!stderr) throw new Error('caller stderr is not piped')
	await new Promise<void>((resolve, reject) => {
		let output = ''
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error(`timed out waiting for stderr marker ${marker}: ${output}`))
		}, 10_000)
		const onData = (chunk: Buffer): void => {
			output += chunk.toString('utf8')
			if (!output.includes(marker)) return
			cleanup()
			resolve()
		}
		const onExit = (code: number): void => {
			cleanup()
			reject(new Error(`caller exited with ${code} before stderr marker ${marker}: ${output}`))
		}
		const cleanup = (): void => {
			clearTimeout(timer)
			stderr.off('data', onData)
			void proc.exited.then(() => undefined)
		}
		stderr.on('data', onData)
		void proc.exited.then(onExit)
	})
}

function orphanedServePids(port: number): number[] {
	const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
	return output
		.split('\n')
		.map((line) => line.trim().split(/\s+/, 3))
		.filter(
			(fields) => fields[1] === '1' && fields[2]?.includes(`cli.ts serve --port ${port}`) === true,
		)
		.map((fields) => Number(fields[0]))
		.filter((pid) => Number.isInteger(pid) && pid > 0)
}

function attachDefaultTarget(ws: WebSocket, requestId: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let attachmentId = ''
		ws.once('error', reject)
		ws.on('message', (data) => {
			const message = JSON.parse(data.toString()) as Record<string, unknown>
			if (message.type === 'targets') {
				ws.send(
					JSON.stringify({
						type: 'attach-target',
						requestId,
						targetId: 'default',
						cols: 80,
						rows: 24,
					}),
				)
			}
			if (message.type === 'attach-started') attachmentId = String(message.attachmentId)
			if (message.type === 'snapshot') {
				ws.send(JSON.stringify({ type: 'snapshot-applied', requestId, attachmentId }))
			}
			if (message.type === 'attach-committed') resolve(attachmentId)
		})
	})
}

async function readPort(proc: ReturnType<typeof spawnProcess>): Promise<number> {
	const stdout = proc.stdout
	if (!stdout) throw new Error('caller stdout is not piped')
	return new Promise((resolve, reject) => {
		let output = ''
		const onData = (chunk: Buffer): void => {
			output += chunk.toString('utf8')
			const line = output.split('\n')[0]?.trim()
			if (line && /^\d+$/.test(line)) {
				proc.stdout?.off('data', onData)
				resolve(Number(line))
			}
		}
		stdout.on('data', onData)
		void proc.exited.then((code) =>
			reject(new Error(`caller exited before reporting port: ${code}`)),
		)
	})
}

test('isolated serve dies with the caller process', async () => {
	const configHome = mkdtempSync(join(tmpdir(), 'herdweb-empty-config-'))
	const caller = spawnProcess(
		[
			process.execPath,
			'--import',
			tsxLoader,
			'--eval',
			[
				"void (async () => { const { startIsolatedServe } = await import('./tests/playwright/isolated-serve.ts'); const server = await startIsolatedServe({ configPath: 'tests/playwright/session-exit.config.ts' }); console.log(String(server.port)); setInterval(() => {}, 1000) })()",
			].join('\n'),
		],
		{
			cwd: repoRoot,
			env: { ...process.env, XDG_CONFIG_HOME: configHome },
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	let port: number | undefined
	caller.stderr?.resume()
	try {
		port = await readPort(caller)
		expect(await isPortListening(port)).toBe(true)
		caller.kill('SIGKILL')
		await sleep(100)
		await waitForPort(port, false, 10_000)
		expect(orphanedServePids(port)).toEqual([])
	} finally {
		caller.kill('SIGKILL')
		if (port !== undefined) {
			const output = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
			for (const line of output.split('\n')) {
				if (!line.includes(`cli.ts serve --port ${port}`)) continue
				const pid = Number(line.trim().split(/\s+/, 1)[0])
				if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGKILL')
			}
		}
		rmSync(configHome, { recursive: true, force: true })
	}
})

test('target exit retains the server when exit fact writing fails', async () => {
	const port = await reservePort()
	const stateRoot = mkdtempSync(join(tmpdir(), 'herdweb-process-lifecycle-'))
	const configHome = mkdtempSync(join(tmpdir(), 'herdweb-empty-config-'))
	const proc = spawnProcess(
		[
			join(repoRoot, 'node_modules/.bin/tsx'),
			'cli.ts',
			'serve',
			'--port',
			String(port),
			'--',
			'bash',
			'--norc',
			'--noprofile',
			'-c',
			'read -r; test "$XDG_CONFIG_HOME" = "$EXPECTED_CONFIG_HOME"',
		],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				EXPECTED_CONFIG_HOME: configHome,
				XDG_CONFIG_HOME: configHome,
				XDG_STATE_HOME: stateRoot,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	let exited = false
	void proc.exited.then(() => {
		exited = true
	})
	try {
		await waitForPort(port, true, 10_000)
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			origin: `http://127.0.0.1:${port}`,
		})
		const attachmentId = await attachDefaultTarget(ws, 'lifecycle-attach')
		const stateDir = join(stateRoot, 'herdweb', String(port))
		chmodSync(stateDir, 0o500)
		ws.send(JSON.stringify({ type: 'input', attachmentId, data: '\r' }))
		await waitForStderr(proc, 'herdweb: target exit fact write failed')
		expect(exited).toBe(false)
		expect(await isPortListening(port)).toBe(true)
		expect((await fetch(`http://127.0.0.1:${port}`)).status).toBe(200)

		proc.kill('SIGTERM')
		expect(await proc.exited).toBe(1)
		await waitForPort(port, false, 10_000)
	} finally {
		proc.kill('SIGTERM')
		await proc.exited.catch(() => 1)
		chmodSync(join(stateRoot, 'herdweb', String(port)), 0o700)
		rmSync(stateRoot, { recursive: true, force: true })
		rmSync(configHome, { recursive: true, force: true })
	}
})

test('healthy target exit fact persists before clean shutdown', async () => {
	const port = await reservePort()
	const stateRoot = mkdtempSync(join(tmpdir(), 'herdweb-process-lifecycle-'))
	const configHome = mkdtempSync(join(tmpdir(), 'herdweb-empty-config-'))
	const proc = spawnProcess(
		[tsx, 'cli.ts', 'serve', '--port', String(port), '--', 'bash', '-c', 'read -r; exit 0'],
		{
			cwd: repoRoot,
			env: { ...process.env, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateRoot },
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	try {
		await waitForPort(port, true, 10_000)
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
			void attachDefaultTarget(ws, 'healthy-attach').then((attachmentId) => {
				ws.send(JSON.stringify({ type: 'input', attachmentId, data: '\r' }))
			}, reject)
			ws.on('message', (data) => {
				if (JSON.parse(data.toString()).type !== 'exit') return
				ws.close()
				resolve()
			})
		})
		const stateFile = join(stateRoot, 'herdweb', String(port), 'last-session.json')
		let raw: string | undefined
		const deadline = Date.now() + 10_000
		while (raw === undefined && Date.now() < deadline) {
			try {
				raw = readFileSync(stateFile, 'utf8')
			} catch {
				await sleep(100)
			}
		}
		if (raw === undefined) throw new Error(`timed out waiting for ${stateFile}`)
		expect(raw.endsWith('\n')).toBe(true)
		expect(JSON.parse(raw).default).toMatchObject({ exitCode: 0, signal: 0 })
		proc.kill('SIGTERM')
		expect(await proc.exited).toBe(0)
		await waitForPort(port, false, 10_000)
	} finally {
		proc.kill('SIGTERM')
		await proc.exited.catch(() => 1)
		rmSync(stateRoot, { recursive: true, force: true })
		rmSync(configHome, { recursive: true, force: true })
	}
})
