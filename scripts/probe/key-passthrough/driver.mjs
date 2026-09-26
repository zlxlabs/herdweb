import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import pty from 'node-pty'

const [session, pane, resultDir, tempDir, reader, repoRoot, prefix] = process.argv.slice(2)
const modes = ['none', 'kitty-1', 'kitty-9', 'modify-other-keys-2']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cases = [
	['alt-up', 'csi-1-3-a', '1b5b313b3341'],
	['alt-up', 'esc-esc-csi-a', '1b1b5b41'],
	['alt-up', 'csi-u', '1b5b313b3375'],
	['shift-enter', 'csi-u', '1b5b31333b3275'],
	['shift-enter', 'modify-other-keys', '1b5b32373b323b31337e'],
	['shift-enter', 'lf-control', '0a'],
	['alt-enter', 'esc-cr', '1b0d'],
	['alt-enter', 'csi-u', '1b5b31333b3375'],
	...[
		['comma', '2c'],
		['period', '2e'],
		['p', '70'],
	].flatMap(([key, code]) => [
		[`alt-${key}`, 'esc-prefix', `1b${code}`],
		[`alt-${key}`, 'csi-u', Buffer.from(`\x1b[${Number.parseInt(code, 16)};3u`).toString('hex')],
	]),
	['shift-tab', 'backtab', '1b5b5a'],
	['shift-tab', 'csi-u', '1b5b393b3275'],
	['ctrl-space', 'nul', '00'],
	['ctrl-space', 'csi-u', '1b5b33323b3575'],
	['f3', 'ss3-r', '1b4f52'],
	['f4', 'ss3-s', '1b4f53'],
	['f8', 'csi-19-tilde', '1b5b31397e'],
	['ctrl-home', 'csi-1-5-h', '1b5b313b3548'],
	['ctrl-end', 'csi-1-5-f', '1b5b313b3546'],
	['ctrl-t', 'control-byte', '14'],
	['ctrl-o', 'control-byte', '0f'],
	['esc-esc', 'chord', '1b1b'],
	['esc-esc', 'kitty-csi-u-pair', '1b5b3237751b5b323775'],
].map(([key, candidate, hex]) => ({
	key,
	candidate,
	hex,
	bytes: Buffer.from(hex, 'hex'),
	split: hex.startsWith('1b') && hex.length > 2,
}))

function call(args, input) {
	const out = spawnSync('herdr', ['--session', session, ...args], {
		cwd: repoRoot,
		input,
		encoding: 'utf8',
	})
	if (out.error) throw out.error
	if (out.status !== 0)
		throw new Error(`herdr ${args.join(' ')} failed (${out.status}): ${out.stderr}`)
	return out.stdout
}
function relative(start) {
	return Number(process.hrtime.bigint() - BigInt(start))
}
function writeHexLine(file, groups) {
	fs.appendFileSync(
		file,
		`${groups.map(([at, bytes]) => `+${at}:${bytes.toString('hex')}`).join(' | ')} ; `,
	)
}
function bytesInWindow(events, start, end) {
	return Buffer.from(
		events.filter((event) => event.at >= start && event.at < end).map((event) => event.byte),
	)
}
function classify(expected, received) {
	if (expected.equals(received)) return 'original'
	return received.length ? 'rewritten' : 'not-received'
}
function parseDump(file) {
	if (!fs.existsSync(file)) return []
	return [...fs.readFileSync(file, 'utf8').matchAll(/\+(\d+):([0-9a-f]{2})/g)].map((match) => ({
		at: Number(match[1]),
		byte: Number.parseInt(match[2], 16),
	}))
}
function processInfo() {
	const payload = JSON.parse(call(['pane', 'process-info', '--pane', pane]))
	return payload.result.process_info.foreground_processes
}
async function waitReaderGone(pid) {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (!processInfo().some((process) => process.pid === pid)) return
		await sleep(100)
	}
	throw new Error(`reader PID ${pid} remained in pane after 2 seconds`)
}
function ctrlPrefixByte(value) {
	const match = /^ctrl\+([a-z])$/i.exec(value)
	return match ? Buffer.from([match[1].toLowerCase().charCodeAt(0) - 96]) : null
}

const matrix = { version: 1, cases: [], modes: [], agents: [], known_interception: null }
const prefixByte = ctrlPrefixByte(prefix)

function findExecutable(name) {
	for (const directory of process.env.PATH.split(path.delimiter)) {
		const candidate = path.join(directory, name)
		if (fs.existsSync(candidate) && fs.statSync(candidate).mode & 0o111) return candidate
	}
	throw new Error(`${name} is not installed in PATH`)
}

function protocolSequences(bytes) {
	const text = bytes.toString('latin1')
	const pattern = new RegExp(
		`${String.fromCharCode(27)}\\[(?:[>=][0-9;]*u|>[0-9;]*m|\\?[0-9;]*[hl])`,
		'g',
	)
	return [...text.matchAll(pattern)].map((match) => Buffer.from(match[0], 'latin1'))
}

