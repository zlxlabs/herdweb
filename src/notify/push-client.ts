import { joinBasePath } from '../base-path'
import { isRecord } from './events'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = atob(base64)
	const output = new Uint8Array(raw.length)
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i)
	}
	return output
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
	if (buffer === null) return ''
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function vapidApplicationServerKey(base64: string): ArrayBuffer {
	const bytes = urlBase64ToUint8Array(base64)
	const buffer = new ArrayBuffer(bytes.length)
	new Uint8Array(buffer).set(bytes)
	return buffer
}

export function serializePushSubscription(
	subscription: Pick<PushSubscription, 'endpoint' | 'getKey'>,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
	return {
		endpoint: subscription.endpoint,
		keys: {
			p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
			auth: arrayBufferToBase64(subscription.getKey('auth')),
		},
	}
}

function applicationServerKeyMatches(
	currentKey: ArrayBuffer | null,
	serverKey: ArrayBuffer,
): boolean {
	if (currentKey === null) return true
	const currentBytes = new Uint8Array(currentKey)
	const serverBytes = new Uint8Array(serverKey)
	return (
		currentBytes.length === serverBytes.length &&
		currentBytes.every((byte, index) => byte === serverBytes[index])
	)
}

async function reconcile(basePath: string, fetchFn: typeof fetch): Promise<void> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
	if (!('serviceWorker' in navigator)) return

	const registration = await navigator.serviceWorker.getRegistration(basePath)
	if (!registration) return
	const currentSubscription = await registration.pushManager.getSubscription()
	if (!currentSubscription) return

	const keyResponse = await fetchFn(joinBasePath(basePath, '/api/push/vapid-key'))
	if (!keyResponse.ok) {
		throw new Error(`VAPID key request failed (${keyResponse.status})`)
	}
	const keyBody: unknown = await keyResponse.json()
	if (!isRecord(keyBody) || typeof keyBody.publicKey !== 'string') {
		throw new Error('invalid VAPID key response')
	}
	const applicationServerKey = vapidApplicationServerKey(keyBody.publicKey)
	let subscription = currentSubscription
	if (
		!applicationServerKeyMatches(
			currentSubscription.options.applicationServerKey,
			applicationServerKey,
		)
	) {
		await currentSubscription.unsubscribe()
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey,
		})
		const deleteResponse = await fetchFn(joinBasePath(basePath, '/api/push/subscription'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: currentSubscription.endpoint }),
		})
		if (!deleteResponse.ok) {
			throw new Error(`old push subscription delete failed (${deleteResponse.status})`)
		}
	}

	const subscribeResponse = await fetchFn(joinBasePath(basePath, '/api/push/subscribe'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(serializePushSubscription(subscription)),
	})
	if (!subscribeResponse.ok) {
		throw new Error(`push subscription registration failed (${subscribeResponse.status})`)
	}
}

export async function reconcilePushSubscription(
	basePath: string,
	fetchFn: typeof fetch = fetch.bind(globalThis),
): Promise<void> {
	try {
		await reconcile(basePath, fetchFn)
	} catch (error) {
		console.error('herdweb: push reconcile failed', error)
	}
}
