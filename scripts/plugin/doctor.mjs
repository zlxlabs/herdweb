#!/usr/bin/env node
/** Environment facts only. One check failing must not hide the rest. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { invokedAsMain, ownerIsTrusted, readOwner } from './owner.mjs'
import { listLanIpv4, parsePort, probeTcp } from './show.mjs'

const PLUGIN_UNIT = 'herdweb-plugin.service'
const PWA_PATHS = [
	'/manifest.json',
	'/sw.js',
	'/icon-192.png',
	'/icon-512.png',
	'/apple-touch-icon.png',
]
const SKILL = '让你的 agent 读 .agents/skills/herdweb-setup/SKILL.md'
const UNIT_PROPS = 'ActiveState,ExecMainStatus,FragmentPath,ExecStart,WorkingDirectory,LoadState'

function sh(bin, args) {
	return spawnSync(bin, args, {
		encoding: 'utf8',
		timeout: 8_000,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
}

function errText(error) {
	return error instanceof Error ? error.message : String(error)
}

async function safe(label, fn) {
	try {
		return await fn()
	} catch (error) {
		return `${label}: 检查失败（${errText(error)}）`
	}
}

export function isStaleService({ execStartMissing, execMainStatus }) {
	return Boolean(execStartMissing) || Number(execMainStatus) === 203
}

export function classifyPwaResponse(path, status, contentType, location, requestHost) {
	const kind = path.endsWith('.json') ? 'json' : path.endsWith('.js') ? 'js' : 'image'
	const t = (contentType ?? '').toLowerCase()
	const typeOk =
		kind === 'json'
			? t.includes('json')
			: kind === 'js'
				? t.includes('javascript')
				: t.startsWith('image/')
	let locationHost = ''
	if (location) {
		try {
			locationHost = new URL(location, `http://${requestHost}`).hostname
		} catch {
			locationHost = location
		}
	}
	if (status >= 300 && status < 400) {
		return {
			verdict: locationHost && locationHost !== requestHost ? 'login-redirect' : 'redirect',
			evidence: `${status} ${contentType || '-'} Location: ${locationHost || location || '-'}`,
		}
	}
	return {
		verdict: status === 200 && typeOk ? 'ok' : 'unexpected',
		evidence: `${status} ${contentType || '-'}`,
	}
}

export async function fetchPwaPath(baseUrl, path, fetchImpl = fetch) {
	const url = new URL(path, baseUrl)
	const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
	return classifyPwaResponse(
		path,
		res.status,
		res.headers.get('content-type') ?? '',
		res.headers.get('location') ?? '',
		url.hostname,
	)
}

function execStartPathMissing(execStart, workingDirectory) {
	if (!execStart) return false
	const cleaned = execStart.replace(/^\{|\}$/g, '')
	const pathMatch = cleaned.match(/path=([^ ;]+)/)
	const argvMatch = cleaned.match(/argv\[\]=([^;]+)/)
	const tokens = (argvMatch?.[1] ?? cleaned).trim().split(/\s+/).filter(Boolean)
	const bin = pathMatch?.[1] || tokens[0]
	if (bin && !existsSync(bin)) return true
	const script = tokens.find((tok) => tok.endsWith('.mjs'))
	if (!script) return false
	const resolved = script.startsWith('/') ? script : join(workingDirectory || '', script)
	return !existsSync(resolved)
}

function lingerStatus() {
	let user = process.env.USER
	try {
		user = user || userInfo().username
	} catch {
		return '无法判定'
	}
	const out = sh('loginctl', ['show-user', user, '-p', 'Linger']).stdout || ''
	if (/Linger=yes/i.test(out)) return 'yes'
	if (/Linger=no/i.test(out)) return 'no'
	return '无法判定'
}

function noneMode(detail, extra) {
	return {
		lines: ['[模式 / 账本]', `模式: none（${detail}）`, extra],
		listening: false,
		mode: 'none',
		trusted: false,
		port: undefined,
	}
}

async function sectionMode(stateDir) {
	if (!stateDir) return noneMode('HERDR_PLUGIN_STATE_DIR 未设置', '锁持有者: 无记录')
	const owner = readOwner(stateDir)
	if (!owner)
		return noneMode(
			'没有 owner.json 或内容损坏',
			'锁持有者: 无记录；不会把缺失账本当成 herdweb 在跑',
		)
	if (!ownerIsTrusted(owner)) {
		return noneMode(
			`owner.json 不可信 pid=${owner.pid ?? '?'}，不视为还在跑`,
			'锁持有者: 元数据不可信（pid 已死或 starttime 不匹配）',
		)
	}
	const mode = owner.mode === 'service' || owner.mode === 'pane' ? owner.mode : 'none'
	const port = parsePort(owner.port)
	const lines = [
		'[模式 / 账本]',
		`模式: ${mode}`,
		`锁持有者: pid=${owner.pid}（可信） port=${port ?? '无有效端口'}`,
	]
	if (port === undefined) {
		lines.push('实际监听: 无有效端口，不猜测、不扫端口')
		return { lines, listening: false, mode, trusted: true, port: undefined }
	}
	const loopback = await probeTcp('127.0.0.1', port)
	lines.push(`本机 127.0.0.1:${port} ${loopback ? '在监听' : '未监听'}`)
	const lans = listLanIpv4()
	if (lans.length === 0) lines.push('局域网: 没有非回环 IPv4')
	for (const address of lans) {
		lines.push(`局域网 ${address}:${port} ${(await probeTcp(address, port)) ? '在监听' : '未监听'}`)
	}
	return { lines, listening: loopback, mode, trusted: true, port }
}

function sectionTmpfs(stateDir) {
	if (!stateDir) return '[STATE_DIR] HERDR_PLUGIN_STATE_DIR 未设置，无法判定是否 tmpfs'
	const mounted = sh('findmnt', ['-no', 'FSTYPE', '-T', stateDir])
	const type = mounted.status === 0 ? mounted.stdout.trim() : ''
	if (!type) return `[STATE_DIR] ${stateDir} 文件系统: 无法判定`
	const warn = type === 'tmpfs' ? '（tmpfs：锁文件可能被周期性清空）' : ''
	return `[STATE_DIR] ${stateDir} 文件系统: ${type}${warn}`
}

function sectionService() {
	const unitDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd/user')
	const unitPath = join(unitDir, PLUGIN_UNIT)
	const lines = [
		'[service]',
		`搜索目录 unit: ${existsSync(unitPath) ? `在 ${unitPath}` : `不在 ${unitDir}`}`,
		`linger: ${lingerStatus()}`,
	]
	const show = sh('systemctl', ['--user', 'show', PLUGIN_UNIT, '-p', UNIT_PROPS])
	if (show.status !== 0) {
		lines.push('systemctl show: 无法判定', 'stale: 无法判定')
		return { lines, unitActive: false }
	}
	const fields = {}
	for (const line of show.stdout.split('\n')) {
		const eq = line.indexOf('=')
		if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1).trim()
	}
	const stale = isStaleService({
		execStartMissing: execStartPathMissing(fields.ExecStart, fields.WorkingDirectory),
		execMainStatus: fields.ExecMainStatus,
	})
	lines.push(
		`LoadState=${fields.LoadState || '?'} ActiveState=${fields.ActiveState || '?'} ExecMainStatus=${fields.ExecMainStatus ?? '-'}`,
	)
	lines.push(
		stale
			? 'stale: 是（ExecStart 路径不存在或 ExecMainStatus=203）'
			: 'stale: 否（不只看 Active=failed）',
	)
	return { lines, unitActive: fields.ActiveState === 'active' }
}

function sectionToolchain() {
	const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
	const nodeOk = Number.isInteger(major) && major >= 22
	const python3 = sh('python3', ['--version']).status === 0
	const perl = sh('perl', ['--version']).status === 0
	const make = sh('make', ['--version']).status === 0
	const cxx = sh('c++', ['--version']).status === 0 || sh('g++', ['--version']).status === 0
	return [
		'[依赖]',
		`运行期: Node ${process.versions.node} ${nodeOk ? 'ok' : '需要 >= 22'}；flock python3=${python3 ? 'ok' : 'no'} perl=${perl ? 'ok' : 'no'}（二者之一即可）`,
		`构建期(Linux node-pty): python3=${python3 ? 'ok' : 'no'} make=${make ? 'ok' : 'no'} c++=${cxx ? 'ok' : 'no'}`,
	]
}

async function sectionPwa(listening, port) {
	if (!listening || port === undefined) return ['[PWA] 跳过：当前没有监听中的 herdweb']
	const baseUrl = `http://127.0.0.1:${port}`
	const lines = [`[PWA] ${baseUrl}`]
	for (const path of PWA_PATHS) {
		try {
			const result = await fetchPwaPath(baseUrl, path)
			const tag = { ok: '正常', 'login-redirect': '登录页重定向' }[result.verdict] ?? result.verdict
			lines.push(`${path}  ${tag}  ${result.evidence}`)
		} catch (error) {
			lines.push(`${path}  检查失败（${errText(error)}）`)
		}
	}
	return lines
}

function linesOf(value) {
	if (Array.isArray(value)) return value
	if (value && typeof value === 'object' && Array.isArray(value.lines)) return value.lines
	return [value]
}

export async function runDoctor({ stateDir } = {}) {
	const chunks = []
	const modeResult = await safe('[模式 / 账本]', () => sectionMode(stateDir))
	chunks.push(...linesOf(modeResult))
	const facts =
		modeResult && typeof modeResult === 'object' && !Array.isArray(modeResult)
			? modeResult
			: { listening: false, mode: 'none', trusted: false, port: undefined }
	chunks.push(await safe('[STATE_DIR]', () => sectionTmpfs(stateDir)))
	const serviceResult = await safe('[service]', () => sectionService())
	chunks.push(...linesOf(serviceResult))
	const unitActive = Boolean(
		serviceResult && typeof serviceResult === 'object' && serviceResult.unitActive,
	)
	chunks.push(...linesOf(await safe('[依赖]', () => sectionToolchain())))
	chunks.push(...linesOf(await safe('[PWA]', () => sectionPwa(facts.listening, facts.port))))
	const orphan =
		(facts.mode === 'service' && facts.trusted && facts.listening) || unitActive
			? '[卸载] service 仍在跑：卸载 plugin 前请先停掉，否则会留下占端口的孤儿进程'
			: '[卸载] 当前没有检测到仍在跑的 plugin service'
	chunks.push(await safe('[卸载]', () => orphan), '', SKILL)
	return chunks.join('\n')
}

if (invokedAsMain(import.meta.url)) {
	runDoctor({ stateDir: process.env.HERDR_PLUGIN_STATE_DIR }).then((text) => console.log(text))
}
