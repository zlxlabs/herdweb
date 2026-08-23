/** Sliding-window rate limiter: max `limit` events per `windowMs`. */
export class SlidingWindowRateLimiter {
	private readonly timestamps: number[] = []
	private readonly limit: number
	private readonly windowMs: number
	private readonly now: () => number

	constructor(limit: number, windowMs: number, now: () => number = Date.now) {
		this.limit = limit
		this.windowMs = windowMs
		this.now = now
	}

	/** Returns true when the request is allowed; records it when allowed. */
	allow(): boolean {
		const cutoff = this.now() - this.windowMs
		while (this.timestamps.length > 0) {
			const oldest = this.timestamps[0]
			if (oldest === undefined || oldest >= cutoff) break
			this.timestamps.shift()
		}
		if (this.timestamps.length >= this.limit) {
			return false
		}
		this.timestamps.push(this.now())
		return true
	}
}