async function captureAgent(name) {
	const binary = findExecutable(name)
	const transcript = path.join(tempDir, `agent-${name}.raw`)
	const command = `timeout --signal=KILL 3s ${binary}`
	const started = process.hrtime.bigint()
	const child = spawn('script', ['-q', '-f', '-c', command, transcript], {
		cwd: repoRoot,
		env: { ...process.env, TERM: 'xterm-256color' },
		stdio: ['pipe', 'ignore', 'ignore'],
	})
	const exit = await new Promise((resolve, reject) => {
		const watchdog = setTimeout(() => child.kill('SIGKILL'), 8000)
		child.once('error', (error) => {
			clearTimeout(watchdog)
			reject(error)
		})
		child.once('exit', (code, signal) => {
			clearTimeout(watchdog)
			resolve({ code, signal })
		})
	})
	child.stdin.destroy()
	const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6
	if (elapsed_ms < 2900)
		throw new Error(`${name} startup capture ended early (${elapsed_ms.toFixed(0)}ms)`)
	const capture = fs.readFileSync(transcript)
	fs.unlinkSync(transcript)
	if (capture.length === 0) throw new Error(`${name} produced no startup bytes in its script PTY`)
	const sequences = protocolSequences(capture)
	const dump = path.join(resultDir, `agent-${name}.hex`)
	fs.writeFileSync(
		dump,
		sequences.length
			? `${sequences.map((bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')).join(' ; ')}\n`
			: '',
	)
	return {
		name,
		binary,
		capture_ms: 3000,
		elapsed_ms: Math.round(elapsed_ms),
		script_exit: exit.code,
		script_signal: exit.signal,
		startup_bytes: capture.length,
		sequence_count: sequences.length,
		dump: path.basename(dump),
	}
}

