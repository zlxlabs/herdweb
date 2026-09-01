/**
 * Owner ledger read + trust. Copied from serve.mjs with no behaviour change.
 * Linux: /proc/<pid>/stat field 22. macOS: kill -0 + ps -p PID -o lstart=.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const OWNER_NAME = 'herdweb.owner.json'

export function processStarttime(pid) {
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

export function readOwner(stateDir) {
	try {
		const parsed = JSON.parse(readFileSync(join(stateDir, OWNER_NAME), 'utf8'))
		return parsed && typeof parsed === 'object' ? parsed : undefined
	} catch {
		return undefined
	}
}

export function ownerIsTrusted(owner) {
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

/** CLI entry vs import. Uses realpath so a symlink argv still matches import.meta.url. */
export function invokedAsMain(importMetaUrl) {
	const entry = process.argv[1]
	if (!entry) return false
	return pathToFileURL(realpathSync(entry)).href === importMetaUrl
}
