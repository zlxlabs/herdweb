import type { NotifyEvent } from './events'

const DEFAULT_BUSY_BYTES = 1024

export interface SilenceDetector {
	dispose(): void
}

interface SilenceDetectorDeps {
	readonly sessionKey: string
	readonly busyBytes?: number
	readonly config: {
		readonly enabled: boolean
		readonly busyMs: number
		readonly quietMs: number
		readonly cooldownMs: number
	}
	readonly bytesInWindow: (windowMs: number) => number
	readonly lastOutputAt?: () => number | undefined
	readonly dispatch: (event: NotifyEvent) => void
	readonly lastEventAt: (sessionKey: string) => number | undefined
	readonly now?: () => number
	readonly setIntervalMs?: number
}

export function createSilenceDetector(deps: SilenceDetectorDeps): SilenceDetector {
	if (!deps.config.enabled) {
		return { dispose() {} }
	}

	const now = deps.now ?? Date.now
	const busyBytes = deps.busyBytes ?? DEFAULT_BUSY_BYTES
	const tickMs = deps.setIntervalMs ?? deps.config.busyMs
	const { sessionKey, config } = deps

	let armed = false
	let quietSince: number | undefined
	let cooldownUntil: number | undefined

	const timer = setInterval(() => {
		const ts = now()
		const trailingBytes = deps.bytesInWindow(config.busyMs)

		if (trailingBytes >= busyBytes) {
			armed = true
			quietSince = undefined
			if (cooldownUntil !== undefined && ts < cooldownUntil) {
				cooldownUntil = undefined
			}
			return
		}

		if (!armed) return

		const lastOut = deps.lastOutputAt?.() ?? quietSince
		if (lastOut === undefined) {
			quietSince ??= ts
		} else if (quietSince === undefined || lastOut > quietSince) {
			quietSince = lastOut
		}

		if (ts - quietSince < config.quietMs) return

		if (cooldownUntil !== undefined && ts < cooldownUntil) return

		const lastLaneEvent = deps.lastEventAt(sessionKey)
		if (lastLaneEvent !== undefined && ts - lastLaneEvent < config.cooldownMs) {
			armed = false
			quietSince = undefined
			cooldownUntil = ts + config.cooldownMs
			return
		}

		const minuteBucket = Math.floor(ts / 60_000)
		const event: NotifyEvent = {
			v: 1,
			id: `silence:${sessionKey}:${minuteBucket}`,
			kind: 'silence',
			session: sessionKey,
			title: `herdweb · ${sessionKey} 可能完工/卡住`,
			body: `已 ${config.quietMs / 1000} 秒无输出`,
			ts,
		}
		deps.dispatch(event)

		armed = false
		quietSince = undefined
		cooldownUntil = ts + config.cooldownMs
	}, tickMs)

	if (typeof timer === 'object' && 'unref' in timer) {
		timer.unref()
	}

	return {
		dispose() {
			clearInterval(timer)
		},
	}
}
