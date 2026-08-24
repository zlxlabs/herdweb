import type { TargetSummary } from '../session-protocol'
import type { ConnectionState, XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

interface TargetPicker {
	/** Compact top badge showing the current target name. */
	readonly badge: HTMLButtonElement
	/** Picker overlay element (hidden until opened). */
	readonly element: HTMLDivElement
	open(): void
	close(): void
	isOpen(): boolean
}

const PROCESS_STATE_LABELS: Record<TargetSummary['processState'], string> = {
	'not-started': '○ Not started',
	starting: '◌ Starting',
	'process-running': '● Running',
	'process-exited': '✕ Exited',
}

function browserStateLabel(state: ConnectionState): string {
	if (state === 'synced') return '✓ Connected'
	if (state === 'syncing') return '… Syncing'
	return '… Switching'
}

/**
 * Explicit-mode target picker: a compact top badge plus a drawer-style overlay
 * listing every target with its process state and this browser's attach state.
 * Data comes from the client bridge (getTargets/getCurrentTargetId/selectTarget);
 * it never holds its own copy of target state.
 */
export function createTargetPicker(term: XTerminal): TargetPicker {
	const badge = el('button', { class: 'wt-target-badge', type: 'button' })
	const element = el('div', { class: 'wt-target-picker' })
	const backdrop = el('div', { class: 'wt-target-picker-backdrop' })
	const panel = el('div', {
		class: 'wt-target-picker-panel',
		role: 'dialog',
		'aria-label': 'Targets',
	})
	const list = el('div', { class: 'wt-target-picker-list' })
	panel.appendChild(list)
	element.append(backdrop, panel)

	let open = false

	function currentTargets(): readonly TargetSummary[] {
		return term.getTargets?.() ?? []
	}

	function renderBadge(): void {
		const currentId = term.getCurrentTargetId?.() ?? null
		const current = currentTargets().find((target) => target.id === currentId)
		const name = current?.name ?? currentId ?? '…'
		badge.textContent = name
		badge.setAttribute('aria-label', `Current target: ${name} — choose target`)
		badge.setAttribute('title', name)
	}

	function renderList(): void {
		list.textContent = ''
		const currentId = term.getCurrentTargetId?.() ?? null
		const connectionState = term.getConnectionStatus().state
		const targets = currentTargets()
		if (targets.length === 0) {
			list.appendChild(el('div', { class: 'wt-target-empty' }, 'Loading targets…'))
			return
		}
		for (const target of targets) {
			const isCurrent = target.id === currentId
			const stateLabel = PROCESS_STATE_LABELS[target.processState]
			const nameEl = el('span', { class: 'wt-target-name', title: target.name }, target.name)
			const statusEl = el('span', { class: 'wt-target-status' }, stateLabel)
			const row = el('button', {
				class: 'wt-target-row',
				type: 'button',
				'data-target-id': target.id,
				'aria-label': `Target ${target.name} — ${stateLabel}${isCurrent ? `, ${browserStateLabel(connectionState)}` : ''}`,
			})
			if (isCurrent) {
				row.setAttribute('aria-current', 'true')
				statusEl.appendChild(
					el(
						'span',
						{ class: 'wt-target-browser-state' },
						` ${browserStateLabel(connectionState)}`,
					),
				)
			}
			onTap(row, () => {
				term.selectTarget?.(target.id)
				close()
			})
			row.append(nameEl, statusEl)
			if (target.processState === 'process-exited') {
				const restart = el('button', {
					class: 'wt-target-restart',
					type: 'button',
					'aria-label': `Restart target ${target.name}`,
				})
				restart.textContent = 'Restart'
				onTap(restart, () => {
					term.restartTarget?.(target.id)
					close()
				})
				row.appendChild(restart)
			}
			list.appendChild(row)
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') close()
	}

	function openPicker(): void {
		renderBadge()
		renderList()
		element.classList.add('open')
		open = true
		document.addEventListener('keydown', onKeydown)
	}

	function close(): void {
		if (!open) return
		element.classList.remove('open')
		open = false
		document.removeEventListener('keydown', onKeydown)
	}

	function renderIfVisible(): void {
		renderBadge()
		if (open) renderList()
	}

	onTap(badge, openPicker)
	onTap(backdrop, close)
	term.onTargetsChange?.(renderIfVisible)
	term.onConnectionStatusChange(renderIfVisible)
	renderBadge()

	return { badge, element, open: openPicker, close, isOpen: () => open }
}
