// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { sleep, spawnProcess } from '../src/util/node-compat'

const repoRoot = join(import.meta.dirname, '..')
const tsxLoader = join(repoRoot, 'node_modules/tsx/dist/loader.mjs')

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
	const caller = spawnProcess(
		[
			process.execPath,
			'--import',
			tsxLoader,
			'--eval',
			[
				"void (async () => { const { startIsolatedServe } = await import('./tests/playwright/isolated-serve.ts'); const server = await startIsolatedServe(); console.log(server.port); setInterval(() => {}, 1000) })()",
			].join('\n'),
		],
		{
			cwd: repoRoot,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	let port: number | undefined
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
	}
})
