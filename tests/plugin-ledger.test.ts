// @vitest-environment node

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
	chmodSync,
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
import { createConnection, createServer } from 'node:net'
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
const trackedPids: number[] = []
const trackedPorts: number[] = []
const tempDirs: string[] = []

function listChildren(pid: number): number[] {
	try {
		const text = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim()
		if (text === '') return []
		return text
			.split(/\s+/)
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0)
	} catch {
		const out = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
		if (out.status !== 0) return []
		const kids: number[] = []
		for (const line of out.stdout.split('\n')) {
			const parts = line.trim().split(/\s+/)
			const child = Number(parts[0])
			const ppid = Number(parts[1])
			if (ppid === pid && Number.isInteger(child) && child > 0) kids.push(child)
		}
		return kids
	}
}

function processTree(root: number): number[] {
	const out = [root]
	for (const child of listChildren(root)) out.push(...processTree(child))
	return out
}

function killTree(root: number): void {
	for (const pid of processTree(root)) {
		try {
			process.kill(pid, 'SIGKILL')
		} catch {
			// gone
		}
	}
}

function killPidsOnPort(port: number): void {
	const result = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' })
	if (result.status !== 0) return
	const needle = `:${port} `
	for (const line of result.stdout.split('\n')) {
		if (!line.includes(needle) && !line.endsWith(`:${port}`)) continue
		for (const match of line.matchAll(/pid=(\d+)/g)) {
			const pid = Number(match[1])
			if (Number.isInteger(pid) && pid > 0) killTree(pid)
		}
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

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
		setTimeout(() => settle(false), 400)
	})
}

async function waitListening(port: number, want: boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if ((await isPortListening(port)) === want) return
		await sleep(40)
	}
	throw new Error(`timed out waiting for port ${port} listening=${want}`)
}

async function waitGone(pid: number, timeoutMs = 8_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return
		await sleep(40)
	}
	throw new Error(`timed out waiting for pid ${pid} to exit`)
}

