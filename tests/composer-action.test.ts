import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createAsrPreview } from '../src/controls/asr-preview'
import { _resetTouchGuard } from '../src/util/tap'
beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	_resetTouchGuard()
	GlobalRegistrator.unregister()
})
test('composer action persists the locked pending fields', () => {
	const composer = createAsrPreview({ defaultTargetId: 'default' })
	composer.input.value = 'hello'
	const pending = {
		id: 'action-1',
		sessionId: 'session-1',
		sourceText: 'hello',
		data: 'hello\r',
		status: 'pending' as const,
	}
	expect(composer.setPending(pending)).toBe(true)
	expect(JSON.parse(localStorage.getItem('herdweb:composer:v1:/:default') ?? '{}').pending).toEqual(
		pending,
	)
})
