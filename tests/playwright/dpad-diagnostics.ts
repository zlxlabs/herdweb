import type { Page, TestInfo } from '@playwright/test'

type Evt = 'pointerdown' | 'pointerup' | 'mousedown' | 'mouseup' | 'click'
type KeyName = 'enter' | 'down'
type EvtCounts = Record<Evt, number>

interface StatusLogEntry {
	t: string
	state: string
	lastFailureReason: string | null
	consecutivePreSyncFailures: number
	targetId: string | null
	attachmentId: string | null
}

interface PageDiag {
	notices: { count: number; recent: string[] }
	buttonEvents: Record<KeyName, EvtCounts>
	statusLog: StatusLogEntry[]
	lastDump?: unknown
}

type WsDir = 'out' | 'in'

interface WsFrame {
	timestamp: string
	dir: WsDir
	ws: number
	hex: string
	preview?: string
}

const emptyCounts = (): EvtCounts => ({
	pointerdown: 0,
	pointerup: 0,
	mousedown: 0,
	mouseup: 0,
	click: 0,
})

export class DpadDiagnostics {
	private page: Page
	private testInfo: TestInfo
	private expected: string
	private wsSentCount = 0
	private wsSeq = 0
	private recentFrames: Array<{ timestamp: string; hex: string; preview?: string }> = []
	private timeline: WsFrame[] = []
	private lifecycle: string[] = []

	constructor(page: Page, testInfo: TestInfo) {
		this.page = page
		this.testInfo = testInfo
		const t = testInfo.title
		this.expected = t.includes('0a') || t.includes('⏎') ? '0a' : t.includes('↓') ? '1b5b42' : ''
	}

	recordWsOpen(): number {
		this.wsSeq += 1
		const id = this.wsSeq
		this.lifecycle.push(`${new Date().toISOString()} open ws#${id}`)
		if (this.lifecycle.length > 20) this.lifecycle.shift()
		return id
	}

	recordWsClose(id: number): void {
		this.lifecycle.push(`${new Date().toISOString()} close ws#${id}`)
		if (this.lifecycle.length > 20) this.lifecycle.shift()
	}

	recordWsFrame(payload: string | Buffer, dir: WsDir = 'out', ws = 0): void {
		const buf = Buffer.isBuffer(payload)
			? payload
			: typeof payload === 'string'
				? Buffer.from(payload, 'utf8')
				: Buffer.from(payload as unknown as Uint8Array)
		const timestamp = new Date().toISOString()
		const preview = buf.toString('utf8').slice(0, 80)
		const hex = buf.toString('hex')
		if (dir === 'out') {
			this.wsSentCount++
			this.recentFrames.push({ timestamp, hex, preview })
			if (this.recentFrames.length > 10) this.recentFrames.shift()
		}
		this.timeline.push({ timestamp, dir, ws, hex, preview })
		if (this.timeline.length > 30) this.timeline.shift()
	}

	async afterTest(testInfo: TestInfo): Promise<void> {
		const failed = testInfo.status !== testInfo.expectedStatus
		if (!failed && process.env.DPAD_DIAG_FORCE !== '1') return
		await this.dump(failed ? 'failed' : 'forced')
	}

