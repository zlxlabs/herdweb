// @vitest-environment node

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
	closeSync,
	existsSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')
const serveScript = join(repoRoot, 'scripts/plugin/serve.mjs')
const FLOCK_PY =
	'import fcntl, sys\ntry:\n    fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError:\n    sys.exit(2)\n'

const STUB_CLI = `import { createServer } from 'node:net'
const args = process.argv.slice(2)
let port = 0
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--port') port = Number(args[++i])
}
const server = createServer()
server.on('error', (error) => {
	const code = 'code' in error ? String(error.code) : ''
	console.error(\`herdweb serve failed: port \${port} is already in use on 127.0.0.1\`)
	if (code) console.error(code)
	process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
	console.log(\`LISTENING \${port}\`)
})
`

interface OwnerPayload {
	readonly pid: number
	readonly starttime: string
	readonly mode: string
	readonly port: number
	readonly config_path: string
	readonly started_at: string
}

interface ServeResult {
	readonly code: number
	readonly output: string
	readonly proc: ChildProcess
}

const children: ChildProcess[] = []
const tempDirs: string[] = []

afterEach(() => {
	for (const child of children) {
		try {
			if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL')
		} catch {
			// already gone
		}
	}
	children.length = 0
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// best-effort
		}
	}
	tempDirs.length = 0
})

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeTemp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempDirs.push(dir)
	return dir
}

async function allocPort(offset: number): Promise<number> {
	const base = 17700 + (process.pid % 40) + offset
	for (let port = base; port < 17800; port++) {
		const free = await new Promise<boolean>((resolve) => {
			const server = createServer()
			server.once('error', () => resolve(false))
			server.listen(port, '127.0.0.1', () => {
				server.close(() => resolve(true))
			})
		})
		if (free) return port
	}
	throw new Error('no free port in 17700-17799')
}

function writeStub(pluginRoot: string): void {
	mkdirSync(join(pluginRoot, 'dist'), { recursive: true })
	writeFileSync(join(pluginRoot, 'dist/cli.mjs'), STUB_CLI)
}

function serveEnv(
	stateDir: string,
	configDir: string,
	pluginRoot: string,
	port: number,
): NodeJS.ProcessEnv {
	return {
		...process.env,
		HERDR_PLUGIN_STATE_DIR: stateDir,
		HERDR_PLUGIN_CONFIG_DIR: configDir,
		HERDR_PLUGIN_ROOT: pluginRoot,
		HERDWEB_PLUGIN_PORT: String(port),
		HERDWEB_PLUGIN_MODE: 'pane',
	}
}

function spawnServe(env: NodeJS.ProcessEnv): ChildProcess {
	const proc = spawn(process.execPath, [serveScript], {
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	children.push(proc)
	return proc
}

function collect(proc: ChildProcess): { output: () => string } {
	let output = ''
	proc.stdout?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	proc.stderr?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	return { output: () => output }
}

function waitExit(proc: ChildProcess, timeoutMs = 8_000): Promise<ServeResult> {
	const bag = collect(proc)
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			try {
				if (proc.pid !== undefined) process.kill(proc.pid, 'SIGKILL')
			} catch {
				// already gone
			}
			reject(new Error(`timed out waiting for serve exit: ${bag.output()}`))
		}, timeoutMs)
		proc.once('exit', (code) => {
			clearTimeout(timer)
			resolve({ code: code ?? 1, output: bag.output(), proc })
		})
		proc.once('error', (error) => {
			clearTimeout(timer)
			reject(error)
		})
	})
}

async function waitForOwner(stateDir: string, timeoutMs = 8_000): Promise<OwnerPayload> {
	const path = join(stateDir, 'herdweb.owner.json')
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, 'utf8')) as OwnerPayload
		}
		await sleep(30)
	}
	throw new Error('timed out waiting for owner.json')
}

async function waitForOwnerPid(
	stateDir: string,
	pid: number,
	timeoutMs = 8_000,
): Promise<OwnerPayload> {
	const path = join(stateDir, 'herdweb.owner.json')
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			const owner = JSON.parse(readFileSync(path, 'utf8')) as OwnerPayload
			if (owner.pid === pid) return owner
		}
		await sleep(30)
	}
	throw new Error(`timed out waiting for owner.json pid=${pid}`)
}

function tryFlock(lockPath: string): { fd: number; acquired: boolean } {
	const fd = openSync(lockPath, 'a+')
	const result = spawnSync('python3', ['-c', FLOCK_PY], {
		stdio: ['ignore', 'ignore', 'pipe', fd],
		encoding: 'utf8',
	})
	return { fd, acquired: result.status === 0 }
}

