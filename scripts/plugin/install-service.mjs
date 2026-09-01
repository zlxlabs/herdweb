#!/usr/bin/env node
/**
 * Generate a user unit / launchd plist and print commands. Never runs systemctl.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { invokedAsMain } from './owner.mjs'

export const UNIT_NAME = 'herdweb-plugin.service'
export const PLIST_LABEL = 'com.zlxlabs.herdweb-plugin'

function xml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function systemdUserDir() {
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd/user')
}

export function renderSystemdUnit({ nodePath, pluginRoot, configDir, stateDir }) {
	return `[Unit]
Description=herdweb herdr plugin companion service
Documentation=https://github.com/zlxlabs/herdweb

[Service]
Type=simple
Environment=HERDR_PLUGIN_CONFIG_DIR=${configDir}
Environment=HERDR_PLUGIN_STATE_DIR=${stateDir}
Environment=HERDR_PLUGIN_ROOT=${pluginRoot}
Environment=HERDWEB_PLUGIN_MODE=service
WorkingDirectory=${pluginRoot}
ExecStart=${nodePath} scripts/plugin/serve.mjs
Restart=on-failure
RestartSec=1

[Install]
WantedBy=default.target
`
}

export function renderLaunchdPlist({ nodePath, pluginRoot, configDir, stateDir }) {
	const serve = join(pluginRoot, 'scripts/plugin/serve.mjs')
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(PLIST_LABEL)}</string>
<key>WorkingDirectory</key><string>${xml(pluginRoot)}</string>
<key>ProgramArguments</key><array>
<string>${xml(nodePath)}</string><string>${xml(serve)}</string>
</array>
<key>EnvironmentVariables</key><dict>
<key>HERDR_PLUGIN_CONFIG_DIR</key><string>${xml(configDir)}</string>
<key>HERDR_PLUGIN_STATE_DIR</key><string>${xml(stateDir)}</string>
<key>HERDR_PLUGIN_ROOT</key><string>${xml(pluginRoot)}</string>
<key>HERDWEB_PLUGIN_MODE</key><string>service</string>
</dict>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>RunAtLoad</key><true/>
</dict></plist>
`
}

function systemdInstructions(unitPath) {
	return [
		'生成完成。本脚本不会执行 systemctl，请你自己跑：',
		'systemctl --user daemon-reload',
		`systemctl --user enable --now ${UNIT_NAME}`,
		'loginctl enable-linger "$USER"',
		'',
		'重启锁空窗：Restart=on-failure 且 RestartSec=1 期间约有 1.1s 空窗，pane 可能在窗口内抢走锁，随后 service 会持续 restart 失败。不要把 Restart 当作互斥的延续。',
		'',
		'卸载四件套：',
		`systemctl --user disable --now ${UNIT_NAME}`,
		`rm -f ${unitPath}`,
		'systemctl --user daemon-reload',
		`systemctl --user reset-failed ${UNIT_NAME}`,
	].join('\n')
}

function launchdInstructions(plistPath) {
	return [
		'生成完成。本脚本不会执行 launchctl，请你自己跑：',
		`launchctl bootstrap gui/$(id -u) ${plistPath}`,
		`launchctl enable gui/$(id -u)/${PLIST_LABEL}`,
		'',
		'重启空窗：KeepAlive 在进程退出后会再拉起，空窗里 pane 仍可能抢走锁。不要把 KeepAlive 当作互斥的延续。',
		'',
		'卸载：',
		`launchctl bootout gui/$(id -u)/${PLIST_LABEL}`,
		`rm -f ${plistPath}`,
	].join('\n')
}

export function writeGeneratedFile(target, text) {
	mkdirSync(dirname(target), { recursive: true })
	let warning = ''
	if (existsSync(target)) {
		const previous = readFileSync(target, 'utf8')
		warning =
			previous === text
				? `目标已存在且内容相同：${target}`
				: `注意：目标已存在，内容不同，将被覆盖：${target}`
	}
	writeFileSync(target, text)
	return warning
}

function requiredEnv(name) {
	const value = process.env[name]
	if (!value) throw new Error(`${name} 未设置`)
	return value
}

export function runInstallService({
	platform = process.platform,
	nodePath = process.execPath,
} = {}) {
	const pluginRoot = process.env.HERDR_PLUGIN_ROOT || process.cwd()
	const ctx = {
		nodePath,
		pluginRoot,
		configDir: requiredEnv('HERDR_PLUGIN_CONFIG_DIR'),
		stateDir: requiredEnv('HERDR_PLUGIN_STATE_DIR'),
	}
	const darwin = platform === 'darwin'
	const target = darwin
		? join(process.env.HOME || homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
		: join(systemdUserDir(), UNIT_NAME)
	const text = darwin ? renderLaunchdPlist(ctx) : renderSystemdUnit(ctx)
	const warning = writeGeneratedFile(target, text)
	const lines = [
		...(warning ? [warning] : []),
		`已写入 ${target}`,
		darwin ? launchdInstructions(target) : systemdInstructions(target),
	]
	if (darwin) lines.push('（macOS launchd 路径在本 Linux 开发机上未实测）')
	return lines.join('\n')
}

function main() {
	try {
		console.log(runInstallService())
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (invokedAsMain(import.meta.url)) main()
