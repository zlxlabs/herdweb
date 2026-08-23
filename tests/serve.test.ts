import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineConfig } from '../src/config'
import { writeSubscriptions } from '../src/notify/push'
import { createNotifyService, notifyDrain } from '../src/notify/service'
import { readLastSessionStore } from '../src/notify/state'
import {
	buildSecurityHeaders,
	describeCommandForLogs,
	extractSessionKey,
	isAllowedOrigin,
	isLoopbackHost,
	parseHostHeader,
	resolveRequestAuthority,
	withSecurityHeaders,
	writeImageDrop,
} from '../src/serve'
import { sleep, spawnProcess } from '../src/util/node-compat'

const repoRoot = join(import.meta.dirname, '..')
const runningProcesses: ReturnType<typeof spawnProcess>[] = []
const tempDirs: string[] = []

afterEach(async () => {
	vi.unstubAllEnvs()
	while (runningProcesses.length > 0) {
		const proc = runningProcesses.pop()
		if (!proc) continue
		proc.kill('SIGINT')
		await proc.exited
	}
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) rmSync(dir, { recursive: true, force: true })
	}
})

async function reservePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	if (!address || typeof address === 'string') {
		server.close()
		throw new Error('failed to reserve test port')
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()))
	})
	return address.port
}

async function waitForHttp(url: string): Promise<void> {
	const deadline = Date.now() + 10_000
	while (Date.now() < deadline) {
		try {
			const statusCode = await requestStatus(url)
			if (statusCode >= 200 && statusCode < 300) return
		} catch {
			// The serve process may still be starting.
		}
		await sleep(100)
	}
	throw new Error(`timed out waiting for ${url}`)
}

function requestStatus(url: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(url, (response) => {
			response.resume()
			response.once('end', () => resolve(response.statusCode ?? 0))
		})
		request.once('error', reject)
		request.end()
	})
}

function requestResource(
	url: string,
): Promise<{ statusCode: number; cacheControl?: string; contentType?: string }> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(url, (response) => {
			response.resume()
			response.once('end', () =>
				resolve({
					statusCode: response.statusCode ?? 0,
					cacheControl: response.headers['cache-control'],
					contentType: response.headers['content-type'],
				}),
			)
		})
		request.once('error', reject)
		request.end()
	})
}

async function startServe(
	asrEnabled: boolean,
	options: { extraArgs?: string[]; dropDir?: string } = {},
): Promise<{ port: number; url: string }> {
	const port = await reservePort()
	const configDir = mkdtempSync(join(tmpdir(), 'herdweb-serve-test-'))
	tempDirs.push(configDir)
	const configPath = join(configDir, 'herdweb.config.ts')
	writeFileSync(
		configPath,
		`export default ${JSON.stringify({
			asr: { enabled: asrEnabled, doubao: { apiKey: 'serve-test-key' } },
		})}`,
	)
	if (options.dropDir !== undefined) tempDirs.push(options.dropDir)
	const proc = spawnProcess(
		[
			'pnpm',
			'exec',
			'tsx',
			'cli.ts',
			'serve',
			'--config',
			configPath,
			'--port',
			String(port),
			...(options.extraArgs ?? []),
			'--',
			'bash',
			'--norc',
			'--noprofile',
		],
		{
			cwd: repoRoot,
			stdin: 'ignore',
			stdout: 'ignore',
			stderr: 'ignore',
			env: { ...process.env, ...(options.dropDir ? { TMPDIR: options.dropDir } : {}) },
		},
	)
	runningProcesses.push(proc)
	const url = `http://127.0.0.1:${port}`
	await waitForHttp(url)
	return { port, url }
}

describe('isLoopbackHost', () => {
	test('accepts loopback hosts', () => {
		expect(isLoopbackHost('127.0.0.1')).toBe(true)
		expect(isLoopbackHost('::1')).toBe(true)
		expect(isLoopbackHost('localhost')).toBe(true)
	})

	test('rejects non-loopback hosts', () => {
		expect(isLoopbackHost('0.0.0.0')).toBe(false)
		expect(isLoopbackHost('192.168.1.10')).toBe(false)
	})
})

