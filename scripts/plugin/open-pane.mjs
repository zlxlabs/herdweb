#!/usr/bin/env node
/**
 * Action → pane forwarder. Action invoke is not a visible error channel
 * (herdr always returns EXIT 0 and swallows stdout/stderr), so this script
 * only spawns the pane and does nothing else.
 */
import { spawnSync } from 'node:child_process'

const herdr = process.env.HERDR_BIN_PATH || 'herdr'
const pluginId = process.env.HERDR_PLUGIN_ID || 'zlxlabs.herdweb'
const entrypoint = process.argv[2]
const result = spawnSync(
	herdr,
	['plugin', 'pane', 'open', '--plugin', pluginId, '--entrypoint', entrypoint],
	{ stdio: 'inherit' },
)
process.exit(result.status ?? 1)
