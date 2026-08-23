import { joinBasePath } from '../base-path'
import { type NotifyEvent, type NotifyKind, isRecord } from '../notify/events'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

interface NotifyPanelDeps {
	readonly basePath: string
	readonly fetchFn?: typeof fetch
	readonly now?: () => number
}

interface NotifyPanelResult {
	readonly element: HTMLDivElement
	readonly open: () => void
	readonly close: () => void
}

const SW_READY_TIMEOUT_MS = 5000

const KIND_LABELS: Record<Exclude<NotifyKind, 'test'>, string> = {
	asking: '等待输入',
	done: '已完成',
	'ci-red': 'CI 变红',
	silence: '可能完工',
	health: '服务状态',
}

function kindLabel(kind: NotifyKind): string {
	if (kind === 'test') return '测试'
	return KIND_LABELS[kind]
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = atob(base64)
	const output = new Uint8Array(raw.length)
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i)
	}
	return output
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
	if (buffer === null) return ''
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isHistoryResponse(value: unknown): value is { events?: NotifyEvent[] } {
	return isRecord(value) && (value.events === undefined || Array.isArray(value.events))
}

function readPublicKey(value: unknown): string | undefined {
	if (!isRecord(value) || typeof value.publicKey !== 'string') return undefined
	return value.publicKey
}

function isStandaloneDisplay(): boolean {
	return window.matchMedia('(display-mode: standalone)').matches
}

function describePermission(): string {
	if (typeof Notification === 'undefined') return '此浏览器不支持通知'
	switch (Notification.permission) {
		case 'granted':
			return '通知权限：已允许'
		case 'denied':
			return '通知权限：已拒绝（需在浏览器站点设置中允许）'
		default:
			return '通知权限：未决定'
	}
}

function vapidApplicationServerKey(base64: string): ArrayBuffer {
	const bytes = urlBase64ToUint8Array(base64)
	const buffer = new ArrayBuffer(bytes.length)
	new Uint8Array(buffer).set(bytes)
	return buffer
}

