#!/usr/bin/env node
/**
 * Manifest build step 1: fail fast with a short, specific message.
 * Output is capped at 10 lines so herdr truncation still shows the cause.
 */
import { spawnSync } from 'node:child_process'

const MIN_NODE_MAJOR = 22
const INSTALL_HINTS = [
	'Debian/Ubuntu:  sudo apt install python3 make g++',
	'Fedora:         sudo dnf install python3 make gcc-c++',
	'Arch:           sudo pacman -S python make gcc',
	'Alpine:         sudo apk add python3 make g++',
]

function canRun(cmd) {
	const result = spawnSync(cmd, ['--version'], {
		encoding: 'utf8',
		timeout: 8_000,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	return result.status === 0
}

function nodeMajor() {
	const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
	return Number.isInteger(major) ? major : 0
}

function missingToolchain() {
	const missing = []
	if (!canRun('python3')) missing.push('python3')
	if (!canRun('make')) missing.push('make')
	if (!(canRun('c++') || canRun('g++'))) missing.push('g++')
	return missing
}

function printAndFail(lines) {
	const capped = lines.filter((line) => line !== undefined).slice(0, 10)
	for (const line of capped) console.error(line)
	process.exit(1)
}

const major = nodeMajor()
const nodeTooOld = major < MIN_NODE_MAJOR
const checkToolchain = process.platform === 'linux'
const missing = checkToolchain ? missingToolchain() : []

if (!nodeTooOld && missing.length === 0) {
	const extra = checkToolchain ? ', linux toolchain present' : ''
	console.log(`herdweb plugin prerequisites ok (node v${process.versions.node}${extra})`)
	process.exit(0)
}

const lines = []
if (nodeTooOld && missing.length === 0) {
	lines.push(
		`herdweb plugin 需要 Node.js >= ${MIN_NODE_MAJOR}（当前: v${process.versions.node}）。`,
	)
	lines.push('请升级 Node 后重跑：herdr plugin install zlxlabs/herdweb')
} else {
	if (nodeTooOld) {
		lines.push(
			`herdweb 需要 Node.js >= ${MIN_NODE_MAJOR}（当前: v${process.versions.node}）以及 Linux 本地编译 node-pty 的工具链。`,
		)
	} else {
		lines.push('herdweb 在 Linux 上需要本地编译 node-pty（npm 包不带 Linux 预编译）。')
	}
	const items = [...(nodeTooOld ? [`node>=${MIN_NODE_MAJOR}`] : []), ...missing]
	lines.push(`缺少：${items.join(', ')}`)
	lines.push('')
	lines.push(...INSTALL_HINTS)
	lines.push('')
	if (!nodeTooOld) lines.push('macOS 不需要这些（包内已有预编译）。')
	lines.push('装好后重跑：herdr plugin install zlxlabs/herdweb')
}

printAndFail(lines)
