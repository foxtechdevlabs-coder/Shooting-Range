#!/usr/bin/env node
/**
 * Compile the Electron main + preload (desktop/*.cts) to CommonJS.
 * Output: desktop/dist/main.cjs, desktop/dist/preload.cjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveTsc, root } from './tsc-path.mjs'
const desktopDir = path.join(root, 'desktop')
const distDir = path.join(desktopDir, 'dist')

console.log('[build:desktop] cleaning', path.relative(root, distDir))
fs.rmSync(distDir, { recursive: true, force: true })

console.log('[build:desktop] compiling TypeScript')
execFileSync(process.execPath, [resolveTsc('build:desktop'), '-p', 'tsconfig.json'], {
  cwd: desktopDir,
  stdio: 'inherit',
})

for (const expected of ['main.cjs', 'preload.cjs']) {
  const file = path.join(distDir, expected)
  if (!fs.existsSync(file)) {
    console.error(`[build:desktop] FAILED: ${expected} was not produced`)
    process.exit(1)
  }
}
console.log('[build:desktop] ok →', fs.readdirSync(distDir).join(', '))
