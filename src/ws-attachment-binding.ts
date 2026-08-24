import { randomBytes } from 'node:crypto'
export type Attachment = Readonly<
	Record<'clientId' | 'requestId' | 'attachmentId' | 'targetId', string>
>
type AttachmentCapability = Attachment & Readonly<{ committed: boolean }>
type AttachmentResult =
	| { readonly ok: true; readonly capability: AttachmentCapability }
	| { readonly ok: false; readonly reason: 'protocol-violation' }
type Options = Readonly<{
	idGenerator?: () => string
	onTimeout?: (binding: Attachment) => void
	onInvalidate?: (binding: Attachment) => void
}>
type ClientState = {
	acceptsInput: boolean
	requestIds: Set<string>
	committed?: AttachmentCapability
	provisional?: AttachmentCapability
	timer?: ReturnType<typeof setTimeout>
}
const DEFAULT_TIMEOUT_MS = 10_000
const defaultId = () => randomBytes(16).toString('base64url')
const same = (a: Attachment, b: Attachment) =>
	JSON.stringify([a.clientId, a.requestId, a.attachmentId, a.targetId]) ===
	JSON.stringify([b.clientId, b.requestId, b.attachmentId, b.targetId])
export class WsAttachmentBinding {
	private readonly clients = new Map<string, ClientState>()
	private readonly capabilities = new Map<string, AttachmentCapability>()
	private readonly issuedIds = new Set<string>()
	private readonly idGenerator: () => string
	private readonly onTimeout?: (binding: Attachment) => void
	private readonly onInvalidate?: (binding: Attachment) => void
	constructor(options: Options = {}) {
		this.idGenerator = options.idGenerator ?? defaultId
		this.onTimeout = options.onTimeout
		this.onInvalidate = options.onInvalidate
	}
	beginAttach(clientId: string, requestId: string, targetId: string): AttachmentResult {
		const state = this.clients.get(clientId) ?? { acceptsInput: true, requestIds: new Set() }
		if (state.requestIds.has(requestId)) return { ok: false, reason: 'protocol-violation' }
		const attachmentId = this.idGenerator()
		if (this.issuedIds.has(attachmentId)) throw new Error('attachment ID collision')
		this.issuedIds.add(attachmentId)
		state.requestIds.add(requestId)
		this.clear(state, 'provisional')
		state.acceptsInput = false
		const provisional = { clientId, requestId, attachmentId, targetId, committed: false }
		state.provisional = provisional
		this.clients.set(clientId, state)
		this.capabilities.set(attachmentId, provisional)
		return { ok: true, capability: provisional }
	}
	isCurrentAttempt(clientId: string, binding: Attachment): boolean {
		const attempt = this.clients.get(clientId)?.provisional
		return attempt !== undefined && binding.clientId === clientId && same(attempt, binding)
	}
	snapshotSent(clientId: string, binding: Attachment): AttachmentResult {
		if (!this.isCurrentAttempt(clientId, binding))
			return { ok: false, reason: 'protocol-violation' }
		const state = this.clients.get(clientId)
		const provisional = state?.provisional
		if (!state || !provisional || state.timer !== undefined)
			return { ok: false, reason: 'protocol-violation' }
		state.timer = setTimeout(() => {
			if (this.clients.get(clientId)?.provisional !== provisional) return
			this.clear(state, 'provisional')
			state.acceptsInput = false
			this.onTimeout?.(provisional)
		}, DEFAULT_TIMEOUT_MS)
		return { ok: true, capability: provisional }
	}
	cancelAttach(clientId: string, binding: Attachment): AttachmentResult {
		const state = this.clients.get(clientId)
		const provisional = state?.provisional
		if (!state || !provisional || !this.isCurrentAttempt(clientId, binding))
			return { ok: false, reason: 'protocol-violation' }
		this.clear(state, 'provisional')
		state.acceptsInput = false
		return { ok: true, capability: provisional }
	}
	snapshotApplied(clientId: string, binding: Attachment): AttachmentResult {
		if (!this.isCurrentAttempt(clientId, binding))
			return { ok: false, reason: 'protocol-violation' }
		const state = this.clients.get(clientId)
		const provisional = state?.provisional
		if (!state || !provisional || state.timer === undefined)
			return { ok: false, reason: 'protocol-violation' }
		this.clear(state, 'committed')
		if (state.timer !== undefined) clearTimeout(state.timer)
		state.timer = undefined
		state.provisional = undefined
		const committed = { ...provisional, committed: true }
		state.committed = committed
		state.acceptsInput = true
		this.capabilities.set(committed.attachmentId, committed)
		return { ok: true, capability: committed }
	}
	getCapability(clientId: string, attachmentId: string): AttachmentCapability | null {
		const capability = this.capabilities.get(attachmentId)
		return capability?.clientId === clientId ? capability : null
	}
	invalidateAttachment(clientId: string, attachmentId: string): void {
		const state = this.clients.get(clientId)
		if (!state) return
		let changed = false
		for (const key of ['provisional', 'committed'] as const) {
			if (state[key]?.attachmentId !== attachmentId) continue
			this.clear(state, key)
			changed = true
		}
		if (changed) state.acceptsInput = false
	}
	acceptsInput(clientId: string): boolean {
		return this.clients.get(clientId)?.acceptsInput ?? false
	}
	disconnect(clientId: string): void {
		const state = this.clients.get(clientId)
		if (!state) return
		for (const key of ['provisional', 'committed'] as const) this.clear(state, key)
		state.acceptsInput = false
		this.clients.delete(clientId)
	}
	dispose(clientId: string): void {
		this.disconnect(clientId)
	}
	invalidateTarget(targetId: string): void {
		for (const state of this.clients.values()) {
			const changed =
				state.committed?.targetId === targetId || state.provisional?.targetId === targetId
			if (state.committed?.targetId === targetId) this.clear(state, 'committed')
			if (state.provisional?.targetId === targetId) this.clear(state, 'provisional')
			if (changed) state.acceptsInput = false
		}
	}
	private clear(state: ClientState, key: 'committed' | 'provisional'): void {
		if (key === 'provisional') {
			if (state.timer !== undefined) clearTimeout(state.timer)
			state.timer = undefined
		}
		const capability = state[key]
		if (!capability) return
		this.capabilities.delete(capability.attachmentId)
		state[key] = undefined
		this.onInvalidate?.(capability)
	}
}