afterEach(async () => {
	const roots = [
		...children.map((child) => child.pid).filter((pid): pid is number => pid !== undefined),
		...trackedPids,
	]
	for (const pid of roots) killTree(pid)
	children.length = 0
	trackedPids.length = 0
	for (const port of trackedPorts) {
		killPidsOnPort(port)
		await waitListening(port, false, 5_000).catch(() => undefined)
	}
	trackedPorts.length = 0
	for (const dir of tempDirs) {
		try {
			chmodSync(dir, 0o755)
		} catch {
			// best-effort
		}
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
		if (free) {
			trackedPorts.push(port)
			return port
		}
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
				if (proc.pid !== undefined) killTree(proc.pid)
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

async function waitForServiceOwner(
	stateDir: string,
	runnerPid: number,
	previousStarttime?: string,
): Promise<OwnerPayload> {
	const path = join(stateDir, 'herdweb.owner.json')
	const deadline = Date.now() + 8_000
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			const owner = JSON.parse(readFileSync(path, 'utf8')) as OwnerPayload
			const isChild = owner.pid !== runnerPid
			const isFresh = previousStarttime === undefined || owner.starttime !== previousStarttime
			if (isChild && isFresh) {
				trackedPids.push(owner.pid)
				return owner
			}
		}
		await sleep(30)
	}
	throw new Error(`timed out waiting for service owner distinct from runner ${runnerPid}`)
}

function tryFlock(lockPath: string): { fd: number; acquired: boolean } {
	const fd = openSync(lockPath, 'a+')
	const result = spawnSync('python3', ['-c', FLOCK_PY], {
		stdio: ['ignore', 'ignore', 'pipe', fd],
		encoding: 'utf8',
	})
	return { fd, acquired: result.status === 0 }
}

describe.sequential('plugin ledger flock (L1/L2/L3/INV-SVC)', () => {
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
		expect(source).toMatch(/never unlinked/)

		const stateDir = makeTemp('herdweb-l1-state-')
		const configDir = makeTemp('herdweb-l1-config-')
		const pluginRoot = makeTemp('herdweb-l1-root-')
		writeStub(pluginRoot)
		const port = await allocPort(0)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		const holder = spawnServe(env)
		if (holder.pid === undefined) throw new Error('holder pid missing')
		const owner = await waitForServiceOwner(stateDir, holder.pid)
		expect(owner.pid).not.toBe(holder.pid)
		expect(existsSync(join(stateDir, 'herdweb.lock'))).toBe(true)

		const second = await waitExit(spawnServe(env))
		expect(second.code).toBe(2)
		expect(second.output).toMatch(/^LOCK_HELD /m)
		expect(existsSync(join(stateDir, 'herdweb.lock'))).toBe(true)
		expect(readFileSync(join(stateDir, 'herdweb.owner.json'), 'utf8')).toContain(String(owner.pid))
	})

	test('L2 SIGKILL of lock holders lets a successor take over the port', async () => {
		const stateDir = makeTemp('herdweb-l2-state-')
		const configDir = makeTemp('herdweb-l2-config-')
		const pluginRoot = makeTemp('herdweb-l2-root-')
		writeStub(pluginRoot)
		const port = await allocPort(1)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		const first = spawnServe(env)
		if (first.pid === undefined) throw new Error('holder pid missing')
		const owner1 = await waitForServiceOwner(stateDir, first.pid)
		await waitListening(port, true, 8_000)
		killTree(first.pid)
		await waitExit(first).catch(() => undefined)
		await waitListening(port, false, 8_000)
		await waitGone(owner1.pid, 8_000)
		expect(isAlive(owner1.pid)).toBe(false)

		const second = spawnServe(env)
		if (second.pid === undefined) throw new Error('successor pid missing')
		const owner2 = await waitForServiceOwner(stateDir, second.pid, owner1.starttime)
		await waitListening(port, true, 8_000)
		expect(owner2.starttime).not.toBe(owner1.starttime)
		expect(owner2.port).toBe(port)
		expect(owner2.mode).toBe('pane')
	})

	test('INV-SVC SIGKILL runner must not yield two live listeners', async () => {
		const stateDir = makeTemp('herdweb-invsvc-state-')
		const configDir = makeTemp('herdweb-invsvc-config-')
		const pluginRoot = makeTemp('herdweb-invsvc-root-')
		writeStub(pluginRoot)
		const port = await allocPort(2)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		const runner = spawnServe(env)
		if (runner.pid === undefined) throw new Error('runner pid missing')
		const service = await waitForServiceOwner(stateDir, runner.pid)
		await waitListening(port, true, 8_000)
		expect(isAlive(service.pid)).toBe(true)

		process.kill(runner.pid, 'SIGKILL')
		await waitExit(runner).catch(() => undefined)
		expect(isAlive(runner.pid)).toBe(false)
		expect(isAlive(service.pid)).toBe(true)
		expect(await isPortListening(port)).toBe(true)

		const successorPort = await allocPort(8)
		const successorEnv = serveEnv(stateDir, configDir, pluginRoot, successorPort)
		const successor = await waitExit(spawnServe(successorEnv))
		const successorListening = await isPortListening(successorPort)
		const oldChildListening = isAlive(service.pid) && (await isPortListening(port))
		expect(successorListening && oldChildListening).toBe(false)
		expect(successor.code).toBe(2)
		expect(successor.output).toMatch(/LOCK_HELD/)
		expect(isAlive(service.pid)).toBe(true)
		expect(await isPortListening(port)).toBe(true)
		expect(successorListening).toBe(false)
	})

	test('L3 LOCK_HELD and PORT_OCCUPIED are distinct exit codes and prefixes', async () => {
		const pluginRoot = makeTemp('herdweb-l3-root-')
		writeStub(pluginRoot)

		const lockState = makeTemp('herdweb-l3-lock-state-')
		const lockConfig = makeTemp('herdweb-l3-lock-config-')
		const lockPort = await allocPort(3)
		const lockEnv = serveEnv(lockState, lockConfig, pluginRoot, lockPort)
		const holder = spawnServe(lockEnv)
		if (holder.pid === undefined) throw new Error('holder pid missing')
		await waitForServiceOwner(lockState, holder.pid)
		const locked = await waitExit(spawnServe(lockEnv))
		expect(locked.code).toBe(2)
		expect(locked.output).toMatch(/^LOCK_HELD /m)
		expect(locked.output).not.toMatch(/PORT_OCCUPIED/)

		const occState = makeTemp('herdweb-l3-occ-state-')
		const occConfig = makeTemp('herdweb-l3-occ-config-')
		const occPort = await allocPort(4)
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

	test('P2-1 flock helper falls back to perl when python3 is unusable', async () => {
		const stateDir = makeTemp('herdweb-p21-state-')
		const configDir = makeTemp('herdweb-p21-config-')
		const pluginRoot = makeTemp('herdweb-p21-root-')
		const fakeBin = makeTemp('herdweb-p21-bin-')
		writeFileSync(join(fakeBin, 'python3'), '#!/bin/sh\nexit 127\n', { mode: 0o755 })
		writeStub(pluginRoot)
		const port = await allocPort(5)
		const env = serveEnv(stateDir, configDir, pluginRoot, port)
		env.PATH = `${fakeBin}:${process.env.PATH ?? '/usr/bin:/bin'}`
		const holder = spawnServe(env)
		if (holder.pid === undefined) throw new Error('holder pid missing')
		const owner = await waitForServiceOwner(stateDir, holder.pid)
		await waitListening(port, true, 8_000)
		expect(owner.port).toBe(port)
	})

	test('P2-2 readonly lock file can flock; readonly dir without a lock fails loud', async () => {
		const stateDir = makeTemp('herdweb-p22-state-')
		const configDir = makeTemp('herdweb-p22-config-')
		const pluginRoot = makeTemp('herdweb-p22-root-')
		writeStub(pluginRoot)
		writeFileSync(join(stateDir, 'herdweb.lock'), '')
		chmodSync(join(stateDir, 'herdweb.lock'), 0o444)
		const port = await allocPort(6)
		const holder = spawnServe(serveEnv(stateDir, configDir, pluginRoot, port))
		if (holder.pid === undefined) throw new Error('holder pid missing')
		const owner = await waitForServiceOwner(stateDir, holder.pid)
		expect(owner.port).toBe(port)

		const roDir = makeTemp('herdweb-p22-rodir-')
		chmodSync(roDir, 0o555)
		const blocked = await waitExit(
			spawnServe(serveEnv(roDir, configDir, pluginRoot, await allocPort(7))),
		)
		chmodSync(roDir, 0o755)
		expect(blocked.code).toBe(1)
		expect(blocked.output).toMatch(/^ERROR /m)
	})

	test('P2-3 illegal HERDWEB_PLUGIN_PORT fails loud instead of falling back', async () => {
		const stateDir = makeTemp('herdweb-p23-state-')
		const configDir = makeTemp('herdweb-p23-config-')
		const pluginRoot = makeTemp('herdweb-p23-root-')
		writeStub(pluginRoot)
		const env = serveEnv(stateDir, configDir, pluginRoot, 17799)
		env.HERDWEB_PLUGIN_PORT = 'not-a-port'
		const result = await waitExit(spawnServe(env))
		expect(result.code).toBe(1)
		expect(result.output).toMatch(/^ERROR invalid HERDWEB_PLUGIN_PORT/m)
		expect(result.output).not.toMatch(/7681/)
	})
})
