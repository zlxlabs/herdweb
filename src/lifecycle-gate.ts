interface LifecycleGate {
	tryAcquire(): { release(): void } | null
	close(): void
	waitForZero(): Promise<void>
}
export function createLifecycleGate(): LifecycleGate {
	let accepting = true
	let leases = 0
	let drained: Promise<void> | undefined
	let resolveDrained: (() => void) | undefined
	return {
		tryAcquire() {
			if (!accepting) return null
			leases += 1
			let released = false
			return {
				release(): void {
					if (released) return
					released = true
					if (--leases === 0 && !accepting) resolveDrained?.()
				},
			}
		},
		close(): void {
			accepting = false
			if (leases === 0) resolveDrained?.()
		},
		waitForZero(): Promise<void> {
			if (leases === 0) return Promise.resolve()
			// biome-ignore lint/suspicious/noAssignInExpressions: cache the single drain promise
			return (drained ??= new Promise<void>((resolve) => (resolveDrained = resolve)))
		},
	}
}
