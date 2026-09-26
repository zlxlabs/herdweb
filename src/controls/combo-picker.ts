import { el } from '../util/dom'
import { haptic } from '../util/haptic'
import { onTap } from '../util/tap'

interface ComboDispatch {
	readonly sendText: (data: string) => Promise<void>
	readonly focusIfNeeded: () => void
	readonly title?: string
	readonly description?: string
}

type ComboParseResult =
	| { readonly ok: true; readonly data: string }
	| { readonly ok: false; readonly error: string }

interface ComboTokens {
	readonly modifiers: readonly string[]
	readonly key: string
}

type ComboModifiersResult =
	| { readonly ok: true; readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean }
	| { readonly ok: false; readonly error: string }

const NAMED_KEYS = [
	'pagedown',
	'pageup',
	'return',
	'escape',
	'backspace',
	'delete',
	'enter',
	'space',
	'tab',
	'home',
	'end',
	'left',
	'right',
	'down',
	'up',
	'pgdn',
	'pgup',
	'del',
	'esc',
	'bs',
	'f12',
	'f11',
	'f10',
	'f9',
	'f8',
	'f7',
	'f6',
	'f5',
	'f4',
	'f3',
	'f2',
	'f1',
] as const

const ARROW_FINAL: Readonly<Record<string, string>> = {
	up: 'A',
	down: 'B',
	right: 'C',
	left: 'D',
	home: 'H',
	end: 'F',
}

const PAGE_CODE: Readonly<Record<string, number>> = {
	pageup: 5,
	pgup: 5,
	pagedown: 6,
	pgdn: 6,
}

const F_KEY_SS3: Readonly<Record<string, string>> = {
	f1: 'P',
	f2: 'Q',
	f3: 'R',
	f4: 'S',
}

const F_KEY_TILDE: Readonly<Record<string, number>> = {
	f5: 15,
	f6: 17,
	f7: 18,
	f8: 19,
	f9: 20,
	f10: 21,
	f11: 23,
	f12: 24,
}

const S_ENTER_ERROR =
	'Shift+Enter is indistinguishable from Enter here; hold ⏎ on the d-pad for a newline'

function csiModifier(shift: boolean, alt: boolean, ctrl: boolean): number {
	return 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)
}

function encodeNamedSpecialKey(
	keyLower: string,
	ctrl: boolean,
	alt: boolean,
	shift: boolean,
): ComboParseResult | null {
	const hasMod = ctrl || alt || shift
	const m = csiModifier(shift, alt, ctrl)

	const arrow = ARROW_FINAL[keyLower]
	if (arrow) {
		if (!hasMod) return { ok: true, data: `\x1b[${arrow}` }
		return { ok: true, data: `\x1b[1;${m}${arrow}` }
	}

	const page = PAGE_CODE[keyLower]
	if (page !== undefined) {
		if (!hasMod) return { ok: true, data: `\x1b[${page}~` }
		return { ok: true, data: `\x1b[${page};${m}~` }
	}

	const ss3 = F_KEY_SS3[keyLower]
	if (ss3) {
		if (!hasMod) return { ok: true, data: `\x1bO${ss3}` }
		return { ok: true, data: `\x1b[1;${m}${ss3}` }
	}

	const tilde = F_KEY_TILDE[keyLower]
	if (tilde !== undefined) {
		if (!hasMod) return { ok: true, data: `\x1b[${tilde}~` }
		return { ok: true, data: `\x1b[${tilde};${m}~` }
	}

	return null
}

function parseComboTokens(value: string): ComboTokens | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) {
		return null
	}

	let keyToken: string | null = null
	let prefix = ''

	for (const key of NAMED_KEYS) {
		const pattern = new RegExp(`(?:^|[+\\-\\s])(${key})$`, 'i')
		const match = trimmed.match(pattern)
		if (!match || match.index === undefined) continue

		const matchedKey = match[1]
		if (!matchedKey) continue
		const keyStart = match.index + match[0].length - matchedKey.length
		keyToken = matchedKey
		prefix = trimmed.slice(0, keyStart)
		break
	}

	if (!keyToken) {
		keyToken = trimmed[trimmed.length - 1] ?? ''
		prefix = trimmed.slice(0, -1)
	}

	const modifiers = prefix
		.split(/[+\-\s]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)

	return { modifiers, key: keyToken }
}

