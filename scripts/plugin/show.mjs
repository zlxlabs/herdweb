#!/usr/bin/env node
/**
 * Popup: addresses plus real listen state. owner.json is a clue, not proof.
 * QR codes are intentionally not implemented.
 */
import { createConnection } from 'node:net'
import { networkInterfaces } from 'node:os'
import { invokedAsMain, ownerIsTrusted, readOwner } from './owner.mjs'

const NO_RECORD = '当前没有本 plugin 记录的 herdweb 在跑'
const LISTENING = '当前正在监听'
const NOT_LISTENING = '未监听'

export function parsePort(raw) {
	const port = Number(raw)
	if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
	return port
}

export function probeTcp(host, port, timeoutMs = 400) {
	return new Promise((resolveListen) => {
		const socket = createConnection({ host, port })
		let settled = false
		const settle = (ok) => {
			if (settled) return
			settled = true
			socket.destroy()
			resolveListen(ok)
		}
		socket.once('connect', () => settle(true))
		socket.once('error', () => settle(false))
		setTimeout(() => settle(false), timeoutMs)
	})
}

export function listLanIpv4() {
	const out = []
	for (const addrs of Object.values(networkInterfaces())) {
		for (const addr of addrs ?? []) {
			const family = addr.family
			if ((family === 'IPv4' || family === 4) && !addr.internal) out.push(addr.address)
		}
	}
	return [...new Set(out)]
}

function startHint() {
	const id = process.env.HERDR_PLUGIN_ID || 'zlxlabs.herdweb'
	return `启动：herdr plugin action invoke ${id}.start`
}

export async function collectListen(port, probe = probeTcp) {
	const lans = []
	for (const address of listLanIpv4()) {
		lans.push({ address, listening: await probe(address, port) })
	}
	return { loopback: await probe('127.0.0.1', port), lans }
}

export function formatShow({ trusted, owner, listen }) {
	if (!trusted || !owner) return `${NO_RECORD}\n${startHint()}`
	const port = parsePort(owner.port)
	if (port === undefined) return `${NO_RECORD}（owner.json 没有有效端口，不会猜测）\n${startHint()}`
	const loop = listen?.loopback === true
	const lines = [
		'herdweb 地址（监听状态以实际连接为准）',
		`本机     ${`http://127.0.0.1:${port}`.padEnd(32)}← ${loop ? LISTENING : NOT_LISTENING}`,
	]
	const lans = listen?.lans ?? []
	if (lans.length === 0) lines.push('局域网   （没有非回环 IPv4）')
	for (const lan of lans) {
		let mark = NOT_LISTENING
		if (lan.listening) mark = LISTENING
		else if (loop) mark = `${NOT_LISTENING}（herdweb 只绑了 127.0.0.1）`
		lines.push(`局域网   ${`http://${lan.address}:${port}`.padEnd(32)}← ${mark}`)
	}
	return lines.join('\n')
}

export async function runShow({ stateDir, probe = probeTcp } = {}) {
	try {
		if (!stateDir) return `${NO_RECORD}\n${startHint()}`
		const owner = readOwner(stateDir)
		const trusted = ownerIsTrusted(owner)
		if (!trusted || !owner) return formatShow({ trusted: false, owner })
		const port = parsePort(owner.port)
		if (port === undefined) return formatShow({ trusted: true, owner })
		return formatShow({ trusted: true, owner, listen: await collectListen(port, probe) })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return `${NO_RECORD}（读取失败：${message}）\n${startHint()}`
	}
}

if (invokedAsMain(import.meta.url)) {
	runShow({ stateDir: process.env.HERDR_PLUGIN_STATE_DIR }).then((text) => console.log(text))
}