describe('isAllowedOrigin', () => {
	test('allows matching origin and host', () => {
		expect(isAllowedOrigin('https://term.example.ts.net', 'term.example.ts.net')).toBe(true)
		expect(isAllowedOrigin('http://localhost:7681', 'localhost:7681')).toBe(true)
		expect(isAllowedOrigin('https://[fd7a:115c:a1e0::1]:8443', '[fd7a:115c:a1e0::1]:8443')).toBe(
			true,
		)
	})

	test('rejects mismatched or invalid origins', () => {
		expect(isAllowedOrigin('https://evil.example', 'localhost:7681')).toBe(false)
		expect(isAllowedOrigin('not a url', 'localhost:7681')).toBe(false)
		expect(isAllowedOrigin('https://term.example.ts.net', undefined)).toBe(false)
	})

	test('allows requests without an origin header on loopback', () => {
		expect(isAllowedOrigin(undefined, 'localhost:7681')).toBe(true)
		expect(isAllowedOrigin(undefined, '127.0.0.1:7681')).toBe(true)
	})

	test('rejects requests without an origin header on non-loopback', () => {
		expect(isAllowedOrigin(undefined, 'term.example.ts.net')).toBe(false)
		expect(isAllowedOrigin(undefined, '0.0.0.0:7681')).toBe(false)
		expect(isAllowedOrigin(undefined, undefined)).toBe(false)
	})
})

describe('parseHostHeader', () => {
	test('accepts plain hosts and host:port authorities', () => {
		expect(parseHostHeader('term.example.ts.net')).toBe('term.example.ts.net')
		expect(parseHostHeader('localhost:7681')).toBe('localhost:7681')
		expect(parseHostHeader('[::1]:7681')).toBe('[::1]:7681')
	})

	test('rejects malformed host headers', () => {
		expect(parseHostHeader(undefined)).toBeNull()
		expect(parseHostHeader('')).toBeNull()
		expect(parseHostHeader('bad host')).toBeNull()
		expect(parseHostHeader('evil.example/path')).toBeNull()
		expect(parseHostHeader('::1:7681')).toBeNull()
		expect(parseHostHeader('localhost:not-a-port')).toBeNull()
	})
})

describe('resolveRequestAuthority', () => {
	test('prefers the request host over the backend listen address', () => {
		expect(resolveRequestAuthority('127.0.0.1:19000', '127.0.0.1', 17685)).toBe('127.0.0.1:19000')
	})

	test('falls back to the listen host when the request host is missing or invalid', () => {
		expect(resolveRequestAuthority(undefined, '127.0.0.1', 17685)).toBe('127.0.0.1:17685')
		expect(resolveRequestAuthority('bad host', '127.0.0.1', 17685)).toBe('127.0.0.1:17685')
		expect(resolveRequestAuthority(undefined, '::1', 17685)).toBe('[::1]:17685')
	})
})

