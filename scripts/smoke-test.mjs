#!/usr/bin/env node
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const APP_BINARY = join(
  process.cwd(),
  'release/mac-arm64/Monet.app/Contents/MacOS/Monet'
)

if (!existsSync(APP_BINARY)) {
  console.error(`[smoke] Packaged binary not found: ${APP_BINARY}`)
  process.exit(1)
}

const FATAL = /(ReferenceError|TypeError|SyntaxError|Cannot find module|require is not defined|__dirname is not defined|__filename is not defined|UnhandledPromiseRejection|originated either by throwing inside of an async function)/

const BOOT_WINDOW_MS = 12000

console.log(`[smoke] Booting ${APP_BINARY} for ${BOOT_WINDOW_MS}ms…`)

const child = spawn(APP_BINARY, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, MONET_SMOKE_TEST: '1' }
})

let buffer = ''
let failed = null

const onChunk = (chunk) => {
  const text = chunk.toString()
  buffer += text
  process.stdout.write(text)
  const m = text.match(FATAL)
  if (m && !failed) failed = m[0]
}

child.stdout.on('data', onChunk)
child.stderr.on('data', onChunk)

const timer = setTimeout(() => {
  child.kill('SIGTERM')
  setTimeout(() => child.kill('SIGKILL'), 2000)
}, BOOT_WINDOW_MS)

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  if (failed) {
    console.error(`\n[smoke] FAIL — detected fatal pattern: ${failed}`)
    process.exit(1)
  }
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    console.log(`\n[smoke] OK — app survived ${BOOT_WINDOW_MS}ms with no fatal errors`)
    process.exit(0)
  }
  if (code !== 0 && code !== null) {
    console.error(`\n[smoke] FAIL — app exited with code ${code} before timeout`)
    process.exit(1)
  }
  console.log(`\n[smoke] OK — app exited cleanly`)
  process.exit(0)
})
