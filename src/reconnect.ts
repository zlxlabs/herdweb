import type { ConnectionStatus, ReconnectConfig, XTerminal } from './types'
import { el } from './util/dom'
import { onTap } from './util/tap'

interface ReconnectOverlay {
	readonly element: HTMLDivElement
	readonly message: HTMLDivElement
	readonly retryButton: HTMLButtonElement
	readonly authButton: HTMLButtonElement
}

function applyOverlayLayout(overlay: HTMLDivElement, everSynced: boolean): void {
	const next = everSynced ? 'banner' : 'modal'
	if (overlay.dataset.layout === next) return
	overlay.dataset.layout = next
	if (everSynced) {
		overlay.style.inset = ''
		overlay.style.top = '0'
		overlay.style.left = '0'
		overlay.style.right = '0'
		overlay.style.bottom = 'auto'
		overlay.style.height = 'auto'
		overlay.style.minHeight = '44px'
		overlay.style.flexDirection = 'row'
		overlay.style.flexWrap = 'wrap'
		overlay.style.padding = '10px 16px'
		overlay.style.borderBottom = '1px solid #cba6f7'
		overlay.style.pointerEvents = 'auto'
		return
	}
	overlay.style.top = ''
	overlay.style.left = ''
	overlay.style.right = ''
	overlay.style.bottom = ''
	overlay.style.height = ''
	overlay.style.minHeight = ''
	overlay.style.inset = '0'
	overlay.style.flexDirection = 'column'
	overlay.style.flexWrap = ''
	overlay.style.padding = ''
	overlay.style.borderBottom = ''
}

function createOverlay(onReconnect: () => void, onReload: () => void): ReconnectOverlay {
	const overlay = el('div', {
		id: 'herdweb-reconnect-overlay',
		style: [
			'display:none',
			'position:fixed',
			'inset:0',
			'z-index:10000',
			'background:rgba(30,30,46,0.92)',
			'color:#cdd6f4',
			'font-family:sans-serif',
			'justify-content:center',
			'align-items:center',
			'flex-direction:column',
			'gap:16px',
		].join(';'),
	})

	const message = el('div', {
		style: 'font-size:1.4rem;font-weight:600',
	})

	const retryButton = el('button', {
		style: [
			'padding:10px 28px',
			'font-size:1rem',
			'border:none',
			'border-radius:8px',
			'background:#cba6f7',
			'color:#1e1e2e',
			'cursor:pointer',
			'font-weight:600',
		].join(';'),
	})
	retryButton.type = 'button'
	retryButton.textContent = 'Retry now'
	onTap(retryButton, (event: Event) => {
		event.stopPropagation()
		onReconnect()
	})

	const authButton = el('button', {
		style: [
			'padding:10px 28px',
			'font-size:1rem',
			'border:1px solid #cba6f7',
			'border-radius:8px',
			'background:transparent',
			'color:#cba6f7',
			'cursor:pointer',
			'font-weight:600',
		].join(';'),
	})
	authButton.type = 'button'
	authButton.textContent = 'Re-authenticate'
	onTap(authButton, (event: Event) => {
		event.stopPropagation()
		onReload()
	})

	onTap(overlay, () => onReconnect())
	overlay.append(message, retryButton, authButton)
	return { element: overlay, message, retryButton, authButton }
}

function statusMessage(status: ConnectionStatus): string {
	if (status.lastFailureReason === 'output-overflow') return 'Output too fast — resyncing.'
	if (status.lastFailureReason === 'protocol-error' && status.consecutivePreSyncFailures >= 3) {
		return 'Connection failed — refresh, and check the server version.'
	}
	if (status.consecutivePreSyncFailures >= 3) {
		return 'Connection failed — you may need to re-authenticate.'
	}
	switch (status.state) {
		case 'disconnected':
			return 'Disconnected'
		case 'reconnecting':
			return 'Reconnecting…'
		case 'syncing':
			return 'Syncing…'
		case 'synced':
			return 'Synced'
	}
}

/** Render client-owned connection status and forward the two user actions. */
export function setupReconnect(term: XTerminal, config: ReconnectConfig): () => void {
	if (!config.enabled) return () => {}

	const {
		element: overlay,
		message,
		authButton,
	} = createOverlay(
		() => term.requestReconnect(),
		() => location.reload(),
	)
	document.body.appendChild(overlay)
	let notice: string | null = null
	let everSynced = false

	function render(status: ConnectionStatus): void {
		if (status.state === 'synced') {
			notice = null
			everSynced = true
		}
		applyOverlayLayout(overlay, everSynced)
		message.textContent = notice ?? statusMessage(status)
		overlay.dataset.connectionState = status.state
		authButton.style.display =
			status.consecutivePreSyncFailures >= 3 &&
			notice !== 'Session ended — restart herdweb to start a new one.'
				? 'block'
				: 'none'
		overlay.style.display = status.state === 'synced' ? 'none' : 'flex'
	}

	const statusSubscription = term.onConnectionStatusChange(render)
	const onNotice = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return
		const detail: unknown = event.detail
		if (typeof detail !== 'string') return
		if (detail === '') {
			notice = null
			render(term.getConnectionStatus())
			return
		}
		notice = detail
		message.textContent = detail
		if (detail === 'Session ended — restart herdweb to start a new one.') {
			authButton.style.display = 'none'
		}
		overlay.style.display = 'flex'
	}
	window.addEventListener('herdweb-connection-notice', onNotice)

	return () => {
		statusSubscription.dispose()
		window.removeEventListener('herdweb-connection-notice', onNotice)
		overlay.remove()
	}
}
