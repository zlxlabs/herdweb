import { afterEach, describe, expect, test, vi } from 'vitest'
import { type Attachment, WsAttachmentBinding } from '../src/ws-attachment-binding'
const commit = (o: WsAttachmentBinding, b: Attachment) => o.snapshotApplied(b.clientId, b)
const sent = (o: WsAttachmentBinding, b: Attachment) => o.snapshotSent(b.clientId, b)
const violation = { ok: false as const, reason: 'protocol-violation' as const }
const begin = (o: WsAttachmentBinding, c: string, r = c, t = 'target') => {
	const result = o.beginAttach(c, r, t)
	if (!result.ok) throw new Error(result.reason)
	return result.capability
}
const expectViolation = (owner: WsAttachmentBinding, binding: Attachment) =>
	expect(owner.snapshotApplied(binding.clientId, binding)).toEqual(violation)
describe('WsAttachmentBinding', () => {
	afterEach(() => vi.useRealTimers())
	test('locks input until the matching snapshot commits', () => {
		const owner = new WsAttachmentBinding()
		const binding = begin(owner, 'a', 'request-a', 'target-a')
		expect(owner.acceptsInput('a')).toBe(false)
		expect(sent(owner, binding).ok).toBe(true)
		expect(commit(owner, binding).ok).toBe(true)
		expect(owner.acceptsInput('a')).toBe(true)
	})
	test('times out B without restoring committed A', () => {
		vi.useFakeTimers()
		const expired: Attachment[] = []
		const owner = new WsAttachmentBinding({ onTimeout: (binding) => expired.push(binding) })
		const a = begin(owner, 'client', 'a', 'target-a')
		sent(owner, a)
		commit(owner, a)
		const b = begin(owner, 'client', 'b', 'target-b')
		vi.advanceTimersByTime(10_000)
		expect(expired).toHaveLength(0)
		expect(sent(owner, b).ok).toBe(true)
		vi.advanceTimersByTime(9_999)
		expect(owner.getCapability('client', b.attachmentId)).not.toBeNull()
		vi.advanceTimersByTime(1)
		expect(owner.getCapability('client', b.attachmentId)).toBeNull()
		expect(owner.getCapability('client', a.attachmentId)).toMatchObject({ committed: true })
		expect(owner.acceptsInput('client')).toBe(false)
		expect(expired).toEqual([b])
		vi.advanceTimersByTime(10_000)
		expect(expired).toHaveLength(1)
	})
	test('supersedes B, rejects its late ack, and commits C', () => {
		const invalidated: Attachment[] = []
		const owner = new WsAttachmentBinding({ onInvalidate: (binding) => invalidated.push(binding) })
		const a = begin(owner, 'client', 'a')
		sent(owner, a)
		commit(owner, a)
		const b = begin(owner, 'client', 'b')
		const c = begin(owner, 'client', 'c')
		expect(owner.isCurrentAttempt('client', b)).toBe(false)
		expect(sent(owner, b)).toEqual(violation)
		expectViolation(owner, b)
		sent(owner, c)
		expect(commit(owner, c).ok).toBe(true)
		expect(owner.getCapability('client', a.attachmentId)).toBeNull()
		expect(owner.acceptsInput('client')).toBe(true)
		expect(invalidated).toEqual([b, { ...a, committed: true }])
	})
	test('releases committed and provisional capabilities on repeated disconnect/dispose', () => {
		vi.useFakeTimers()
		const owner = new WsAttachmentBinding()
		const a = begin(owner, 'client', 'a')
		sent(owner, a)
		commit(owner, a)
		const b = begin(owner, 'client', 'b')
		sent(owner, b)
		owner.disconnect('client')
		owner.dispose('client')
		owner.disconnect('client')
		expect(owner.getCapability('client', a.attachmentId)).toBeNull()
		expect(owner.getCapability('client', b.attachmentId)).toBeNull()
		expect(vi.getTimerCount()).toBe(0)
	})
	test('keeps IDs global and rejects collision without retry or interchange', () => {
		const owner = new WsAttachmentBinding()
		const a = begin(owner, 'a')
		const b = begin(owner, 'b')
		expect(a.attachmentId).not.toBe(b.attachmentId)
		expect(owner.getCapability('b', a.attachmentId)).toBeNull()
		const id = vi.fn(() => 'same-id')
		const collisionOwner = new WsAttachmentBinding({ idGenerator: id })
		begin(collisionOwner, 'a')
		expect(() => begin(collisionOwner, 'b')).toThrow('collision')
		expect(id).toHaveBeenCalledTimes(2)
	})
	test('rejects mismatched request, attachment, and target IDs', () => {
		const owner = new WsAttachmentBinding()
		const binding = begin(owner, 'client', 'request', 'target')
		const other = begin(owner, 'other', 'other-request', 'other-target')
		expect(owner.snapshotSent('client', other)).toEqual(violation)
		expect(owner.snapshotApplied('client', other)).toEqual(violation)
		for (const patch of [{ requestId: 'wrong' }, { attachmentId: 'wrong' }, { targetId: 'wrong' }])
			expectViolation(owner, { ...binding, ...patch })
		expect(owner.isCurrentAttempt('client', binding)).toBe(true)
		sent(owner, binding)
		expect(commit(owner, binding)).toMatchObject({ ok: true })
	})
	test('rejects a reused request ID without replacing the live attempt', () => {
		const id = vi.fn(() => 'attachment-id')
		const owner = new WsAttachmentBinding({ idGenerator: id })
		const binding = begin(owner, 'client', 'request', 'target')
		expect(owner.beginAttach('client', 'request', 'other')).toEqual(violation)
		expect(id).toHaveBeenCalledTimes(1)
		expect(owner.isCurrentAttempt('client', binding)).toBe(true)
		owner.disconnect('client')
		expect(owner.beginAttach('client', 'request', 'other')).toEqual(violation)
	})
	test('invalidates each capability exactly once on every clear path', () => {
		vi.useFakeTimers()
		const invalidated: Attachment[] = []
		const expired: Attachment[] = []
		const owner = new WsAttachmentBinding({
			onInvalidate: (binding) => invalidated.push(binding),
			onTimeout: (binding) => expired.push(binding),
		})
		const a = begin(owner, 'supersede', 'a')
		const b = begin(owner, 'supersede', 'b')
		expect(invalidated).toEqual([a])
		owner.disconnect('supersede')
		const timeout = begin(owner, 'timeout', 'timeout')
		sent(owner, timeout)
		vi.advanceTimersByTime(10_000)
		expect(invalidated).toEqual([a, b, timeout])
		expect(expired).toEqual([timeout])
		const disposed = begin(owner, 'dispose', 'dispose')
		owner.dispose('dispose')
		expect(invalidated).toEqual([a, b, timeout, disposed])
		const disconnect = begin(owner, 'disconnect', 'disconnect')
		sent(owner, disconnect)
		commit(owner, disconnect)
		const pending = begin(owner, 'disconnect', 'pending')
		owner.disconnect('disconnect')
		expect(invalidated).toEqual([
			a,
			b,
			timeout,
			disposed,
			pending,
			{ ...disconnect, committed: true },
		])
		owner.dispose('disconnect')
		const restart = begin(owner, 'restart', 'restart', 'restart')
		sent(owner, restart)
		commit(owner, restart)
		const restartPending = begin(owner, 'restart-pending', 'pending', 'restart')
		owner.invalidateTarget('restart')
		expect(invalidated).toEqual([
			a,
			b,
			timeout,
			disposed,
			pending,
			{ ...disconnect, committed: true },
			{ ...restart, committed: true },
			restartPending,
		])
		owner.invalidateTarget('restart')
		expect(invalidated).toHaveLength(8)
	})
	test('invalidates matching targets across clients only', () => {
		const owner = new WsAttachmentBinding()
		const shared = begin(owner, 'one', 'one', 'shared')
		sent(owner, shared)
		commit(owner, shared)
		const pending = begin(owner, 'two', 'two', 'shared')
		const other = begin(owner, 'three', 'three', 'other')
		sent(owner, other)
		commit(owner, other)
		owner.invalidateTarget('shared')
		expect(owner.getCapability('one', shared.attachmentId)).toBeNull()
		expect(owner.getCapability('two', pending.attachmentId)).toBeNull()
		expect(owner.acceptsInput('one')).toBe(false)
		expect(owner.getCapability('three', other.attachmentId)).toMatchObject({ committed: true })
		expect(owner.acceptsInput('three')).toBe(true)
	})
})
