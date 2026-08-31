#!/usr/bin/env node
/**
 * Plugin serve runner: flock ledger then launch herdweb.
 * Lock file is never unlinked; the fd is held until this process exits.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const LOCK_NAME = 'herdweb.lock'
const OWNER_NAME = 'herdweb.owner.json'
const CONFIG_NAME = 'herdweb.config.ts'
const DEFAULT_CONFIG = 'export default {}\n'
const FLOCK_PY =
	'import fcntl, sys\ntry:\n    fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError:\n    sys.exit(2)\n'

function fail(code, message) {
	console.error(message)
	process.exit(code)
}

function requiredDir(name) {
	const value = process.env[name]
	if (!value) fail(1, `ERROR ${name} is not set`)
	return value
}

function parsePort(raw) {
	if (raw === undefined || raw === '') return undefined
	const port = Number(raw)
	if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
	return port
}

function resolvePort() {
	const fromEnv = parsePort(process.env.HERDWEB_PLUGIN_PORT)
	if (fromEnv !== undefined) return fromEnv
	// herdweb config schema has no `port` field (strict); CLI default is src/serve.ts DEFAULT_PORT.
	return 7681
}

function processStarttime(pid) {
	if (process.platform === 'linux') {
		try {
			const text = readFileSync(`/proc/${pid}/stat`, 'utf8')
			const rest = text.slice(text.lastIndexOf(')') + 2).split(/\s+/)
			return rest[19] ?? ''
		} catch {
			return ''
		}
	}
	const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' })
	return result.status === 0 ? result.stdout.trim() : ''
}

function readOwner(stateDir) {
	try {
		const parsed = JSON.parse(readFileSync(join(stateDir, OWNER_NAME), 'utf8'))
		return parsed && typeof parsed === 'object' ? parsed : undefined
	} catch {
		return undefined
	}
}

function ownerIsTrusted(owner) {
	if (!owner || typeof owner.pid !== 'number') return false
	const recorded = String(owner.starttime ?? '')
	if (!recorded) return false
	if (process.platform === 'linux') {
		const current = processStarttime(owner.pid)
		return current !== '' && current === recorded
	}
	const alive = spawnSync('kill', ['-0', String(owner.pid)])
	if (alive.status !== 0) return false
	const lstart = processStarttime(owner.pid)
	return lstart !== '' && lstart === recorded
}

function reportLockHeld(stateDir) {
	const owner = readOwner(stateDir)
	if (ownerIsTrusted(owner)) {
		fail(2, `LOCK_HELD pid=${owner.pid} mode=${owner.mode} port=${owner.port}`)
	}
	fail(2, 'LOCK_HELD (owner metadata untrusted)')
}

function writeOwner(stateDir, payload) {
	const target = join(stateDir, OWNER_NAME)
	const tmp = `${target}.tmp`
	writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
	renameSync(tmp, target)
}

function acquireLock(stateDir) {
	try {
		mkdirSync(stateDir, { recursive: true })
	} catch (error) {
		fail(1, `ERROR cannot create state dir: ${error instanceof Error ? error.message : error}`)
	}
	const lockPath = join(stateDir, LOCK_NAME)
	let fd
	try {
		fd = openSync(lockPath, 'a+')
	} catch (error) {
		fail(1, `ERROR cannot open lock file: ${error instanceof Error ? error.message : error}`)
	}
	const result = spawnSync('python3', ['-c', FLOCK_PY], {
		stdio: ['ignore', 'ignore', 'pipe', fd],
		encoding: 'utf8',
	})
	if (result.error?.code === 'ENOENT') {
		closeSync(fd)
		fail(1, 'ERROR python3 is required to take flock')
	}
	if (result.status === 0) return fd
	closeSync(fd)
	if (result.status === 2) return undefined
	fail(1, `ERROR flock helper failed: ${result.stderr?.trim() || result.status}`)
}

function ensureConfig(configDir) {
	try {
		mkdirSync(configDir, { recursive: true })
	} catch (error) {
		fail(1, `ERROR cannot create config dir: ${error instanceof Error ? error.message : error}`)
	}
	const configPath = join(configDir, CONFIG_NAME)
	if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG)
	return resolve(configPath)
}

function isAddrInUse(text) {
	return /EADDRINUSE|already in use/i.test(text)
}

function runHerdweb(pluginRoot, configPath, port) {
	const cliPath = join(pluginRoot, 'dist', 'cli.mjs')
	if (!existsSync(cliPath)) fail(1, `ERROR missing ${cliPath}`)
	const child = spawn(
		process.execPath,
		[cliPath, 'serve', '--config', configPath, '--port', String(port)],
		{ cwd: pluginRoot, stdio: ['inherit', 'inherit', 'pipe'] },
	)
	let errText = ''
	child.stderr?.on('data', (chunk) => {
		errText += chunk.toString()
		process.stderr.write(chunk)
	})
	const onSignal = (signal) => {
		child.kill(signal)
	}
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)
	child.on('exit', (code, signal) => {
		process.off('SIGINT', onSignal)
		process.off('SIGTERM', onSignal)
		if (isAddrInUse(errText)) {
			fail(3, `PORT_OCCUPIED port=${port} (got the lock; occupant is not this ledger)`)
		}
		process.exit(signal ? 1 : (code ?? 1))
	})
}

function pluginMode() {
	return process.env.HERDWEB_PLUGIN_MODE === 'service' ? 'service' : 'pane'
}

const stateDir = requiredDir('HERDR_PLUGIN_STATE_DIR')
const configDir = requiredDir('HERDR_PLUGIN_CONFIG_DIR')
const pluginRoot = process.env.HERDR_PLUGIN_ROOT || process.cwd()
const lockFd = acquireLock(stateDir)
if (lockFd === undefined) reportLockHeld(stateDir)
const configPath = ensureConfig(configDir)
const port = resolvePort()
const pid = process.pid
writeOwner(stateDir, {
	pid,
	starttime: processStarttime(pid),
	mode: pluginMode(),
	port,
	config_path: configPath,
	started_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
})
runHerdweb(pluginRoot, configPath, port)
process.on('exit', () => {
	try {
		closeSync(lockFd)
	} catch {
		// process is exiting; fd is closed by the kernel either way
	}
})