describe('buildSecurityHeaders', () => {
	test('scopes connect-src to the browser-facing request host:port', () => {
		const headers = buildSecurityHeaders('127.0.0.1:19000', '127.0.0.1', 17685, 'nonce-123')
		const csp = headers['content-security-policy']
		expect(csp).toContain('ws://127.0.0.1:19000')
		expect(csp).toContain('wss://127.0.0.1:19000')
		expect(csp).toContain("script-src 'self' 'nonce-nonce-123'")
		expect(csp).toContain("style-src 'self' 'unsafe-inline' https:")
		expect(csp).not.toMatch(/\bws:\b(?!\/\/)/)
		expect(csp).not.toMatch(/\bwss:\b(?!\/\/)/)
	})

	test('falls back to the listen host:port when the request host is invalid', () => {
		const headers = buildSecurityHeaders('bad host', '192.168.1.10', 7681, 'nonce-123')
		const csp = headers['content-security-policy']
		expect(csp).toContain('ws://192.168.1.10:7681')
		expect(csp).toContain('wss://192.168.1.10:7681')
	})

	test('does not grant microphone or Doubao access when ASR is disabled', () => {
		const headers = buildSecurityHeaders('127.0.0.1:7681', '127.0.0.1', 7681, 'nonce-123', false)
		expect(headers['content-security-policy']).toBe(
			"default-src 'self'; script-src 'self' 'nonce-nonce-123'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7681 wss://127.0.0.1:7681; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
		)
		expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
		expect(headers['content-security-policy']).not.toContain('*')
		expect(headers['content-security-policy']).not.toMatch(/\bwss:(?:\s|;|$)/)
	})

	test('grants only microphone and the Doubao origin when ASR is enabled', () => {
		const headers = buildSecurityHeaders('127.0.0.1:7681', '127.0.0.1', 7681, 'nonce-123', true)
		expect(headers['content-security-policy']).toBe(
			"default-src 'self'; script-src 'self' 'nonce-nonce-123'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7681 wss://127.0.0.1:7681 wss://openspeech.bytedance.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
		)
		expect(headers['permissions-policy']).toBe('camera=(), microphone=(self), geolocation=()')
		expect(headers['content-security-policy']).not.toContain('*')
		expect(headers['content-security-policy']).not.toMatch(/\bwss:(?:\s|;|$)/)
	})
})

describe('withSecurityHeaders', () => {
	test('adds hardening headers without dropping existing ones', async () => {
		const securityHeaders = buildSecurityHeaders('127.0.0.1:7681', '127.0.0.1', 7681, 'nonce-123')
		const response = withSecurityHeaders(
			new Response('ok', {
				headers: { 'content-type': 'text/plain' },
				status: 200,
			}),
			securityHeaders,
		)

		expect(response.headers.get('content-type')).toBe('text/plain')
		expect(response.headers.get('x-frame-options')).toBe('DENY')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('referrer-policy')).toBe('no-referrer')
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
		expect(response.headers.get('permissions-policy')).toContain('camera=()')
		expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
		expect(response.headers.get('content-security-policy')).toContain(
			"script-src 'self' 'nonce-nonce-123'",
		)
		expect(response.headers.get('content-security-policy')).toContain('ws://127.0.0.1:7681')
		expect(await response.text()).toBe('ok')
	})
})

describe('serve document route', () => {
	test('does not allow enabled-ASR HTML to be cached', async () => {
		const { url } = await startServe(true)
		const response = await requestResource(url)

		expect(response.statusCode).toBe(200)
		expect(response.cacheControl).toBe('private, no-store')
		expect(response.contentType).toBe('text/html; charset=UTF-8')
	})

	test('serves the worklet only when ASR is enabled', async () => {
		const { url } = await startServe(true)
		const response = await requestResource(`${url}/asr-worklet.js`)

		expect(response.statusCode).toBe(200)
		expect(response.contentType).toBe('text/javascript')
	})

	test('does not serve the worklet when ASR is disabled', async () => {
		const { url } = await startServe(false)
		const response = await requestResource(`${url}/asr-worklet.js`)

		expect(response.statusCode).toBe(404)
	})
})

describe('describeCommandForLogs', () => {
	test('omits argv contents from log output', () => {
		expect(describeCommandForLogs(['bash', '-lc', 'echo secret-token'])).toBe('bash (2 args)')
	})

	test('handles single-word commands', () => {
		expect(describeCommandForLogs(['tmux'])).toBe('tmux')
	})
})

describe('extractSessionKey (serve re-export)', () => {
	test('delegates to health helper', () => {
		expect(extractSessionKey(['herdr', '--session', 'dev'])).toBe('dev')
	})
})

