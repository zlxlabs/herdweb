import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeClientBundle, writeSwBundle, writeWorkletBundle } from '../build'

const distDir = resolve(import.meta.dirname, '..', 'dist')
mkdirSync(distDir, { recursive: true })
await writeClientBundle(distDir)
await writeSwBundle(distDir)
await writeWorkletBundle(distDir)
