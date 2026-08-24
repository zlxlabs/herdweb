import type { TargetMode } from './types'
import { el } from './util/dom'
import { onTap } from './util/tap'

/**
 * Initial target restore: resolve which target the page attaches first, and
 * persist the committed choice. URL/lastTargetId are only candidates — they
 * become durable state only after a matching `attach-committed`.
 */

type InitialTargetResolution =
	| { readonly kind: 'attach'; readonly targetId: string }
	| { readonly kind: 'blocked'; readonly reason: string }

type LastTargetRead =
	| { readonly kind: 'ok'; readonly value: string | null }
	| { readonly kind: 'unavailable' }

const LAST_TARGET_KEY_PREFIX = 'herdweb:lastTargetId:'

export function lastTargetStorageKey(basePath: string): string {
	return `${LAST_TARGET_KEY_PREFIX}${basePath}`
}

export function readLastTargetId(basePath: string): LastTargetRead {
	try {
		return { kind: 'ok', value: window.localStorage.getItem(lastTargetStorageKey(basePath)) }
	} catch {
		return { kind: 'unavailable' }
	}
}

/** Persist the committed target. Returns false (fail loud) when storage is unavailable. */
export function persistLastTargetId(basePath: string, targetId: string): boolean {
	try {
		window.localStorage.setItem(lastTargetStorageKey(basePath), targetId)
		return true
	} catch {
		return false
	}
}

/** Raw `?target=` candidate, or null when absent. Invalid values stay visible so restore fails loud. */
export function readUrlTargetId(search: string): string | null {
	return new URLSearchParams(search).get('target')
}

/** Reflect the committed target in the URL without stacking browser history. */
export function persistUrlTargetId(targetId: string): void {
	const url = new URL(window.location.href)
	url.searchParams.set('target', targetId)
	window.history.replaceState(null, '', url)
}

/**
 * First-target order: valid URL target → valid lastTargetId → default (targetIds[0],
 * which the server sorts first). Single mode never reads lastTargetId. Any provided
 * but unknown id, and unreadable explicit-mode storage, block instead of substituting.
 */
export function resolveInitialTarget(input: {
	readonly mode: TargetMode
	readonly urlTargetId: string | null
	readonly lastTarget: LastTargetRead
	readonly targetIds: readonly string[]
}): InitialTargetResolution {
	const defaultTargetId = input.targetIds[0]
	if (defaultTargetId === undefined) throw new Error('herdweb: targets list must not be empty')
	if (input.urlTargetId !== null) {
		if (input.targetIds.includes(input.urlTargetId)) {
			return { kind: 'attach', targetId: input.urlTargetId }
		}
		return {
			kind: 'blocked',
			reason: `This link points at target "${input.urlTargetId}", which does not exist or was removed.`,
		}
	}
	if (input.mode === 'single') return { kind: 'attach', targetId: defaultTargetId }
	if (input.lastTarget.kind === 'unavailable') {
		return { kind: 'blocked', reason: 'Target storage is unavailable on this device.' }
	}
	if (input.lastTarget.value !== null) {
		if (input.targetIds.includes(input.lastTarget.value)) {
			return { kind: 'attach', targetId: input.lastTarget.value }
		}
		return {
			kind: 'blocked',
			reason: `The last target "${input.lastTarget.value}" no longer exists.`,
		}
	}
	return { kind: 'attach', targetId: defaultTargetId }
}

export interface RestoreTargetChoice {
	readonly id: string
	readonly name: string
}

export interface TargetRestoreOverlay {
	readonly element: HTMLDivElement
	show(reason: string, targets: readonly RestoreTargetChoice[]): void
	hide(): void
}

/**
 * Fail-loud restore overlay: explains why no target was attached and waits for an
 * explicit choice — "continue with default" or any other target. Never auto-attaches,
 * never focuses (keyboard sovereignty stays with the terminal).
 */
export function createTargetRestoreOverlay(
	onChoose: (targetId: string) => void,
): TargetRestoreOverlay {
	const element = el('div', { id: 'herdweb-target-restore', role: 'dialog', 'aria-modal': 'false' })
	element.style.display = 'none'
	const message = el('div', { class: 'herdweb-target-restore-reason', role: 'alert' })
	const choices = el('div', { class: 'herdweb-target-restore-choices' })
	element.append(message, choices)

	function choose(targetId: string): void {
		element.style.display = 'none'
		onChoose(targetId)
	}

	return {
		element,
		show(reason, targets) {
			message.textContent = reason
			choices.textContent = ''
			const defaultTarget = targets[0]
			if (defaultTarget) {
				const continueButton = el('button', { type: 'button' })
				continueButton.textContent = `Continue with ${defaultTarget.name}`
				onTap(continueButton, () => choose(defaultTarget.id))
				choices.appendChild(continueButton)
			}
			for (const target of targets) {
				const button = el('button', { type: 'button' })
				button.textContent = target.name
				onTap(button, () => choose(target.id))
				choices.appendChild(button)
			}
			element.style.display = 'flex'
		},
		hide() {
			element.style.display = 'none'
		},
	}
}