function resolveBaseKey(key: string, keyLower: string): ComboParseResult {
	if (key.length === 1) {
		return { ok: true, data: key }
	}

	if (keyLower === 'enter' || keyLower === 'return') return { ok: true, data: '\r' }
	if (keyLower === 'tab') return { ok: true, data: '\t' }
	if (keyLower === 'space') return { ok: true, data: ' ' }
	if (keyLower === 'esc' || keyLower === 'escape') return { ok: true, data: '\x1b' }
	if (keyLower === 'backspace' || keyLower === 'bs') return { ok: true, data: '\x7f' }
	if (keyLower === 'delete' || keyLower === 'del') return { ok: true, data: '\x1b[3~' }
	if (keyLower === 'up') return { ok: true, data: '\x1b[A' }
	if (keyLower === 'down') return { ok: true, data: '\x1b[B' }
	if (keyLower === 'right') return { ok: true, data: '\x1b[C' }
	if (keyLower === 'left') return { ok: true, data: '\x1b[D' }
	if (keyLower === 'home') return { ok: true, data: '\x1b[H' }
	if (keyLower === 'end') return { ok: true, data: '\x1b[F' }
	if (keyLower === 'pageup' || keyLower === 'pgup') return { ok: true, data: '\x1b[5~' }
	if (keyLower === 'pagedown' || keyLower === 'pgdn') return { ok: true, data: '\x1b[6~' }

	return {
		ok: false,
		error: 'Unknown key. Try one character, Enter, Tab, Space, Esc, arrows, Home/End, PgUp/PgDn.',
	}
}

function applyCtrl(base: string, key: string, keyLower: string): ComboParseResult {
	if (base.length !== 1) {
		return {
			ok: false,
			error: 'Ctrl supports single characters (for Enter use M-Enter).',
		}
	}

	if (keyLower === 'space') return { ok: true, data: '\x00' }
	if (key.length !== 1) {
		return {
			ok: false,
			error: 'Unsupported Ctrl combo for this key.',
		}
	}

	if (key === '[') return { ok: true, data: '\x1b' }
	if (key === '\\') return { ok: true, data: '\x1c' }
	if (key === ']') return { ok: true, data: '\x1d' }
	if (key === '6') return { ok: true, data: '\x1e' }
	if (key === '-' || key === '/') return { ok: true, data: '\x1f' }
	if (key === '8') return { ok: true, data: '\x7f' }

	const code = key.charCodeAt(0)
	if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
		return { ok: true, data: String.fromCharCode(code & 0x1f) }
	}

	return {
		ok: false,
		error: 'Unsupported Ctrl combo for this key.',
	}
}

function parseModifiers(modifiers: readonly string[]): ComboModifiersResult {
	const hasShift = modifiers.some((modifier) => ['s', 'shift'].includes(modifier.toLowerCase()))
	const supported = new Set(['c', 'ctrl', 'control', 'm', 'meta', 'alt', 'a', 's', 'shift'])
	if (hasShift && modifiers.some((modifier) => !supported.has(modifier.toLowerCase()))) {
		return { ok: false, error: 'Unsupported Shift combo for this key.' }
	}

	let ctrl = false
	let alt = false
	let shift = false
	for (const modifier of modifiers) {
		const token = modifier.toLowerCase()
		if (token === 'c' || token === 'ctrl' || token === 'control') ctrl = true
		else if (token === 'm' || token === 'meta' || token === 'alt' || token === 'a') alt = true
		else if (token === 's' || token === 'shift') shift = true
		else return { ok: false, error: `Unknown modifier: ${modifier}` }
	}

	return { ok: true, ctrl, alt, shift }
}

