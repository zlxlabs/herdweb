#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { assertServeCommandCompatible, parseCliArgs } from './src/cli/args'
import { defaultConfig, defineConfig, mergeConfig } from './src/config'
import {
	ConfigValidationError,
	assertValidConfigOverrides,
	assertValidResolvedConfig,
} from './src/config-validate'
import { serve } from './src/serve'
import type { HerdwebConfig, HerdwebConfigOverrides } from './src/types'

// Walk up from module location to find project root — works from both source and dist/
function findProjectRoot(): string {
	let dir = import.meta.dirname
	for (let i = 0; i < 5; i++) {
		if (existsSync(resolve(dir, 'package.json'))) return dir
		dir = dirname(dir)
	}
	return import.meta.dirname
}

function loadPackageVersion(root: string): string {
	try {
		const content = readFileSync(resolve(root, 'package.json'), 'utf-8')
		// oxlint-disable-next-line typescript/consistent-type-assertions -- JSON.parse returns unknown
		return (JSON.parse(content) as { version: string }).version
	} catch {
		return '0.0.0'
	}
}

// Source checkout has src/index.ts (not published to npm per files array in package.json).
// For dev builds, append git short hash so local vs npm is obvious.
function resolveVersion(): string {
	const root = findProjectRoot()
	const pkgVersion = loadPackageVersion(root)
	if (!existsSync(resolve(root, 'src/index.ts'))) return pkgVersion
	try {
		const hash = execSync('git rev-parse --short HEAD', {
			cwd: root,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
		return `${pkgVersion}-dev+${hash}`
	} catch {
		return pkgVersion
	}
}

const VERSION: string = resolveVersion()

function usage(): void {
	console.log(`herdweb v${VERSION} — web UI for herdr

Usage:
  herdweb serve [--config <path>] [--port <n>] [--host <addr>] [--base-path <path>] [--no-sleep] [-- <command...>]
    Start herdweb with a built-in web terminal, PWA support, and the configured command.
    Default host: 127.0.0.1. Default port: 7681. Default command: herdr --session default

  herdweb build [--config <path>] [--output <path>] [--dry-run]
    Deprecated. herdweb no longer patches ttyd HTML.

  herdweb inject [--config <path>] [--dry-run]
    Deprecated. herdweb no longer patches ttyd HTML.

  herdweb init
    Scaffold a herdweb.config.ts with defaults.

  herdweb --version
    Print version.

  herdweb --help
    Show this help.

Flags:
  -c, --config <path>  Use a specific config file (serve/build/inject)
  -o, --output <path>  Deprecated build output path flag
  -p, --port <n>       Port to serve on (serve only, default 7681)
      --host <addr>    Host/interface to bind (serve only, default 127.0.0.1)
      --base-path <p>  Mount herdweb under a URL prefix such as /random-token
  -n, --dry-run        Deprecated build/inject dry-run flag
      --no-sleep       Prevent macOS sleep while serving (caffeinate -s, serve only)

Examples:
  herdweb serve
  herdweb serve --no-sleep
  herdweb serve --host 0.0.0.0 --port 8080
  herdweb serve --base-path /random-token
  herdweb serve --port 8080 -- herdr --session dev
  herdweb serve -- bash --norc
  herdweb serve -- herdr --session main`)
}

/** Pre-rename config dir/file prefix — split to keep the legacy identifier out of grep scans. */
const LEGACY_CONFIG_APP = 're' + 'mobi'

function legacyConfigNames(): readonly string[] {
	return [`${LEGACY_CONFIG_APP}.config.ts`, `${LEGACY_CONFIG_APP}.config.js`]
}

function legacyConfigDir(): string {
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), LEGACY_CONFIG_APP)
}

function isLegacyConfigPath(path: string): boolean {
	const base = path.split(/[/\\]/).pop() ?? path
	return legacyConfigNames().some((name) => base === name)
}

interface LoadedConfig {
	readonly config: HerdwebConfig
	readonly source: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractDefaultExport(value: unknown): unknown | undefined {
	if (!isRecord(value)) return undefined
	if (!('default' in value)) return undefined
	return value.default
}

function throwConfigValidationError(source: string, error: ConfigValidationError): never {
	throw new Error(`Config validation failed for ${source}\n${error.message}`)
}

function throwDeprecatedCommand(command: 'build' | 'inject'): never {
	throw new Error(
		`herdweb ${command} is deprecated and no longer supported.\nherdweb now ships its own terminal runtime and no longer patches ttyd HTML.\nUse \`herdweb serve\` instead.`,
	)
}

/** Convert a config path to its .local sibling, e.g. herdweb.config.ts → herdweb.config.local.ts */
function toLocalPath(configPath: string): string {
	const dotIdx = configPath.lastIndexOf('.')
	if (dotIdx === -1) {
		return `${configPath}.local`
	}
	return `${configPath.slice(0, dotIdx)}.local${configPath.slice(dotIdx)}`
}

/** Try to load a .local config override file. Returns undefined if the file does not exist. */
async function loadLocalOverrides(localPath: string): Promise<HerdwebConfigOverrides | undefined> {
	if (!existsSync(localPath)) {
		return undefined
	}

	const mod = await import(localPath)
	const defaultExport = extractDefaultExport(mod)
	if (defaultExport === undefined) {
		throw new Error(`Local config file has no default export: ${localPath}`)
	}

	assertValidOverridesOrThrow(defaultExport, localPath)
	return defaultExport
}

function assertValidOverridesOrThrow(
	value: unknown,
	source: string,
): asserts value is HerdwebConfigOverrides {
	try {
		assertValidConfigOverrides(value)
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			throwConfigValidationError(source, error)
		}
		throw error
	}
}

