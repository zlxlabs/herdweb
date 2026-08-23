/** Action types for control buttons — discriminated union, no boolean flags */
export type ButtonAction =
	| { readonly type: 'send'; readonly data: string; readonly keyLabel?: string }
	| { readonly type: 'ctrl-modifier' }
	| { readonly type: 'paste' }
	| { readonly type: 'prefix'; readonly data: string }
	| { readonly type: 'combo-picker' }
	| { readonly type: 'drawer-toggle' }
	| { readonly type: 'font-size'; readonly delta: number }
	| { readonly type: 'help' }
	| { readonly type: 'keyboard-toggle' }
	| { readonly type: 'dpad-toggle' }
	| { readonly type: 'voice-input' }
	| { readonly type: 'image-upload' }
	| { readonly type: 'notify-panel' }

/** A generic control button definition used by toolbar and drawer */
export interface ControlButton {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly action: ButtonAction
}

/** xterm.js theme colours */
export interface TermTheme {
	readonly background: string
	readonly foreground: string
	readonly cursor: string
	readonly cursorAccent: string
	readonly selectionBackground: string
	readonly black: string
	readonly red: string
	readonly green: string
	readonly yellow: string
	readonly blue: string
	readonly magenta: string
	readonly cyan: string
	readonly white: string
	readonly brightBlack: string
	readonly brightRed: string
	readonly brightGreen: string
	readonly brightYellow: string
	readonly brightBlue: string
	readonly brightMagenta: string
	readonly brightCyan: string
	readonly brightWhite: string
}

/** Font configuration */
export interface FontConfig {
	readonly family: string
	readonly cdnUrl: string
	readonly mobileSizeDefault: number
	readonly sizeRange: readonly [min: number, max: number]
}

/** Swipe gesture configuration */
export interface SwipeConfig {
	readonly enabled: boolean
	readonly threshold: number
	readonly maxDuration: number
	readonly left: string
	readonly right: string
	readonly leftLabel: string
	readonly rightLabel: string
}

/** Pinch gesture configuration */
export interface PinchConfig {
	readonly enabled: boolean
}

/** Scroll gesture configuration */
export type ScrollStrategy = 'keys' | 'wheel'

/** Inertial fling configuration for touch scroll */
export interface ScrollMomentumConfig {
	readonly enabled: boolean
	/** Per-frame velocity decay factor in (0, 1); 0.95 is a typical value */
	readonly friction: number
	/** Stop fling when |velocity| drops below this threshold (px/ms) */
	readonly minVelocity: number
}

/** Scroll gesture configuration */
export interface ScrollConfig {
	readonly enabled: boolean
	readonly strategy: ScrollStrategy
	/** Follow-finger ratio: 1 = finger displacement matches content displacement */
	readonly speedMultiplier: number
	/** Terminal lines scrolled per SGR wheel event (tmux default is 3) */
	readonly linesPerWheel: number
	readonly momentum: ScrollMomentumConfig
	/** Safety cap on lines redeemed per send */
	readonly maxLinesPerSend: number
	/** Minimum interval (ms) between wheel sends. Default 33 ≈ 30Hz — herdr 1:1 mapping boundary is ~40Hz. Unlike the removed wheelIntervalMs, waiting only defers send; pending displacement is never dropped. */
	readonly sendIntervalMs: number
}

/** Double-tap gesture configuration */
export interface DoubleTapConfig {
	readonly enabled: boolean
	readonly data: string
	readonly maxInterval: number
}

/** Gesture configuration */
export interface GestureConfig {
	readonly swipe: SwipeConfig
	readonly pinch: PinchConfig
	readonly scroll: ScrollConfig
	readonly doubleTap: DoubleTapConfig
}

/** Soft keyboard behaviour on mobile */
export type KeyboardMode = 'auto' | 'manual'

/** Mobile-specific behaviour configuration */
export interface MobileConfig {
	/** Data to send to the terminal on mobile init, null = disabled */
	readonly initData: string | null
	/** Viewport width (px) below which mobile init behaviour triggers */
	readonly widthThreshold: number
	/**
	 * 'auto': tapping the terminal opens the soft keyboard (browser default).
	 * 'manual': the keyboard stays suppressed; only the keyboard-toggle button
	 * grants or revokes input permission.
	 */
	readonly keyboardMode: KeyboardMode
}

/** Viewport position for a floating button group */
export type FloatingPosition =
	| 'top-left'
	| 'top-right'
	| 'top-centre'
	| 'bottom-left'
	| 'bottom-right'
	| 'bottom-centre'
	| 'centre-left'
	| 'centre-right'

/** Layout direction for a floating button group */
export type FloatingDirection = 'row' | 'column'

/** A positioned group of floating buttons */
export interface FloatingButtonGroup {
	readonly position: FloatingPosition
	readonly direction?: FloatingDirection
	readonly buttons: readonly ControlButton[]
}

/** Floating scroll buttons (PgUp/PgDn arrows on the right edge) */
export interface ScrollButtonsConfig {
	/** Off by default — finger-drag scroll gesture already covers this */
	readonly enabled: boolean
}

/** Reconnect overlay configuration */
export interface ReconnectConfig {
	readonly enabled: boolean
}

export type ConnectionState = 'disconnected' | 'reconnecting' | 'syncing' | 'synced'

export type ConnectionFailureReason =
	| 'socket-closed'
	| 'socket-error'
	| 'snapshot-timeout'
	| 'heartbeat-timeout'
	| 'output-overflow'
	| 'protocol-error'

