/// <reference lib="webworker" />
import { type NotifyEvent, isRecord } from './notify/events'

/** Build an absolute URL from the service worker scope. */
export function resolveScopeUrl(scope: string, path: string): string {
	const base = scope.endsWith('/') ? scope : `${scope}/`
	const relative = path.startsWith('/') ? path.slice(1) : path
	return new URL(relative, base).toString()
}

/** Show a notification from a parsed push event. */
export function showPushNotification(
	registration: ServiceWorkerRegistration,
	event: NotifyEvent,
): Promise<void> {
	const tag = event.session ? `${event.kind}:${event.session}` : event.kind
	return registration.showNotification(event.title, {
		body: event.body,
		tag,
		data: event,
	})
}

/** Focus an existing window or open the app scope. */
export async function handleNotificationClick(
	clients: Pick<Clients, 'matchAll' | 'openWindow'>,
	scope: string,
): Promise<void> {
	const matched = await clients.matchAll({ type: 'window', includeUncontrolled: true })
	if (matched.length > 0) {
		const first = matched[0]
		if (first) {
			await first.focus()
		}
		return
	}
	await clients.openWindow(scope)
}

/** Re-subscribe after pushsubscriptionchange: fetch VAPID key, replace server record. */
export async function handlePushSubscriptionChange(
	registration: ServiceWorkerRegistration,
	scope: string,
	fetchFn: typeof fetch,
): Promise<void> {
	const previousSub = await registration.pushManager.getSubscription()
	const previousEndpoint = previousSub?.endpoint

	const keyResponse = await fetchFn(resolveScopeUrl(scope, 'api/push/vapid-key'))
	if (!keyResponse.ok) return
	const keyBody: unknown = await keyResponse.json()
	const publicKey = readPublicKey(keyBody)
	if (publicKey === undefined) return

	const applicationServerKey = vapidApplicationServerKey(publicKey)
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey,
	})

	if (previousEndpoint) {
		await fetchFn(resolveScopeUrl(scope, 'api/push/subscription'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: previousEndpoint }),
		}).catch(() => {})
	}

	const subscribeResponse = await fetchFn(resolveScopeUrl(scope, 'api/push/subscribe'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			endpoint: subscription.endpoint,
			keys: {
				p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
				auth: arrayBufferToBase64(subscription.getKey('auth')),
			},
		}),
	})
	if (!subscribeResponse.ok) {
		await subscription.unsubscribe().catch(() => {})
		throw new Error(`subscribe failed: ${subscribeResponse.status}`)
	}
}

function readPublicKey(value: unknown): string | undefined {
	if (!isRecord(value) || typeof value.publicKey !== 'string') return undefined
	return value.publicKey
}

function isNotifyEventPayload(value: unknown): value is NotifyEvent {
	if (!isRecord(value)) return false
	return (
		value.v === 1 &&
		typeof value.id === 'string' &&
		typeof value.kind === 'string' &&
		typeof value.title === 'string' &&
		typeof value.ts === 'number' &&
		Number.isFinite(value.ts)
	)
}

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

function vapidApplicationServerKey(base64: string): ArrayBuffer {
	const bytes = urlBase64ToUint8Array(base64)
	const buffer = new ArrayBuffer(bytes.length)
	new Uint8Array(buffer).set(bytes)
	return buffer
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

function installHandlers(self: ServiceWorkerGlobalScope): void {
	self.addEventListener('install', () => {
		// v1: no skipWaiting — new workers activate on next navigation.
	})

	self.addEventListener('activate', () => {
		// no-op
	})

	self.addEventListener('push', (event: PushEvent) => {
		const data = event.data?.text()
		if (!data) return
		let parsed: unknown
		try {
			parsed = JSON.parse(data)
		} catch {
			return
		}
		if (!isNotifyEventPayload(parsed)) return
		event.waitUntil(showPushNotification(self.registration, parsed))
	})

	self.addEventListener('notificationclick', (event: NotificationEvent) => {
		event.notification.close()
		const scope = self.registration.scope
		event.waitUntil(handleNotificationClick(self.clients, scope))
	})

	self.addEventListener('pushsubscriptionchange', (event: ExtendableEvent) => {
		const scope = self.registration.scope
		event.waitUntil(handlePushSubscriptionChange(self.registration, scope, self.fetch.bind(self)))
	})
}

declare const self: ServiceWorkerGlobalScope
installHandlers(self)
