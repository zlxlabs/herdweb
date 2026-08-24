import type { TargetSummary } from '../session-protocol'
import type { ConnectionState, XTerminal } from '../types'
import { el } from '../util/dom'
import { onTap } from '../util/tap'

const PROCESS_STATE_LABELS: Record<TargetSummary['processState'], string> = {
	'not-started': '○ Not started',
	starting: '◌ Starting',
	'process-running': '● Running',
	'process-exited': '✕ Exited',
}

function browserStateLabel(state: ConnectionState): string {
	return state === 'synced' ? '✓ Connected' : state === 'syncing' ? '… Syncing' : '… Switching'
}

export function createTargetPicker(term: XTerminal) {
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

	const currentTargets = (): readonly TargetSummary[] => term.getTargets?.() ?? []

	function renderBadge(): void {
		const currentId = term.getCurrentTargetId?.() ?? null
		const name =
			currentTargets().find((target) => target.id === currentId)?.name ?? currentId ?? '…'
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
			const row = el('div', {
				class: 'wt-target-row',
				role: 'button',
				tabindex: '0',
				'data-target-id': target.id,
				'aria-label': `Target ${target.name} — ${stateLabel}${isCurrent ? `, ${browserStateLabel(connectionState)}` : ''}`,
			})
			if (isCurrent) {
				row.setAttribute('aria-current', 'true')
				statusEl.append(
					el(
						'span',
						{ class: 'wt-target-browser-state' },
						` ${browserStateLabel(connectionState)}`,
					),
				)
			}
			const select = (): void => {
				term.selectTarget?.(target.id)
				close()
			}
			onTap(row, select)
			row.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					select()
				}
			})
			row.append(nameEl, statusEl)
			if (target.processState === 'process-exited') {
				const restart = el('button', {
					class: 'wt-target-restart',
					type: 'button',
					'aria-label': `Restart target ${target.name}`,
				})
				restart.textContent = 'Restart'
				onTap(restart, (event) => {
					event.stopPropagation()
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