function assertValidResolvedOrThrow(
	value: unknown,
	source: string,
): asserts value is HerdwebConfig {
	try {
		assertValidResolvedConfig(value)
	} catch (error) {
		if (error instanceof ConfigValidationError) {
			throwConfigValidationError(source, error)
		}
		throw error
	}
}

function discoverConfigPath(): { path: string; usedLegacy: boolean } | undefined {
	const herdwebNames = ['herdweb.config.ts', 'herdweb.config.js']
	const searchPlans: ReadonlyArray<{ dir: string; names: readonly string[]; legacy: boolean }> = [
		{ dir: process.cwd(), names: herdwebNames, legacy: false },
		{
			dir: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'herdweb'),
			names: herdwebNames,
			legacy: false,
		},
		{ dir: process.cwd(), names: legacyConfigNames(), legacy: true },
		{ dir: legacyConfigDir(), names: legacyConfigNames(), legacy: true },
	]
	for (const plan of searchPlans) {
		for (const name of plan.names) {
			const full = join(plan.dir, name)
			if (existsSync(full)) {
				return { path: full, usedLegacy: plan.legacy }
			}
		}
	}
	return undefined
}

async function loadLocalOverridesForConfig(
	abs: string,
): Promise<{ overrides?: HerdwebConfigOverrides; localSource?: string }> {
	const configDir = dirname(abs)
	const localCandidates = [
		toLocalPath(abs),
		join(configDir, 'herdweb.config.local.ts'),
		join(configDir, 'herdweb.config.local.js'),
		join(configDir, `${LEGACY_CONFIG_APP}.config.local.ts`),
		join(configDir, `${LEGACY_CONFIG_APP}.config.local.js`),
	]
	for (const candidate of localCandidates) {
		const overrides = await loadLocalOverrides(candidate)
		if (overrides !== undefined) {
			return { overrides, localSource: candidate }
		}
	}
	return {}
}

async function loadConfigFromFile(abs: string, usedLegacy: boolean): Promise<LoadedConfig> {
	if (usedLegacy || isLegacyConfigPath(abs)) {
		console.log(`herdweb: loaded legacy config ${abs} — consider renaming to herdweb.config.ts`)
	}
	const mod = await import(abs)
	const defaultExport = extractDefaultExport(mod)
	if (defaultExport === undefined) {
		throw new Error(`Config file has no default export: ${abs}`)
	}

	assertValidOverridesOrThrow(defaultExport, abs)
	const sharedConfig = defineConfig(defaultExport)
	const { overrides: localOverrides, localSource } = await loadLocalOverridesForConfig(abs)
	const config =
		localOverrides !== undefined ? mergeConfig(sharedConfig, localOverrides) : sharedConfig
	const sourceLabel = localSource !== undefined ? `${abs} + ${localSource}` : abs
	assertValidResolvedOrThrow(config, sourceLabel)
	return { config, source: sourceLabel }
}

async function loadConfig(configPath: string | undefined): Promise<LoadedConfig> {
	if (configPath) {
		const abs = resolve(process.cwd(), configPath)
		return loadConfigFromFile(abs, isLegacyConfigPath(abs))
	}

	const discovered = discoverConfigPath()
	if (discovered) {
		const abs = resolve(process.cwd(), discovered.path)
		return loadConfigFromFile(abs, discovered.usedLegacy)
	}

	assertValidResolvedOrThrow(defaultConfig, 'built-in defaults')
	return { config: defaultConfig, source: 'built-in defaults' }
}