	async dump(status: 'failed' | 'forced'): Promise<void> {
		let screen = ''
		let conn: unknown = null
		let identity = { targetId: null as string | null, attachmentId: null as string | null }
		let pageDiag: PageDiag = {
			notices: { count: 0, recent: [] },
			buttonEvents: { enter: emptyCounts(), down: emptyCounts() },
			statusLog: [],
		}

		if (!this.page.isClosed()) {
			try {
				screen =
					(await this.page.locator('#terminal .xterm-rows').textContent({ timeout: 2000 })) ?? ''
			} catch (e) {
				screen = `[error reading #terminal .xterm-rows: ${(e as Error).message}]`
			}
			try {
				const evalRes = await this.page.evaluate(() => {
					const win = window as unknown as {
						term?: {
							getConnectionStatus?: () => unknown
							getCurrentTargetId?: () => string | null
							getAttachmentId?: () => string | null
						}
						__dpadDiag?: PageDiag
					}
					return {
						conn: win.term?.getConnectionStatus?.() ?? null,
						targetId: win.term?.getCurrentTargetId?.() ?? null,
						attachmentId: win.term?.getAttachmentId?.() ?? null,
						diag: win.__dpadDiag ?? null,
					}
				})
				conn = evalRes.conn
				identity = { targetId: evalRes.targetId, attachmentId: evalRes.attachmentId }
				if (evalRes.diag) {
					pageDiag = {
						...evalRes.diag,
						statusLog: evalRes.diag.statusLog ?? [],
					}
				}
			} catch (e) {
				conn = { error: (e as Error).message }
			}
		}

		const dumpData = {
			testTitle: this.testInfo.title,
			status,
			screen,
			conn,
			notices: pageDiag.notices,
			buttonEvents: pageDiag.buttonEvents,
			wsFrames: { total: this.wsSentCount, recent: [...this.recentFrames] },
			assertion: {
				expected: this.expected,
				actual: screen.length > 300 ? screen.slice(-300) : screen,
				matched: this.expected ? screen.includes(this.expected) : false,
			},
		}

		if (!this.page.isClosed()) {
			await this.page
				.evaluate((data) => {
					const win = window as unknown as { __dpadDiag?: { lastDump?: unknown } }
					if (win.__dpadDiag) win.__dpadDiag.lastDump = data
				}, dumpData)
				.catch(() => {})
		}

		const fmtEvents = (k: KeyName) =>
			Object.entries(pageDiag.buttonEvents[k])
				.map(([e, c]) => `${e}=${c}`)
				.join(', ')

		const log = (msg: string) => {
			for (const line of msg.split('\n')) {
				console.log(`[dpad-diag] ${line}`)
			}
		}
		log(`=== DPAD DIAGNOSTICS DUMP: ${dumpData.testTitle} ===`)
		log(`status: ${dumpData.status}`)
		log(`1. PTY screen text snapshot:\n   ${JSON.stringify(dumpData.screen)}`)
		log(`2. Connection status:\n   ${JSON.stringify(dumpData.conn)}`)
		log(
			`3. herdweb-connection-notice events:\n   count: ${dumpData.notices.count}, recent: ${JSON.stringify(dumpData.notices.recent)}`,
		)
		log(
			`4. Button event counts:\n   ⏎ (enter): ${fmtEvents('enter')}\n   ↓ (down):  ${fmtEvents('down')}`,
		)
		log(`5. WS outgoing frames:\n   total sent count: ${dumpData.wsFrames.total}`)
		dumpData.wsFrames.recent.forEach((f, i) =>
			log(`   [${i + 1}] ${f.timestamp} hex=${f.hex} preview=${JSON.stringify(f.preview)}`),
		)
		log(
			`6. Assertion expected vs actual:\n   expected: ${JSON.stringify(dumpData.assertion.expected)}\n   actual snippet: ${JSON.stringify(dumpData.assertion.actual)}\n   matched: ${dumpData.assertion.matched}`,
		)
		log(
			`extra. WS lifecycle:\n   ${this.lifecycle.length === 0 ? '(none)' : this.lifecycle.join('\n   ')}`,
		)
		log('extra. WS bidirectional timeline (recent):')
		if (this.timeline.length === 0) {
			log('   (none)')
		} else {
			for (const [i, f] of this.timeline.entries()) {
				log(`   [${i + 1}] ${f.timestamp} ${f.dir} ws#${f.ws} preview=${JSON.stringify(f.preview)}`)
			}
		}
		log(
			`extra. Connection status log:\n   ${pageDiag.statusLog.length === 0 ? '(none)' : JSON.stringify(pageDiag.statusLog)}`,
		)
		log(`extra. Dump-time identity: ${JSON.stringify(identity)}`)
		log('=== END DPAD DIAGNOSTICS DUMP ===')
	}
}

