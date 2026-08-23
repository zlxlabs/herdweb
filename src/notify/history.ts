import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type NotifyEvent, isNotifyKind, isRecord } from './events'

const EVENTS_FILE = 'events.jsonl'
export const HISTORY_DEFAULT_LIMIT = 50
export const HISTORY_MIN_LIMIT = 1
export const HISTORY_MAX_LIMIT = 500

/** Clamp history limit to 1..500; non-finite values fall back to default 50. */
export function clampHistoryLimit(limit: number): number {
	if (!Number.isFinite(limit)) return HISTORY_DEFAULT_LIMIT
	return Math.min(HISTORY_MAX_LIMIT, Math.max(HISTORY_MIN_LIMIT, Math.floor(limit)))
}

/** Parse `limit` query param with default 50 and clamp 1..500. */
export function parseHistoryLimitParam(raw: string | undefined): number {
	if (raw === undefined || raw.length === 0) return HISTORY_DEFAULT_LIMIT
	return clampHistoryLimit(Number(raw))
}

function isStoredEvent(value: unknown): value is NotifyEvent {
	if (!isRecord(value)) return false
	const obj = value
	return (
		obj.v === 1 &&
		isNotifyKind(obj.kind) &&
		obj.kind !== 'test' &&
		typeof obj.id === 'string' &&
		typeof obj.title === 'string' &&
		typeof obj.ts === 'number' &&
		Number.isFinite(obj.ts)
	)
}

/** Read tail events from events.jsonl, newest first. Limit is clamped to 1..500. */
export function readEventHistory(stateDir: string, limit: number): NotifyEvent[] {
	const clamped = clampHistoryLimit(limit)
	const path = join(stateDir, EVENTS_FILE)
	if (!existsSync(path)) return []

	const content = readFileSync(path, 'utf-8')
	if (content.length === 0) return []

	const lines = content.split('\n').filter((line) => line.length > 0)
	if (lines.length === 0) return []

	const tail = lines.slice(-clamped)
	const events: NotifyEvent[] = []
	for (const line of tail) {
		try {
			const parsed: unknown = JSON.parse(line)
			if (isStoredEvent(parsed)) {
				events.push(parsed)
			}
		} catch {
			// skip corrupt lines
		}
	}
	return events.reverse()
}