export function parseComboInput(value: string): ComboParseResult {
	const tokens = parseComboTokens(value)
	if (!tokens) {
		return { ok: false, error: 'Type a combo like C-s, M-Enter, or C-[.' }
	}

	const parsedModifiers = parseModifiers(tokens.modifiers)
	if (!parsedModifiers.ok) return parsedModifiers
	const { ctrl, alt, shift } = parsedModifiers

	const keyToken = tokens.key
	if (!keyToken) {
		return { ok: false, error: 'Missing key in combo.' }
	}

	const keyLower = keyToken.toLowerCase()
	if (shift && (keyLower === 'enter' || keyLower === 'return')) {
		return { ok: false, error: S_ENTER_ERROR }
	}

	const special = encodeNamedSpecialKey(keyLower, ctrl, alt, shift)
	if (special) return special

	const base = resolveBaseKey(keyToken, keyLower)
	if (!base.ok) return base

	let data = base.data
	if (shift) {
		if (keyLower === 'tab') {
			if (ctrl) {
				return { ok: false, error: 'Unsupported Shift combo for this key.' }
			}
			data = '\x1b[Z'
		} else if (
			keyToken.length === 1 &&
			((keyToken >= 'A' && keyToken <= 'Z') || (keyToken >= 'a' && keyToken <= 'z'))
		) {
			data = keyToken.toUpperCase()
		} else {
			return { ok: false, error: 'Unsupported Shift combo for this key.' }
		}
	}
	if (ctrl) {
		const next = applyCtrl(data, keyToken, keyLower)
		if (!next.ok) return next
		data = next.data
	}

	if (alt) {
		data = `\x1b${data}`
	}

	return { ok: true, data }
}

interface ComboPickerResult {
	readonly element: HTMLDivElement
	readonly open: (dispatch: ComboDispatch) => void
	readonly close: () => void
}

export function createComboPicker(): ComboPickerResult {
	const backdrop = el('div', { id: 'wt-combo-backdrop' })
	const panel = el('div', { id: 'wt-combo-panel' })
	const title = el('h3')
	title.textContent = 'Send combo'
	const description = el('p')
	description.textContent = 'Examples: C-s, C-[, M-Enter, Alt-x'
	const input = el('input', {
		type: 'text',
		placeholder: 'Combo',
		'aria-label': 'Combo input',
		autocomplete: 'off',
		autocorrect: 'off',
		autocapitalize: 'off',
		spellcheck: 'false',
	})
	const error = el('p', { class: 'wt-combo-error' })
	const actions = el('div', { class: 'wt-combo-actions' })
	const cancelButton = el('button', { type: 'button' }, 'Cancel')
	const sendButton = el('button', { type: 'button' }, 'Send')

	actions.appendChild(cancelButton)
	actions.appendChild(sendButton)
	panel.appendChild(title)
	panel.appendChild(description)
	panel.appendChild(input)
	panel.appendChild(error)
	panel.appendChild(actions)
	backdrop.appendChild(panel)

	let currentDispatch: ComboDispatch | null = null

	function clearError(): void {
		error.textContent = ''
	}

	function setError(message: string): void {
		error.textContent = message
	}

	function closeAndFocus(): void {
		const dispatch = currentDispatch
		backdrop.style.display = 'none'
		currentDispatch = null
		clearError()
		input.value = ''
		if (dispatch) {
			dispatch.focusIfNeeded()
		}
	}

	async function submit(): Promise<void> {
		const dispatch = currentDispatch
		if (!dispatch) return

		const parsed = parseComboInput(input.value)
		if (!parsed.ok) {
			setError(parsed.error)
			return
		}

		backdrop.style.display = 'none'
		currentDispatch = null
		clearError()
		input.value = ''

		try {
			await dispatch.sendText(parsed.data)
		} catch (errorValue) {
			console.error('herdweb: combo send failed', errorValue)
		} finally {
			dispatch.focusIfNeeded()
		}
	}

	const defaultTitle = 'Send combo'
	const defaultDescription = 'Examples: C-s, C-[, M-Enter, Alt-x'

	function open(dispatch: ComboDispatch): void {
		currentDispatch = dispatch
		clearError()
		input.value = ''
		title.textContent = dispatch.title ?? defaultTitle
		description.textContent = dispatch.description ?? defaultDescription
		backdrop.style.display = 'flex'
		setTimeout(() => input.focus(), 0)
	}

	function close(): void {
		title.textContent = defaultTitle
		description.textContent = defaultDescription
		closeAndFocus()
	}

	onTap(backdrop, (event: Event) => {
		if (event.target !== backdrop) return
		haptic()
		closeAndFocus()
	})

	onTap(cancelButton, () => {
		haptic()
		closeAndFocus()
	})

	onTap(sendButton, () => {
		haptic()
		void submit()
	})

	input.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault()
			haptic()
			void submit()
			return
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			haptic()
			closeAndFocus()
		}
	})

	return { element: backdrop, open, close }
}