export async function installDpadDiagnostics(
	page: Page,
	testInfo: TestInfo,
): Promise<DpadDiagnostics> {
	const diag = new DpadDiagnostics(page, testInfo)
	page.on('websocket', (ws) => {
		const id = diag.recordWsOpen()
		ws.on('framesent', (e) => diag.recordWsFrame(e.payload, 'out', id))
		ws.on('framereceived', (e) => diag.recordWsFrame(e.payload, 'in', id))
		ws.on('close', () => diag.recordWsClose(id))
	})

	await page.addInitScript(() => {
		type E = 'pointerdown' | 'pointerup' | 'mousedown' | 'mouseup' | 'click'
		type K = 'enter' | 'down'
		type StatusLogEntry = {
			t: string
			state: string
			lastFailureReason: string | null
			consecutivePreSyncFailures: number
			targetId: string | null
			attachmentId: string | null
		}
		const win = window as unknown as {
			term?: {
				onConnectionStatusChange?: (
					handler: (status: {
						state: string
						lastFailureReason: string | null
						consecutivePreSyncFailures: number
					}) => void,
				) => { dispose(): void }
				getCurrentTargetId?: () => string | null
				getAttachmentId?: () => string | null
			}
			__dpadDiag?: {
				notices: { count: number; recent: string[] }
				buttonEvents: Record<K, Record<E, number>>
				statusLog: StatusLogEntry[]
				lastDump: unknown
			}
		}
		const initCounts = (): Record<E, number> => ({
			pointerdown: 0,
			pointerup: 0,
			mousedown: 0,
			mouseup: 0,
			click: 0,
		})
		if (!win.__dpadDiag) {
			win.__dpadDiag = {
				notices: { count: 0, recent: [] },
				buttonEvents: { enter: initCounts(), down: initCounts() },
				statusLog: [],
				lastDump: null,
			}
		}
		const diagState = win.__dpadDiag

		let termValue: (typeof win)['term']
		Object.defineProperty(win, 'term', {
			configurable: true,
			get() {
				return termValue
			},
			set(value: (typeof win)['term']) {
				termValue = value
				value?.onConnectionStatusChange?.((status) => {
					diagState.statusLog.push({
						t: new Date().toISOString(),
						state: status.state,
						lastFailureReason: status.lastFailureReason,
						consecutivePreSyncFailures: status.consecutivePreSyncFailures,
						targetId: value.getCurrentTargetId?.() ?? null,
						attachmentId: value.getAttachmentId?.() ?? null,
					})
					if (diagState.statusLog.length > 20) diagState.statusLog.shift()
				})
			},
		})

		window.addEventListener('herdweb-connection-notice', (e: Event) => {
			diagState.notices.count++
			const d = (e as CustomEvent).detail
			diagState.notices.recent.push(
				d === undefined ? 'undefined' : typeof d === 'string' ? d : JSON.stringify(d),
			)
			if (diagState.notices.recent.length > 5) diagState.notices.recent.shift()
		})

		const resolveKey = (target: Node | null): K | null => {
			const el = target instanceof Element ? target : target?.parentElement
			const btn = el?.closest('#wt-dpad button')
			if (!btn) return null
			const txt = btn.textContent?.trim() ?? ''
			const aria = (btn.getAttribute('aria-label') ?? '').toLowerCase()
			if (txt.includes('⏎') || aria.includes('enter')) return 'enter'
			if (txt.includes('↓') || aria.includes('down')) return 'down'
			return null
		}

		const eventTypes: readonly E[] = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']
		for (const type of eventTypes) {
			window.addEventListener(
				type,
				(e: Event) => {
					const k = resolveKey(e.target as Node | null)
					if (k) diagState.buttonEvents[k][type]++
				},
				true,
			)
		}
	})

	return diag
}