describe('notifyDrain shutdown', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
		stateDir = undefined
		vi.useRealTimers()
	})

	test('waits for in-flight push before returning', async () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		let resolvePush!: () => void
		const sendPush = vi.fn().mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolvePush = resolve
				}),
		)
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		notifyService.dispatchEvent({
			v: 1,
			id: 'drain-1',
			kind: 'done',
			title: 'T',
			ts: 1,
		})
		const drainPromise = notifyDrain(notifyService)
		await sleep(50)
		expect(sendPush).toHaveBeenCalled()
		resolvePush()
		await drainPromise
		notifyService.dispose()
	})

	test('returns after 10s when push hangs', async () => {
		vi.useFakeTimers()
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-drain-'))
		writeSubscriptions(stateDir, [
			{
				endpoint: 'https://push.example/ok',
				keys: { p256dh: 'k', auth: 'a' },
				lastSuccessAt: 0,
			},
		])
		const sendPush = vi.fn().mockImplementation(() => new Promise<void>(() => {}))
		const notifyService = createNotifyService({ stateDir, historyLimit: 200, sendPush })
		notifyService.dispatchEvent({
			v: 1,
			id: 'drain-2',
			kind: 'done',
			title: 'T',
			ts: 1,
		})
		const drainPromise = notifyDrain(notifyService)
		await vi.advanceTimersByTimeAsync(10_000)
		await drainPromise
		notifyService.dispose()
	})
})

describe('serve health on PTY exit', () => {
	test('writes last-session.json after short-lived bash session', async () => {
		const port = await reservePort()
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-serve-'))
		tempDirs.push(stateDir)
		const configDir = mkdtempSync(join(tmpdir(), 'herdweb-serve-health-cfg-'))
		tempDirs.push(configDir)
		const configPath = join(configDir, 'herdweb.config.ts')
		writeFileSync(configPath, 'export default { asr: { enabled: false } }')
		vi.stubEnv('XDG_STATE_HOME', join(stateDir, 'state-root'))
		const proc = spawnProcess(
			[
				'pnpm',
				'exec',
				'tsx',
				'cli.ts',
				'serve',
				'--config',
				configPath,
				'--port',
				String(port),
				'--',
				'bash',
				'--norc',
				'-c',
				'exit 0',
			],
			{ cwd: repoRoot, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
		)
		await proc.exited
		const store = readLastSessionStore(join(stateDir, 'state-root', 'herdweb', String(port)))
		expect(store.default?.exitCode).toBe(0)
	})

	test('disposes terminal session after PTY exit', async () => {
		const disposeMock = vi.fn().mockResolvedValue(undefined)
		vi.doMock('../src/session', async (importOriginal) => {
			const mod = await importOriginal<typeof import('../src/session')>()
			class TrackedSession extends mod.SharedTerminalSession {
				override async dispose(): Promise<void> {
					disposeMock()
					await super.dispose()
				}
			}
			return { ...mod, SharedTerminalSession: TrackedSession }
		})
		const port = await reservePort()
		const stateDir = mkdtempSync(join(tmpdir(), 'herdweb-health-dispose-'))
		tempDirs.push(stateDir)
		const configDir = mkdtempSync(join(tmpdir(), 'herdweb-serve-dispose-cfg-'))
		tempDirs.push(configDir)
		const configPath = join(configDir, 'herdweb.config.ts')
		writeFileSync(configPath, 'export default { asr: { enabled: false } }')
		vi.stubEnv('XDG_STATE_HOME', join(stateDir, 'state-root'))
		const { serve } = await import('../src/serve')
		await serve(defineConfig({ asr: { enabled: false } }), port, ['bash', '--norc', '-c', 'exit 0'])
		expect(disposeMock).toHaveBeenCalled()
		vi.doUnmock('../src/session')
	}, 30_000)
})

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x03, 0x04])
const WEBP_BYTES = Buffer.from('RIFF\0\0\0\0WEBPvp8-payload')
const GIF_BYTES = Buffer.from('GIF89a gif payload')

