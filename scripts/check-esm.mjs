#!/usr/bin/env node
// Forbid CJS-isms in ESM main/cli sources. The build silently emits ESM
// and these tokens crash the packaged app at runtime, not at typecheck.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['src/main', 'src/cli', 'src/mcp-server']
const BAD = [
  { re: /\brequire\s*\(/, name: 'require()' },
  { re: /(?<![A-Za-z_$.])__dirname\b/, name: '__dirname' },
  { re: /(?<![A-Za-z_$.])__filename\b/, name: '__filename' }
]
const ALLOW_LINE = /esm-allow/

const violations = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) { walk(full); continue }
    if (!/\.(ts|mts|js|mjs)$/.test(entry)) continue
    const src = readFileSync(full, 'utf8')
    // If a file polyfills __dirname/__filename via fileURLToPath, treat those tokens as resolved.
    const hasDirnamePolyfill = /const\s+__dirname\s*=\s*dirname\(__filename\)/.test(src)
    const hasFilenamePolyfill = /const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\)/.test(src)
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (ALLOW_LINE.test(line)) return
      if (/= fileURLToPath|= dirname\(__filename\)/.test(line)) return
      for (const { re, name } of BAD) {
        if (name === '__dirname' && hasDirnamePolyfill) continue
        if (name === '__filename' && hasFilenamePolyfill) continue
        if (re.test(line)) {
          violations.push(`${full}:${i + 1}  ${name}  →  ${line.trim()}`)
        }
      }
    })
  }
}

for (const root of ROOTS) {
  try { walk(root) } catch { /* missing dir is fine */ }
}

if (violations.length) {
  console.error('[check-esm] Forbidden CJS tokens in ESM sources:')
  for (const v of violations) console.error('  ' + v)
  console.error('\nFix: replace require() with import, and derive __dirname via fileURLToPath(import.meta.url).')
  console.error('If a usage is intentional, add an "esm-allow" comment on the same line.')
  process.exit(1)
}

console.log('[check-esm] OK — no CJS tokens in ESM sources')