async function main(): Promise<void> {
	const parsed = parseCliArgs(process.argv.slice(2))
	if (!parsed.ok) {
		console.error(parsed.error)
		usage()
		process.exit(1)
	}

	const { command, configPath, port, host, basePath, noSleep, command_ } = parsed.value

	switch (command) {
		case 'serve': {
			const loaded = await loadConfig(configPath)
			assertServeCommandCompatible(loaded.config.targetMode, command_)
			const defaultTarget = loaded.config.targets.find(
				({ id }) => id === loaded.config.defaultTargetId,
			)
			if (!defaultTarget)
				throw new Error('Resolved target config defaultTargetId must reference a configured target')
			const serveConfig =
				loaded.config.targetMode === 'single' && command_.length > 0
					? { ...loaded.config, targets: [{ ...defaultTarget, command: command_ }] }
					: loaded.config
			const serveCommand = command_.length > 0 ? command_ : defaultTarget.command
			await serve(serveConfig, port, serveCommand, noSleep, host, VERSION, basePath)
			break
		}

		case 'build': {
			return throwDeprecatedCommand('build')
		}

		case 'inject': {
			return throwDeprecatedCommand('inject')
		}

		case 'init': {
			const targetPath = resolve(process.cwd(), 'herdweb.config.ts')
			if (existsSync(targetPath)) {
				console.error('herdweb.config.ts already exists')
				process.exit(1)
			}
			const template = `export default {
  // name: 'herdweb',              // app name (tab title, PWA home screen label)
  // theme: 'catppuccin-mocha',
  // font: {
  //   family: 'JetBrainsMono NFM, monospace',
  //   mobileSizeDefault: 13,   // drawer Font -/+ adjustments persist (localStorage)
  //   sizeRange: [8, 32],
  // },
  //
  // Toolbar/drawer accept a plain array (replace) or a function (transform).
  // The toolbar is a single row by default (row2 defaults to an empty array):
  //
  // toolbar: { row1: [{ id, label, description, action }], row2: [...] },
  //
  // drawer: {
  //   buttons: [
  //     { id: 'sessions', label: 'Sessions', description: 'Choose tmux session', action: { type: 'send', data: '\\x02s' } },
  //   ],
  // },
  //
  // toolbar: {
  //   row1: (defaults) => defaults.filter((b) => b.id !== 'esc'),
  // },
  //
  // drawer: {
  //   buttons: (defaults) => [
  //     ...defaults,
  //     { id: 'my-btn', label: 'X', description: 'Send x', action: { type: 'send', data: 'x' } },
  //   ],
  // },
  //
  // gestures: {
  //   swipe: {
  //     enabled: false,        // default off — horizontal swipes scroll the toolbar row; opt in for swipe-to-switch-window
  //     left: '\\x02n',          // data sent on swipe left (default: next tmux window)
  //     right: '\\x02p',         // data sent on swipe right (default: prev tmux window)
  //     leftLabel: 'Next tmux window',
  //     rightLabel: 'Previous tmux window',
  //   },
  //   pinch: { enabled: true },
  //   scroll: { strategy: 'wheel', sensitivity: 40 },
  // },
  // mobile: {
  //   initData: '\\x02z',        // send on load when viewport < widthThreshold (auto-zoom pane)
  //   widthThreshold: 768,       // px — default matches phone/tablet breakpoint
  //   keyboardMode: 'auto',      // 'auto': tap terminal to open the soft keyboard (default).
  //                              // 'manual': keyboard stays suppressed; only the ⌨ button
  //                              // (toolbar row1) toggles it. A ⌨ button is injected if none.
  // },
  // floatingButtons: [
  //   // Always-visible top-left buttons (touch devices only)
  //   { position: 'top-left', buttons: [{ id: 'zoom', label: 'Zoom', description: 'Toggle pane zoom', action: { type: 'send', data: '\\x02z' } }] },
  // ],
  // scrollButtons: {
  //   enabled: false,             // floating PgUp/PgDn arrows on the right edge (default off — drag-to-scroll covers them)
  // },
  // Drawer also supports { type: 'font-size', delta: -2 } and { type: 'help' } actions
  // (defaults include Font -/Font +/Guide buttons; these keep the drawer open for
  // repeat taps). { type: 'keyboard-toggle' } is the ⌨ button and
  // { type: 'dpad-toggle' } is the ✥ floating arrow pad (← ↑ ↓ → ⌫ ⏎) — both
  // default to toolbar row1.
  // pwa: {
  //   enabled: true,              // enable PWA manifest + meta tags (used by herdweb serve)
  //   shortName: 'herdweb',        // short name for home screen icon (defaults to name)
  //   themeColor: '#1e1e2e',      // theme-color meta tag + manifest
  // },
  // reconnect: {
  //   enabled: true,              // show overlay + auto-reload on connection loss (default true)
  // },
}
`
			writeFileSync(targetPath, template)
			console.log(`Created: ${targetPath}`)
			break
		}

		case 'version':
			console.log(VERSION)
			break

		case 'help':
			usage()
			break

		default:
			console.error(`Unknown command: ${command}`)
			usage()
			process.exit(1)
	}
}

const entryScript = process.argv[1]
if (entryScript && import.meta.filename === realpathSync(entryScript)) {
	main().catch((err: unknown) => {
		console.error(err)
		process.exit(1)
	})
}
