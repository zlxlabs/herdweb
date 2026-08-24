import { basename } from 'node:path'
import type { TargetMode } from '../types'
import type { NotifyEvent } from './events'
import type { LastSessionEntry } from './state'

const RESTART_ANNOUNCE_GAP_MS = 120_000

/** Parse herdr --session from post-`--` argv; otherwise return `default`. */
export function extractSessionKey(command: readonly string[] | undefined): string {
	if (command === undefined || command.length === 0) {
		return 'default'
	}

	const dashDash = command.indexOf('--')
	const argv = dashDash >= 0 ? command.slice(dashDash + 1) : command
	if (argv.length === 0) {
		return 'default'
	}

	const program = basename(argv[0] ?? '')
	if (program !== 'herdr') {
		return 'default'
	}

	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === '--session') {
			const value = argv[i + 1]
			if (value !== undefined && !value.startsWith('-')) {
				return value
			}
			return 'default'
		}
		if (arg.startsWith('--session=')) {
			const value = arg.slice('--session='.length)
			return value.length > 0 ? value : 'default'
		}
	}

	return 'default'
}

export function shouldAnnounceRestart(
	prev: LastSessionEntry | undefined,
	currentSessionId: string,
	now: number,
): boolean {
	if (prev === undefined) return false
	if (prev.sessionId === currentSessionId) return false
	return now - prev.exitedAt > RESTART_ANNOUNCE_GAP_MS
}

export function formatExitReason(exitCode: number, signal: number | null): string {
	if (signal !== null) {
		return `signal ${signal}`
	}
	return `exit ${exitCode}`
}

function eventIdentity(targetMode: TargetMode | undefined, targetId: string | undefined) {
	if (targetMode === 'explicit') {
		if (targetId === undefined) throw new Error('explicit notify event requires targetId')
		return { v: 2 as const, targetId }
	}
	return { v: 1 as const }
}

export function buildSessionEndEvent(deps: {
	readonly sessionKey: string
	readonly startTime: number
	readonly exitCode: number
	readonly signal: number | null
	readonly ts: number
	readonly targetMode?: TargetMode
	readonly targetId?: string
}): NotifyEvent {
	return {
		...eventIdentity(deps.targetMode, deps.targetId),
		id: `health:${deps.sessionKey}:${deps.startTime}`,
		kind: 'health',
		session: deps.sessionKey,
		title: `herdweb · ${deps.sessionKey} 会话结束`,
		reason: formatExitReason(deps.exitCode, deps.signal),
		ts: deps.ts,
	}
}

export function buildRestartEvent(deps: {
	readonly sessionKey: string
	readonly startTime: number
	readonly ts: number
	readonly targetMode?: TargetMode
	readonly targetId?: string
}): NotifyEvent {
	return {
		...eventIdentity(deps.targetMode, deps.targetId),
		id: `health:${deps.sessionKey}:${deps.startTime}`,
		kind: 'health',
		session: deps.sessionKey,
		title: `herdweb · ${deps.sessionKey} 服务已重启`,
		ts: deps.ts,
	}
}