function postImageDrop(
	url: string,
	body: Buffer,
	headers: Record<string, string> = {},
): Promise<{ statusCode: number; cacheControl?: string; body: string }> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			url,
			{ method: 'POST', headers: { 'content-length': body.length, ...headers } },
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (chunk: Buffer) => chunks.push(chunk))
				response.once('end', () =>
					resolve({
						statusCode: response.statusCode ?? 0,
						cacheControl: response.headers['cache-control'],
						body: Buffer.concat(chunks).toString('utf-8'),
					}),
				)
			},
		)
		request.once('error', reject)
		request.end(body.length > 0 ? body : undefined)
	})
}
describe('image drop upload', () => {
	test('stores the four formats byte-for-byte (0600, no-store) and rejects bad uploads', async () => {
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-test-'))
		const { url } = await startServe(false, { dropDir })
		const endpoint = `${url}/api/image-drop`
		const cases = [
			['png', PNG_BYTES],
			['jpeg', JPEG_BYTES],
			['webp', WEBP_BYTES],
			['gif', GIF_BYTES],
		] as const
		for (const [format, bytes] of cases) {
			const response = await postImageDrop(endpoint, bytes)
			expect(response.statusCode).toBe(200)
			expect(response.cacheControl).toBe('no-store')
			const result: { path: string; format: string; size: number } = JSON.parse(response.body)
			expect(result.format).toBe(format)
			expect(result.size).toBe(bytes.length)
			expect(result.path.startsWith(`${dropDir}/`)).toBe(true)
			expect(readFileSync(result.path)).toEqual(bytes)
			expect(statSync(result.path).mode & 0o777).toBe(0o600)
		}
		// Client Content-Type is untrusted: GIF bytes labeled image/png are stored as GIF.
		const forged = await postImageDrop(endpoint, GIF_BYTES, { 'content-type': 'image/png' })
		expect(JSON.parse(forged.body)).toMatchObject({ format: 'gif' })
		expect((await postImageDrop(endpoint, Buffer.alloc(0))).statusCode).toBe(400)
		const heic = await postImageDrop(endpoint, Buffer.from('\0\0\0\x18ftypheic\0\0\0\0'))
		expect(heic.statusCode).toBe(415)
		expect(heic.body).toContain('HEIC')
		expect((await postImageDrop(endpoint, Buffer.from('not an image'))).statusCode).toBe(415)
		const crossOrigin = await postImageDrop(endpoint, PNG_BYTES, { origin: 'https://evil.example' })
		expect(crossOrigin.statusCode).toBe(403)
		// Only the five accepted uploads landed; rejected uploads left nothing behind. (TMPDIR also
		// holds the child process's node-compile-cache, so count only herdweb-drop-* files.)
		expect(readdirSync(dropDir).filter((name) => name.startsWith('herdweb-drop-'))).toHaveLength(5)
	})

	test('is reachable under a configured base path', async () => {
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-test-'))
		const { url } = await startServe(false, { dropDir, extraArgs: ['--base-path', '/herdweb'] })
		const response = await postImageDrop(`${url}/herdweb/api/image-drop`, PNG_BYTES)
		expect(response.statusCode).toBe(200)
		expect(JSON.parse(response.body).format).toBe('png')
	})

	test('writeImageDrop removes only its own partial file when the write fails', async () => {
		const dropDir = mkdtempSync(join(tmpdir(), 'herdweb-drop-test-'))
		tempDirs.push(dropDir)
		vi.stubEnv('TMPDIR', dropDir)
		const probe = await open(join(dropDir, 'probe'), 'w')
		const writeFileSpy = vi
			.spyOn(Object.getPrototypeOf(probe), 'writeFile')
			.mockRejectedValueOnce(new Error('injected image drop write failure'))
		await probe.close()
		await expect(writeImageDrop(PNG_BYTES, 'png')).rejects.toThrow(
			'injected image drop write failure',
		)
		writeFileSpy.mockRestore()
		rmSync(join(dropDir, 'probe'))
		expect(readdirSync(dropDir)).toEqual([])
	})
})
