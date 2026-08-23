import { join } from 'node:path'
import webpush from 'web-push'
import { ensureStateDir, readJsonFile, writeJsonFileAtomic } from './state'

const VAPID_FILE = 'vapid.json'
const SUBSCRIPTIONS_FILE = 'push-subscriptions.json'

export interface VapidConfig {
	readonly subject?: string
	readonly publicKey?: string
	readonly privateKey?: string
}

export interface VapidKeys {
	readonly publicKey: string
	readonly privateKey: string
	readonly subject: string
}

export interface PushSubscriptionRecord {
	readonly endpoint: string
	readonly keys: { readonly p256dh: string; readonly auth: string }
	lastSuccessAt: number
}

/** Ensure VAPID keys exist on disk; config override wins for rotation. */
export function ensureVapidKeys(stateDir: string, override?: VapidConfig): VapidKeys {
	ensureStateDir(stateDir)
	const path = join(stateDir, VAPID_FILE)
	const subject = override?.subject ?? 'mailto:herdweb@localhost'

	if (override?.publicKey && override?.privateKey) {
		const keys: VapidKeys = {
			publicKey: override.publicKey,
			privateKey: override.privateKey,
			subject,
		}
		writeJsonFileAtomic(path, keys, 0o600)
		return keys
	}

	const existing = readJsonFile<VapidKeys>(path)
	if (existing?.publicKey && existing?.privateKey) {
		return { ...existing, subject: existing.subject ?? subject }
	}

	const generated = webpush.generateVAPIDKeys()
	const keys: VapidKeys = {
		publicKey: generated.publicKey,
		privateKey: generated.privateKey,
		subject,
	}
	writeJsonFileAtomic(path, keys, 0o600)
	return keys
}

export function readSubscriptions(stateDir: string): PushSubscriptionRecord[] {
	const path = join(stateDir, SUBSCRIPTIONS_FILE)
	const data = readJsonFile<PushSubscriptionRecord[]>(path)
	return Array.isArray(data) ? data : []
}

export function writeSubscriptions(stateDir: string, records: PushSubscriptionRecord[]): void {
	const path = join(stateDir, SUBSCRIPTIONS_FILE)
	writeJsonFileAtomic(path, records, 0o644)
}

export function subscriptionsPath(stateDir: string): string {
	return join(stateDir, SUBSCRIPTIONS_FILE)
}

export const STALE_SUBSCRIPTION_MS = 90 * 24 * 60 * 60 * 1000
