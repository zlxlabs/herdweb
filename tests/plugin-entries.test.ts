// @vitest-environment node

import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const repo = join(import.meta.dirname, '..')
const plug = (name: string) => join(repo, 'scripts/plugin', name)
const tempDirs: string[] = []
const servers: Array<{ close: () => Promise<void> }> = []

function makeTemp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempDirs.push(dir)
	return dir
}

async function allocPort(offset: number): Promise<number> {
	const base = 17820 + (process.pid % 30) + offset
	for (let port = base; port < 17900; port++) {
		const free = await new Promise<boolean>((resolve) => {
			const server = createNetServer()
			server.once('error', () => resolve(false))
			server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
		})
		if (free) return port
	}
	throw new Error('no free port in 17820-17899')
}

function loadPlugin(name: string) {
	return import(pathToFileURL(plug(name)).href)
}

function runScript(script: string, env: NodeJS.ProcessEnv) {
	const result = spawnSync(process.execPath, [script], {
		env: { ...process.env, ...env },
		encoding: 'utf8',
		timeout: 15_000,
	})
	return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function writeTrustedOwner(stateDir: string, port: number): Promise<void> {
	const { processStarttime } = await loadPlugin('owner.mjs')
	writeFileSync(
		join(stateDir, 'herdweb.owner.json'),
		`${JSON.stringify({
			pid: process.pid,
			starttime: processStarttime(process.pid),
			mode: 'pane',
			port,
			config_path: '/tmp/x',
			started_at: '2026-09-01T00:00:00Z',
		})}\n`,
	)
}

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close().catch(() => undefined)
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('plugin info entries', () => {
	test('show reports 未监听 when owner.json has a port but nothing listens', async () => {
		const stateDir = makeTemp('herdweb-show-nolisten-')
		const port = await allocPort(0)
		await writeTrustedOwner(stateDir, port)
		const result = runScript(plug('show.mjs'), { HERDR_PLUGIN_STATE_DIR: stateDir })
		expect(result.status).toBe(0)
		expect(result.stdout).toMatch(/未监听/)
		expect(result.stdout).not.toMatch(/当前正在监听/)
		expect(result.stdout).toContain(String(port))
		expect(result.stdout).not.toContain('7681')
	})

	test('show and doctor survive missing, corrupt, and dead-pid owner.json', async () => {
		const missing = makeTemp('herdweb-entries-missing-')
		const corrupt = makeTemp('herdweb-entries-corrupt-')
		const dead = makeTemp('herdweb-entries-dead-')
		writeFileSync(join(corrupt, 'herdweb.owner.json'), '{not-json')
		let pid = 2_000_000
		while (pid < 2_000_400) {
			try {
				process.kill(pid, 0)
				pid += 1
			} catch {
				break
			}
		}
		writeFileSync(
			join(dead, 'herdweb.owner.json'),
			`${JSON.stringify({ pid, starttime: '1', mode: 'pane', port: await allocPort(1), config_path: '/tmp/x', started_at: '2026-09-01T00:00:00Z' })}\n`,
		)
		let deadDoctor = ''
		for (const stateDir of [missing, corrupt, dead]) {
			const show = runScript(plug('show.mjs'), { HERDR_PLUGIN_STATE_DIR: stateDir })
			const doctor = runScript(plug('doctor.mjs'), { HERDR_PLUGIN_STATE_DIR: stateDir })
			expect(show.status, show.stderr).toBe(0)
			expect(doctor.status, doctor.stderr).toBe(0)
			expect(show.stdout).toMatch(/当前没有本 plugin 记录的 herdweb 在跑/)
			expect(show.stdout).not.toMatch(/当前正在监听/)
			expect(doctor.stdout).toMatch(/none/)
			expect(doctor.stdout).not.toMatch(/锁持有者: pid=\d+（可信）/)
			expect(doctor.stdout).not.toMatch(/模式: pane/)
			expect(doctor.stdout).toContain('herdweb-setup/SKILL.md')
			if (stateDir === dead) deadDoctor = doctor.stdout
		}
		expect(deadDoctor).toMatch(/不可信/)
		expect(deadDoctor).toContain(`pid=${pid}`)
		expect(deadDoctor).toContain('不视为还在跑')
	})

	test('stale is ExecStart missing or ExecMainStatus 203, not Active=failed', async () => {
		const { isStaleService } = await loadPlugin('doctor.mjs')
		expect(isStaleService({ execStartMissing: true, execMainStatus: 0 })).toBe(true)
		expect(isStaleService({ execStartMissing: false, execMainStatus: 203 })).toBe(true)
		expect(isStaleService({ execStartMissing: false, execMainStatus: 1 })).toBe(false)
		expect(isStaleService({ execStartMissing: false, execMainStatus: '1' })).toBe(false)
	})

	test('install-service unit text snapshots env, absolute ExecStart, reset-failed', async () => {
		const toml = readFileSync(join(repo, 'herdr-plugin.toml'), 'utf8')
		for (const quoted of toml.matchAll(/"scripts\/plugin\/[^"]+\.mjs"/g)) {
			expect(existsSync(join(repo, quoted[0].slice(1, -1))), quoted[0]).toBe(true)
		}
		expect(toml).toContain('id = "show"')
		expect(toml).toContain('id = "doctor"')
		expect(toml).toContain('id = "install-service"')
		expect(existsSync(join(repo, 'systemd/herdweb.service'))).toBe(true)
		expect(existsSync(join(repo, 'systemd/herdweb-debug.service'))).toBe(true)
		const xdg = makeTemp('herdweb-install-xdg-')
		const configDir = makeTemp('herdweb-install-config-')
		const stateDir = makeTemp('herdweb-install-state-')
		const env = {
			XDG_CONFIG_HOME: xdg,
			HERDR_PLUGIN_CONFIG_DIR: configDir,
			HERDR_PLUGIN_STATE_DIR: stateDir,
			HERDR_PLUGIN_ROOT: repo,
		}
		const existing = join(xdg, 'systemd/user/herdweb-plugin.service')
		expect(runScript(plug('install-service.mjs'), env).status).toBe(0)
		writeFileSync(existing, '[Unit]\nDescription=user-edited\n')
		const second = runScript(plug('install-service.mjs'), env)
		expect(second.stdout).toMatch(/将被覆盖/)
		const unit = readFileSync(existing, 'utf8')
		expect(unit).toContain(`Environment=HERDR_PLUGIN_CONFIG_DIR=${configDir}`)
		expect(unit).toContain(`Environment=HERDR_PLUGIN_STATE_DIR=${stateDir}`)
		expect(unit).toContain(`Environment=HERDR_PLUGIN_ROOT=${repo}`)
		expect(unit).toMatch(/^ExecStart=\//m)
		expect(unit).toContain('scripts/plugin/serve.mjs')
		expect(second.stdout).toContain('reset-failed')
		expect(second.stdout).toMatch(/1\.1s/)
		expect(second.stdout).toContain('herdweb-plugin.service')
		expect(second.stdout).not.toMatch(/enable --now herdweb\.service/)
		expect(readFileSync(plug('install-service.mjs'), 'utf8')).not.toMatch(
			/spawn(Sync)?\(\s*['"]systemctl/,
		)
		const { UNIT_NAME, renderLaunchdPlist } = await loadPlugin('install-service.mjs')
		expect(UNIT_NAME).toBe('herdweb-plugin.service')
		const plist = renderLaunchdPlist({
			nodePath: '/usr/bin/node',
			pluginRoot: repo,
			configDir,
			stateDir,
		})
		expect(plist).toContain('HERDR_PLUGIN_CONFIG_DIR')
		expect(plist).toContain('HERDR_PLUGIN_STATE_DIR')
		expect(plist).toContain('HERDR_PLUGIN_ROOT')
		expect(plist).toContain('/usr/bin/node')
	})

	test('PWA probe treats JSON/icon as ok and 302 login as the opposite', async () => {
		const port = await allocPort(2)
		const server = createServer((req, res) => {
			if (req.url === '/manifest.json') {
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end('{"name":"herdweb"}')
				return
			}
			if (req.url === '/icon-192.png') {
				res.writeHead(302, {
					location: 'https://login.cloudflareaccess.com/cdn-cgi/access/login',
				})
				res.end()
				return
			}
			res.writeHead(404)
			res.end()
		})
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(port, '127.0.0.1', () => resolve())
		})
		servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) })
		const { fetchPwaPath } = await loadPlugin('doctor.mjs')
		const base = `http://127.0.0.1:${port}`
		const json = await fetchPwaPath(base, '/manifest.json')
		const login = await fetchPwaPath(base, '/icon-192.png')
		expect(json.verdict).toBe('ok')
		expect(login.verdict).toBe('login-redirect')
		expect(json.evidence).toMatch(/200/)
		expect(login.evidence).toMatch(/302/)
		expect(login.evidence).toContain('login.cloudflareaccess.com')
		expect(json.verdict).not.toBe(login.verdict)
	})

	test('symlink path and direct path behave the same for serve and show', () => {
		const linkDir = makeTemp('plugin-sym-')
		const link = join(linkDir, 'plugin')
		symlinkSync(join(repo, 'scripts/plugin'), link)
		const missing = {
			HERDR_PLUGIN_STATE_DIR: '',
			HERDR_PLUGIN_CONFIG_DIR: '',
		}
		try {
			const directServe = runScript(plug('serve.mjs'), missing)
			const linkedServe = runScript(join(link, 'serve.mjs'), missing)
			expect(directServe.status).toBe(1)
			expect(linkedServe.status).toBe(directServe.status)
			expect(directServe.stderr).toMatch(/ERROR HERDR_PLUGIN_STATE_DIR is not set/)
			expect(linkedServe.stderr).toMatch(/ERROR HERDR_PLUGIN_STATE_DIR is not set/)
			expect(linkedServe.stdout).toBe(directServe.stdout)

			const stateDir = makeTemp('plugin-sym-show-')
			const showEnv = { HERDR_PLUGIN_STATE_DIR: stateDir }
			const directShow = runScript(plug('show.mjs'), showEnv)
			const linkedShow = runScript(join(link, 'show.mjs'), showEnv)
			expect(directShow.status).toBe(0)
			expect(linkedShow.status).toBe(directShow.status)
			expect(directShow.stdout).toMatch(/当前没有本 plugin 记录的 herdweb 在跑/)
			expect(linkedShow.stdout).toBe(directShow.stdout)
			expect(linkedShow.stdout.length).toBeGreaterThan(0)
		} finally {
			unlinkSync(link)
		}
	})
})