export interface ConnectionStatus {
	readonly state: ConnectionState
	readonly consecutivePreSyncFailures: number
	readonly lastFailureReason: ConnectionFailureReason | null
}

export type InputRejectedReason = 'id-conflict' | 'session-unavailable'

export interface InputActionResult {
	readonly id: string
	readonly accepted: boolean
	readonly reason: InputRejectedReason | null
}

/** Browser-direct ASR configuration. */
export interface DoubaoAsrConfig {
	readonly apiKey: string
	readonly resourceId: string
}

export interface AsrConfig {
	readonly enabled: boolean
	readonly provider: 'doubao'
	readonly doubao: DoubaoAsrConfig
	readonly autoEnter: boolean
}

/** PWA (Progressive Web App) configuration */
export interface PwaConfig {
	readonly enabled: boolean
	readonly shortName?: string
	readonly themeColor: string
}

export interface NotifyVapidConfig {
	readonly subject?: string
	readonly publicKey?: string
	readonly privateKey?: string
}

export interface NotifyHistoryConfig {
	readonly limit: number
}

export interface NotifySilenceConfig {
	readonly enabled: boolean
	readonly busyMs: number
	readonly quietMs: number
	readonly cooldownMs: number
}

export interface NotifyConfig {
	readonly token?: string
	readonly vapid: NotifyVapidConfig
	readonly history: NotifyHistoryConfig
	readonly silence: NotifySilenceConfig
}

/** Full herdweb configuration */
export interface HerdwebConfig {
	readonly name: string
	readonly theme: TermTheme
	readonly font: FontConfig
	readonly toolbar: {
		readonly row1: readonly ControlButton[]
		readonly row2: readonly ControlButton[]
	}
	readonly drawer: {
		readonly buttons: readonly ControlButton[]
	}
	readonly gestures: GestureConfig
	readonly mobile: MobileConfig
	readonly floatingButtons: readonly FloatingButtonGroup[]
	readonly scrollButtons: ScrollButtonsConfig
	readonly pwa: PwaConfig
	readonly reconnect: ReconnectConfig
	readonly asr: AsrConfig
	readonly notify: NotifyConfig
}

/** Deep partial — allows overriding any nested subset of config */
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Input form for a button array in config overrides.
 * - Array: replace defaults entirely
 * - Function: receive defaults, return new array (filter, reorder, append, etc.)
 */
export type ButtonArrayInput<T extends { readonly id: string }> =
	| readonly T[]
	| ((defaults: readonly T[]) => readonly T[])

/** Config overrides shape that supports ButtonArrayInput for button arrays */
export type HerdwebConfigOverrides = Omit<
	DeepPartial<HerdwebConfig>,
	'toolbar' | 'drawer' | 'floatingButtons'
> & {
	readonly toolbar?: {
		readonly row1?: ButtonArrayInput<ControlButton>
		readonly row2?: ButtonArrayInput<ControlButton>
	}
	readonly drawer?: {
		readonly buttons?: ButtonArrayInput<ControlButton>
	}
	readonly floatingButtons?: readonly FloatingButtonGroup[]
}

/**
 * Minimal xterm.js Terminal interface — only what herdweb needs.
 * Avoids importing the full xterm package.
 */
export interface XTerminal {
	cols?: number
	rows?: number
	buffer?: {
		active: {
			cursorX: number
			cursorY: number
		}
	}
	options: {
		fontSize: number
		theme?: Partial<TermTheme>
		fontFamily?: string
	}
	input(data: string, wasUserInput: boolean): void
	focus(): void
	/** Remove focus from the terminal textarea (dismisses the soft keyboard) */
	blur?(): void
	/**
	 * Suppress or restore the soft keyboard. The client bridge implements this
	 * via `inputmode="none"` on the terminal textarea (spike 增量0 定案).
	 * Locking blurs first — changing the attribute alone cannot dismiss an
	 * already-open keyboard.
	 */
	setKeyboardSuppressed?(suppressed: boolean): void
	/** Track terminal textarea focus/blur events */
	onFocusChange?(handler: (focused: boolean) => void): { dispose(): void }
	onData(handler: (data: string) => void): { dispose(): void }
	/** Whether the terminal has applied the current epoch's complete snapshot. */
	isConnected(): boolean
	/** Observe transitions into and out of the synced state. */
	onConnectionChange(handler: (connected: boolean) => void): { dispose(): void }
	/** Current connection state. */
	getConnectionStatus(): ConnectionStatus
	/** Observe all connection state transitions. */
	onConnectionStatusChange(handler: (status: ConnectionStatus) => void): { dispose(): void }
	/** Ask the runtime bridge to attempt a fresh connection immediately. */
	requestReconnect(): void
	/** Current epoch snapshot's terminal session ID, or null before sync. */
	getSessionId(): string | null
	/** Send one acknowledged composer action when the current connection is fresh. */
	sendInputAction(id: string, data: string): boolean
	/** Observe acknowledged or rejected composer actions for the current epoch. */
	onInputActionResult(handler: (result: InputActionResult) => void): { dispose(): void }
}

/** ttyd sets window.term — typed globally to avoid unsafe casts */
declare global {
	interface Window {
		term?: XTerminal
		/** WebSocket instances captured by the reconnect interceptor script */
		__herdwebSockets?: WebSocket[]
		/** Trigger a terminal fit + resize cycle after layout changes */
		__herdwebResize?: () => void
	}
}
