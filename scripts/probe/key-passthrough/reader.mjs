import fs from 'node:fs'

const [dumpPath, readyPath, donePath, mode] = process.argv.slice(2)
const requests = {
	none: ['', ''],
	'kitty-1': ['\x1b[>1u', '\x1b[<u'],
	'kitty-9': ['\x1b[>9u', '\x1b[<u'],
	'modify-other-keys-2': ['\x1b[>4;2m', '\x1b[>4n'],
}
if (!(mode in requests)) throw new Error(`unknown mode: ${mode}`)

const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
const [request, restore] = requests[mode].map((value) => Buffer.from(value))
process.stdin.setRawMode(true)
if (!process.stdin.isRaw) throw new Error('stdin did not enter raw mode')
const start = process.hrtime.bigint()
if (request.length && fs.writeSync(1, request) !== request.length)
	throw new Error('short protocol request write')

process.stdin.on('data', (bytes) => {
	const at = (process.hrtime.bigint() - start).toString()
	fs.appendFileSync(
		dumpPath,
		`${[...bytes].map((byte) => `+${at}:${byte.toString(16).padStart(2, '0')}`).join(' ')} `,
	)
})

fs.writeFileSync(
	readyPath,
	JSON.stringify({
		pid: process.pid,
		start_ns: start.toString(),
		mode,
		raw: process.stdin.isRaw,
		request_hex: hex(request),
	}),
)
const stop = () => {
	if (restore.length && fs.writeSync(1, restore) !== restore.length) {
		fs.writeFileSync(donePath, JSON.stringify({ pid: process.pid, restore: 'failed' }))
		process.exit(1)
	}
	process.stdin.setRawMode(false)
	fs.writeFileSync(
		donePath,
		JSON.stringify({ pid: process.pid, restore_hex: hex(restore), raw: process.stdin.isRaw }),
	)
	process.exit()
}
process.once('SIGTERM', stop)