describe.sequential('plugin ledger flock (L1/L2/L3)', () => {
	test('L1 unlink-while-held lets a second open+flock succeed (kernel danger)', () => {
		const dir = makeTemp('herdweb-l1-danger-')
		const lockPath = join(dir, 'herdweb.lock')
		writeFileSync(lockPath, '')
		const first = tryFlock(lockPath)
		expect(first.acquired).toBe(true)
		const oldIno = fstatSync(first.fd).ino
		unlinkSync(lockPath)
		const second = tryFlock(lockPath)
		expect(second.acquired).toBe(true)
		expect(fstatSync(second.fd).ino).not.toBe(oldIno)
		closeSync(first.fd)
		closeSync(second.fd)
	})

	test('L1 serve.mjs never unlinks the lock; a second process cannot acquire it', async () => {
		const source = readFileSync(serveScript, 'utf8')
		expect(source).toContain('herdweb.lock')
		expect(source).not.toMatch(/unlink\w*\s*\([^)]*lock/i)
		expect(source).toMatch(/never unlinked|永不 unlink|held until this process exits/)

		const stateDir = makeTemp('herdweb-l1-state-')
		const configDir = makeTemp('herdweb-l1-config-')
		const pluginRoot = makeTemp('herdweb-l1-root-')
		writeStub(pluginRoot)
		const port = await allocPort(0)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		const holder = spawnServe(env)
		const owner = await waitForOwner(stateDir)
		expect(owner.pid).toBe(holder.pid)
		expect(existsSync(join(stateDir, 'herdweb.lock'))).toBe(true)

		const second = await waitExit(spawnServe(env))
		expect(second.code).toBe(2)
		expect(second.output).toMatch(/^LOCK_HELD /m)
		expect(existsSync(join(stateDir, 'herdweb.lock'))).toBe(true)
		expect(readFileSync(join(stateDir, 'herdweb.owner.json'), 'utf8')).toContain(String(owner.pid))
	})

	test('L2 SIGKILL releases the lock and the successor overwrites owner.json', async () => {
		const stateDir = makeTemp('herdweb-l2-state-')
		const configDir = makeTemp('herdweb-l2-config-')
		const pluginRoot = makeTemp('herdweb-l2-root-')
		writeStub(pluginRoot)
		const port = await allocPort(1)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		const first = spawnServe(env)
		const owner1 = await waitForOwner(stateDir)
		expect(first.pid).toBe(owner1.pid)
		if (first.pid === undefined) throw new Error('holder pid missing')
		process.kill(first.pid, 'SIGKILL')
		await waitExit(first).catch(() => undefined)
		await sleep(150)

		const second = spawnServe(env)
		if (second.pid === undefined) throw new Error('successor pid missing')
		const owner2 = await waitForOwnerPid(stateDir, second.pid)
		expect(owner2.pid).toBe(second.pid)
		expect(owner2.pid).not.toBe(owner1.pid)
		expect(owner2.port).toBe(port)
		expect(owner2.mode).toBe('pane')
	})

	test('L3 LOCK_HELD and PORT_OCCUPIED are distinct exit codes and prefixes', async () => {
		const pluginRoot = makeTemp('herdweb-l3-root-')
		writeStub(pluginRoot)

		const lockState = makeTemp('herdweb-l3-lock-state-')
		const lockConfig = makeTemp('herdweb-l3-lock-config-')
		const lockPort = await allocPort(2)
		const lockEnv = serveEnv(lockState, lockConfig, pluginRoot, lockPort)
		const holder = spawnServe(lockEnv)
		await waitForOwner(lockState)
		const locked = await waitExit(spawnServe(lockEnv))
		expect(locked.code).toBe(2)
		expect(locked.output).toMatch(/^LOCK_HELD /m)
		expect(locked.output).not.toMatch(/PORT_OCCUPIED/)

		const occState = makeTemp('herdweb-l3-occ-state-')
		const occConfig = makeTemp('herdweb-l3-occ-config-')
		const occPort = await allocPort(3)
		const occupant = createServer()
		await new Promise<void>((resolve, reject) => {
			occupant.once('error', reject)
			occupant.listen(occPort, '127.0.0.1', () => resolve())
		})
		try {
			const occupied = await waitExit(
				spawnServe(serveEnv(occState, occConfig, pluginRoot, occPort)),
			)
			expect(occupied.code).toBe(3)
			expect(occupied.output).toMatch(/^PORT_OCCUPIED port=/m)
			expect(occupied.output).toMatch(/got the lock; occupant is not this ledger/)
			expect(occupied.output).not.toMatch(/LOCK_HELD/)
			expect(occupied.code).not.toBe(locked.code)
		} finally {
			await new Promise<void>((resolve) => occupant.close(() => resolve()))
		}

		expect(holder.exitCode).toBeNull()
	})
})