for (const mode of modes) {
	const slug = mode
	const receivedPath = path.join(resultDir, `received-${slug}.hex`)
	const sentPath = path.join(resultDir, `sent-${slug}.hex`)
	const readyPath = path.join(tempDir, `ready-${slug}.json`)
	const donePath = path.join(tempDir, `done-${slug}`)
	for (const file of [receivedPath, sentPath]) fs.writeFileSync(file, '')

	let screen = ''
	let clientExit
	const client = pty.spawn('herdr', ['--session', session], {
		name: 'xterm-256color',
		cols: 120,
		rows: 40,
		cwd: repoRoot,
		env: { ...process.env, TERM: 'xterm-256color' },
	})
	client.onData((data) => {
		screen += data
	})
	client.onExit((event) => {
		clientExit = event
	})
	for (let i = 0; i < 100 && screen.length === 0; i++) {
		if (clientExit) throw new Error(`herdr client exited before drawing (${clientExit.exitCode})`)
		await sleep(50)
	}
	if (screen.length === 0) throw new Error('herdr client produced no terminal output')

	const command = [process.execPath, reader, receivedPath, readyPath, donePath, mode]
	call(['pane', 'run', pane, ...command])
	for (let i = 0; i < 100 && !fs.existsSync(readyPath); i++) {
		if (clientExit)
			throw new Error(`herdr client exited while reader started (${clientExit.exitCode})`)
		await sleep(50)
	}
	if (!fs.existsSync(readyPath)) throw new Error(`reader did not report ready for ${mode}`)
	const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'))
	if (ready.mode !== mode || ready.raw !== true)
		throw new Error(`reader readiness contract failed for ${mode}`)
	const processes = processInfo()
	if (!processes.some((process) => process.pid === ready.pid && process.argv.includes(reader)))
		throw new Error(`reader PID ${ready.pid} is not the active pane process`)
	await sleep(160)

	const modeCases = []
	const send = async (label, payload, split = false, kind = 'candidate', splitMs = 20) => {
		const start = relative(ready.start_ns)
		const writes = []
		const part = (bytes) => {
			const at = relative(ready.start_ns)
			const input = bytes.toString('latin1')
			const wire = Buffer.from(input, 'utf8')
			if (!wire.equals(bytes))
				throw new Error(
					`PTY input encoding changed ${bytes.toString('hex')} to ${wire.toString('hex')}`,
				)
			client.write(input)
			writes.push([at, wire])
		}
		if (split) {
			part(payload.subarray(0, 1))
			await sleep(splitMs)
			part(payload.subarray(1))
		} else part(payload)
		const middle = relative(ready.start_ns)
		await sleep(kind === 'health' ? 90 : 130)
		const end = relative(ready.start_ns)
		writeHexLine(sentPath, writes)
		const item = {
			mode,
			label,
			kind,
			expected_hex: payload.toString('hex'),
			split,
			split_ms: split ? splitMs : null,
			start_ns: start,
			middle_ns: middle,
			end_ns: end,
			sent_group: modeCases.length + 1,
		}
		modeCases.push(item)
		return item
	}
	const sentinel = Buffer.from('a')
	const baselineA = await send('baseline-a', sentinel, false, 'baseline')
	const baselineCtrlT = await send('baseline-ctrl-t', Buffer.from([0x14]), false, 'baseline')
	if (mode === 'none' && prefixByte) {
		const intercepted = await send(
			`configured-prefix-${prefix}`,
			prefixByte,
			false,
			'interception-control',
		)
		const cancel = await send('cancel-prefix', Buffer.from([0x1b]), false, 'interception-control')
		matrix.known_interception = { prefix, intercepted, cancel }
	}

	for (const test of cases) {
		const event = await send(`${test.key}/${test.candidate}/once`, test.bytes)
		event.key = test.key
		event.candidate = test.candidate
		event.delivery = 'once'
		const healthOnce = await send(
			`health-after/${test.key}/${test.candidate}/once`,
			sentinel,
			false,
			'health',
		)
		healthOnce.key = test.key
		healthOnce.candidate = test.candidate
		if (test.split) {
			const splitEvent = await send(`${test.key}/${test.candidate}/split-20ms`, test.bytes, true)
			splitEvent.key = test.key
			splitEvent.candidate = test.candidate
			splitEvent.delivery = 'split-20ms'
			const healthSplit = await send(
				`health-after/${test.key}/${test.candidate}/split-20ms`,
				sentinel,
				false,
				'health',
			)
			healthSplit.key = test.key
			healthSplit.candidate = test.candidate
			if (test.key === 'esc-esc' && test.candidate === 'chord') {
				const delayedSplit = await send(
					`${test.key}/${test.candidate}/split-100ms`,
					test.bytes,
					true,
					'candidate',
					100,
				)
				delayedSplit.key = test.key
				delayedSplit.candidate = test.candidate
				delayedSplit.delivery = 'split-100ms'
				const delayedHealth = await send(
					`health-after/${test.key}/${test.candidate}/split-100ms`,
					sentinel,
					false,
					'health',
				)
				delayedHealth.key = test.key
				delayedHealth.candidate = test.candidate
			}
		}
	}

	await sleep(100)
	process.kill(ready.pid, 'SIGTERM')
	for (let i = 0; i < 100 && !fs.existsSync(donePath); i++) await sleep(20)
	if (!fs.existsSync(donePath))
		throw new Error(`reader PID ${ready.pid} did not restore terminal state`)
	const done = JSON.parse(fs.readFileSync(donePath, 'utf8'))
	if (
		done.restore_hex.replaceAll(' ', '') !==
			(mode.startsWith('kitty-')
				? '1b5b3c75'
				: mode === 'modify-other-keys-2'
					? '1b5b3e346e'
					: '') ||
		done.raw !== false
	)
		throw new Error(`reader PID ${ready.pid} failed to restore terminal state`)
	await waitReaderGone(ready.pid)
	client.kill()
	for (let i = 0; i < 100 && !clientExit; i++) await sleep(20)
	if (!clientExit) throw new Error('herdr client did not exit after SIGTERM')

	const events = parseDump(receivedPath)
	const used = new Set()
	for (const item of modeCases) {
		const received = bytesInWindow(events, item.start_ns, item.end_ns)
		item.received_hex = received.toString('hex')
		item.outcome = classify(Buffer.from(item.expected_hex, 'hex'), received)
		if (item.outcome !== 'not-received') {
			for (let i = 0; i < events.length; i++)
				if (events[i].at >= item.start_ns && events[i].at < item.end_ns) used.add(i)
		}
		matrix.cases.push(item)
	}
	const unmatched = events
		.filter((_, i) => !used.has(i))
		.map((event) => ({ at_ns: event.at, byte: event.byte.toString(16).padStart(2, '0') }))
	const healthResults = modeCases.filter((item) => item.kind === 'health')
	if (healthResults.some((item) => item.outcome === 'not-received'))
		throw new Error(`reader health marker disappeared in ${mode}`)
	if (unmatched.length)
		throw new Error(`unattributed pane input in ${mode}: ${JSON.stringify(unmatched)}`)
	if (mode === 'none' && (baselineA.outcome !== 'original' || baselineCtrlT.outcome !== 'original'))
		throw new Error('no-protocol baseline did not preserve a and Ctrl+T')
	matrix.modes.push({
		mode,
		request_hex: ready.request_hex,
		restore_hex: done.restore_hex,
		received_file: path.basename(receivedPath),
		sent_file: path.basename(sentPath),
		client_output_bytes: Buffer.byteLength(screen),
		unmatched,
		baseline: { a: baselineA.outcome, ctrl_t: baselineCtrlT.outcome },
		health_count: healthResults.length,
		health_received_count:
			healthResults.length - healthResults.filter((item) => item.outcome === 'not-received').length,
	})
}

for (const name of ['codex', 'claude', 'pi']) matrix.agents.push(await captureAgent(name))
fs.writeFileSync(path.join(resultDir, 'matrix.txt'), `${JSON.stringify(matrix)}\n`)