function formatAbsoluteTime(ts: number): string {
	return new Date(ts).toLocaleString('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	})
}

function formatRelativeTime(ts: number, now: number): string {
	const diffMs = now - ts
	if (diffMs < 0) return '刚刚'
	const seconds = Math.floor(diffMs / 1000)
	if (seconds < 60) return '刚刚'
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes} 分钟前`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours} 小时前`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days} 天前`
	return formatAbsoluteTime(ts)
}

function renderHistoryItem(event: NotifyEvent, now: number): HTMLDivElement {
	const item = el('div', { class: 'wt-notify-history-item' })
	const badge = el(
		'span',
		{ class: `wt-notify-kind-badge wt-notify-kind-${event.kind}` },
		kindLabel(event.kind),
	)
	const content = el('div', { class: 'wt-notify-history-content' })
	const titleRow = el('div', { class: 'wt-notify-history-title-row' })
	const titleEl = el('span', { class: 'wt-notify-history-title' }, event.title)
	const timeEl = el(
		'time',
		{
			class: 'wt-notify-history-time',
			title: formatAbsoluteTime(event.ts),
		},
		formatRelativeTime(event.ts, now),
	)
	titleRow.append(titleEl, timeEl)
	content.append(titleRow)
	if (event.body !== undefined && event.body.length > 0) {
		content.append(el('p', { class: 'wt-notify-history-body' }, event.body))
	}
	item.append(badge, content)
	return item
}

/** Create the notify settings panel — fail-safe overlay opened from the drawer. */
export function createNotifyPanel(deps: NotifyPanelDeps): NotifyPanelResult {
	const fetchFn = deps.fetchFn ?? fetch.bind(globalThis)
	const nowFn = deps.now ?? (() => Date.now())
	const overlay = el('div', { id: 'wt-notify' })
	const closeBtn = el('button', { class: 'wt-notify-close', type: 'button' }, '\u00D7')
	const title = el('h2', {}, 'Notifications')
	const status = el('p', { class: 'wt-notify-status', role: 'status' })
	const iosHint = el('p', { class: 'wt-notify-ios-hint' })
	iosHint.textContent =
		'On iPhone, add herdweb to your Home Screen to receive push notifications. Safari tabs cannot subscribe.'
	const toggleRow = el('div', { class: 'wt-notify-row' })
	const toggleLabel = el('label', { class: 'wt-notify-toggle-label' }, 'Push notifications')
	const toggle = el('input', { type: 'checkbox', class: 'wt-notify-toggle' })
	toggleRow.append(toggleLabel, toggle)
	const permStatus = el('p', { class: 'wt-notify-perm-status' })
	const permCheckBtn = el(
		'button',
		{ type: 'button', class: 'wt-notify-perm-check' },
		'检测并重新授权',
	)
	const testBtn = el(
		'button',
		{ type: 'button', class: 'wt-notify-test' },
		'Send test notification',
	)
	const historyHeader = el('div', { class: 'wt-notify-history-header' })
	const historyTitle = el('h3', { class: 'wt-notify-history-heading' }, '历史')
	const refreshBtn = el('button', { type: 'button', class: 'wt-notify-history-refresh' }, '刷新')
	historyHeader.append(historyTitle, refreshBtn)
	const historyList = el('div', { class: 'wt-notify-history-list' })
	const historySection = el('section', { class: 'wt-notify-history' })
	historySection.append(historyHeader, historyList)
	overlay.append(
		closeBtn,
		title,
		status,
		iosHint,
		permStatus,
		toggleRow,
		permCheckBtn,
		testBtn,
		historySection,
	)

	function setStatus(message: string): void {
		status.textContent = message
	}

	function refreshPermStatus(): void {
		permStatus.textContent = describePermission()
	}

	function updateIosHint(): void {
		iosHint.style.display = isStandaloneDisplay() ? 'none' : 'block'
	}

	function clearHistoryList(): void {
		while (historyList.firstChild) {
			historyList.removeChild(historyList.firstChild)
		}
	}

	async function fetchHistory(): Promise<void> {
		clearHistoryList()
		historyList.append(el('p', { class: 'wt-notify-history-empty' }, '加载中…'))
		try {
			const response = await fetchFn(joinBasePath(deps.basePath, '/api/events/history'))
			clearHistoryList()
			if (!response.ok) {
				historyList.append(
					el('p', { class: 'wt-notify-history-error' }, `加载失败 (${response.status})`),
				)
				return
			}
			const body: unknown = await response.json()
			const events = isHistoryResponse(body) && Array.isArray(body.events) ? body.events : []
			if (events.length === 0) {
				historyList.append(el('p', { class: 'wt-notify-history-empty' }, '暂无事件'))
				return
			}
			const now = nowFn()
			for (const event of events) {
				historyList.append(renderHistoryItem(event, now))
			}
		} catch {
			clearHistoryList()
			historyList.append(el('p', { class: 'wt-notify-history-error' }, '加载失败'))
		}
	}

	async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
		if (!('serviceWorker' in navigator)) return null
		try {
			const registration = await Promise.race([
				navigator.serviceWorker.ready,
				new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
			])
			return registration
		} catch {
			return null
		}
	}

	async function refreshToggle(): Promise<void> {
		const registration = await getRegistration()
		if (!registration) {
			toggle.checked = false
			toggle.disabled = true
			setStatus('Service worker unavailable or timed out')
			return
		}
		toggle.disabled = false
		const sub = await registration.pushManager.getSubscription()
		toggle.checked = sub !== null
		setStatus(sub ? 'Subscribed' : 'Not subscribed')
	}

	async function subscribe(): Promise<void> {
		const registration = await getRegistration()
		if (!registration) {
			setStatus('Service worker unavailable')
			return
		}
		const permission = await Notification.requestPermission()
		refreshPermStatus()
		if (permission !== 'granted') {
			setStatus('Notification permission denied')
			toggle.checked = false
			return
		}
		const keyResponse = await fetchFn(joinBasePath(deps.basePath, '/api/push/vapid-key'))
		if (!keyResponse.ok) {
			setStatus('Failed to fetch VAPID key')
			toggle.checked = false
			return
		}
		const keyBody: unknown = await keyResponse.json()
		const publicKey = readPublicKey(keyBody)
		if (publicKey === undefined) {
			setStatus('Invalid VAPID key response')
			toggle.checked = false
			return
		}
		let subscription: PushSubscription
		try {
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: vapidApplicationServerKey(publicKey),
			})
		} catch (error) {
			console.error('herdweb: push subscribe failed', error)
			setStatus('订阅失败（见浏览器控制台）')
			toggle.checked = false
			return
		}
		let response: Response
		try {
			response = await fetchFn(joinBasePath(deps.basePath, '/api/push/subscribe'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					endpoint: subscription.endpoint,
					keys: {
						p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
						auth: arrayBufferToBase64(subscription.getKey('auth')),
					},
				}),
			})
		} catch {
			setStatus('Subscribe failed on server')
			await subscription.unsubscribe().catch(() => {})
			toggle.checked = false
			return
		}
		if (!response.ok) {
			setStatus('Subscribe failed on server')
			await subscription.unsubscribe().catch(() => {})
			toggle.checked = false
			return
		}
		setStatus('Subscribed')
	}

	async function unsubscribe(): Promise<void> {
		const registration = await getRegistration()
		if (!registration) return
		const sub = await registration.pushManager.getSubscription()
		if (!sub) {
			setStatus('Not subscribed')
			return
		}
		await fetchFn(joinBasePath(deps.basePath, '/api/push/subscription'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: sub.endpoint }),
		}).catch(() => {})
		await sub.unsubscribe().catch(() => {})
		refreshPermStatus()
		setStatus('Not subscribed')
	}

	function open(): void {
		updateIosHint()
		refreshPermStatus()
		overlay.style.display = 'block'
		void refreshToggle()
		void fetchHistory()
	}

	function close(): void {
		overlay.style.display = 'none'
	}

	onTap(overlay, (e: Event) => {
		if (e.target === closeBtn) close()
	})

	onTap(closeBtn, (e: Event) => {
		e.stopPropagation()
		close()
	})

	// Use change (not onTap): on touch devices touchend fires before the browser
	// flips checkbox.checked on the synthesised click, so onTap always reads the
	// pre-flip value and runs the wrong subscribe/unsubscribe branch.
	toggle.addEventListener('change', () => {
		void (async () => {
			if (toggle.checked) {
				await subscribe()
			} else {
				await unsubscribe()
			}
		})()
	})

	onTap(permCheckBtn, () => {
		void (async () => {
			if (typeof Notification === 'undefined') {
				refreshPermStatus()
				return
			}
			const permission = await Notification.requestPermission()
			refreshPermStatus()
			await refreshToggle()
			if (permission === 'denied') {
				setStatus('浏览器已拒绝通知：地址栏锁图标 → 站点设置 → 通知 → 允许，改完回来再点本按钮')
			} else if (permission === 'granted') {
				setStatus('权限已允许，可打开推送开关')
			} else {
				setStatus('未决定——再次点击可重新弹出授权')
			}
		})()
	})

	onTap(testBtn, () => {
		void (async () => {
			const response = await fetchFn(joinBasePath(deps.basePath, '/api/push/test'), {
				method: 'POST',
			})
			if (response.status === 202) {
				setStatus('Test event sent')
			} else {
				setStatus(`Test failed (${response.status})`)
			}
		})()
	})

	onTap(refreshBtn, (e: Event) => {
		e.stopPropagation()
		void fetchHistory()
	})

	return { element: overlay, open, close }
}
