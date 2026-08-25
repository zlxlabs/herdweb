import { el } from './dom'

const TOAST_VISIBLE_MS = 2_500

let active: {
	readonly element: HTMLElement
	readonly timer: ReturnType<typeof setTimeout>
} | null = null

/**
 * Show a transient status toast above the bottom toolbar (auto-hides after
 * ~2.5s). A new toast replaces the one currently visible. Inline styles keep
 * this usable from any module without touching the stylesheet.
 */
export function showToast(message: string): void {
	if (active) {
		clearTimeout(active.timer)
		active.element.remove()
		active = null
	}
	const element = el(
		'div',
		{
			role: 'status',
			style: [
				'position:fixed',
				'left:50%',
				'bottom:96px',
				'transform:translateX(-50%)',
				'z-index:10001',
				'max-width:80vw',
				'padding:10px 16px',
				'border-radius:8px',
				'background:#313244',
				'color:#cdd6f4',
				'font-family:sans-serif',
				'font-size:0.9rem',
				'text-align:center',
				'pointer-events:none',
			].join(';'),
		},
		message,
	)
	document.body.appendChild(element)
	const timer = setTimeout(() => {
		element.remove()
		active = null
	}, TOAST_VISIBLE_MS)
	active = { element, timer }
}
