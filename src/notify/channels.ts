import type { NotifyChannel } from '../types'
import { type NotifyEvent, type NotifyKind, isRecord } from './events'

const KIND_LABELS: Record<NotifyKind, string> = {
	asking: '等待输入',
	done: '完成',
	'ci-red': 'CI 失败',
	silence: '可能完工或卡住',
	health: '服务状态',
	test: '测试',
}

const CHANNEL_TIMEOUT_MS = 10_000

function formatHost(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return 'invalid-url'
	}
}

function channelLabel(channel: NotifyChannel): string {
	return channel.type
}

function formatChannelError(error: unknown): string {
	if (error instanceof Error && error.name.length > 0) return error.name
	if (typeof error === 'object' && error !== null && 'name' in error) {
		const { name } = error
		if (typeof name === 'string' && name.length > 0) return name
	}
	return 'Error'
}

function channelLogLine(
	channel: NotifyChannel,
	event: NotifyEvent,
	host: string,
	result: 'delivered' | 'failed',
	detail: string,
): string {
	return `herdweb: notify channel ${channelLabel(channel)} ${result} → ${host} (${detail}) kind=${event.kind} id=${event.id}`
}

async function readWecomErrcode(response: Response): Promise<number | undefined> {
	let text: string
	try {
		text = await response.text()
	} catch {
		return undefined
	}
	try {
		const parsed: unknown = JSON.parse(text)
		if (
			!isRecord(parsed) ||
			typeof parsed.errcode !== 'number' ||
			!Number.isFinite(parsed.errcode)
		) {
			return undefined
		}
		return parsed.errcode
	} catch {
		return undefined
	}
}

export function buildNotifyContent(event: NotifyEvent): string {
	const lines = [`【${KIND_LABELS[event.kind]}】${event.title}`]
	if (event.v === 2) lines.push(`目标：${event.targetId}`)
	if (event.body !== undefined) lines.push(event.body)
	if (event.session !== undefined && !event.body?.includes(event.session)) {
		lines.push(`会话：${event.session}`)
	}
	if (event.reason !== undefined) lines.push(`原因：${event.reason}`)
	return lines.join('\n')
}

function requestForChannel(channel: NotifyChannel, event: NotifyEvent, content: string): Request {
	const body =
		channel.type === 'message-pusher'
			? {
					title: event.title,
					desp: event.body ?? '',
					content,
					token: channel.token,
				}
			: channel.type === 'wecom'
				? { msgtype: 'text', text: { content } }
				: event

	const target =
		channel.type === 'message-pusher'
			? `${channel.url.replace(/\/+$/, '')}/push/${encodeURIComponent(channel.user)}`
			: channel.url
	const headers =
		channel.type === 'webhook'
			? { ...channel.headers, 'content-type': 'application/json' }
			: { 'content-type': 'application/json' }

	return new Request(target, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS),
	})
}

async function deliverChannel(
	channel: NotifyChannel,
	event: NotifyEvent,
	content: string,
): Promise<void> {
	const host = formatHost(channel.url)
	try {
		const response = await fetch(requestForChannel(channel, event, content))
		if (response.ok) {
			if (channel.type === 'wecom') {
				const errcode = await readWecomErrcode(response)
				if (errcode !== undefined && errcode !== 0) {
					console.log(channelLogLine(channel, event, host, 'failed', `errcode=${errcode}`))
					return
				}
			}
			console.log(channelLogLine(channel, event, host, 'delivered', String(response.status)))
			return
		}
		console.log(channelLogLine(channel, event, host, 'failed', String(response.status)))
	} catch (error: unknown) {
		console.log(channelLogLine(channel, event, host, 'failed', formatChannelError(error)))
	}
}

export async function sendNotifyChannels(
	channels: readonly NotifyChannel[],
	event: NotifyEvent,
): Promise<void> {
	if (channels.length === 0) return
	const content = buildNotifyContent(event)
	await Promise.allSettled(channels.map((channel) => deliverChannel(channel, event, content)))
}
