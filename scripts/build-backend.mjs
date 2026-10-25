#!/usr/bin/env node
/**
 * Compile the Express backend to backend/server/dist and copy the SQL
 * migrations next to the compiled JS (tsc does not copy .sql files).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveTsc, root } from './tsc-path.mjs'
const serverDir = path.join(root, 'backend', 'server')
const distDir = path.join(serverDir, 'dist')
const migrationsFrom = path.join(serverDir, 'src', 'db', 'migrations')
const migrationsTo = path.join(distDir, 'server', 'src', 'db', 'migrations')

console.log('[build:backend] cleaning', path.relative(root, distDir))
fs.rmSync(distDir, { recursive: true, force: true })

console.log('[build:backend] compiling TypeScript')
execFileSync(process.execPath, [resolveTsc('build:backend'), '-p', 'tsconfig.json'], {
  cwd: serverDir,
  stdio: 'inherit',
})

console.log('[build:backend] copying SQL migrations')
fs.mkdirSync(migrationsTo, { recursive: true })
for (const file of fs.readdirSync(migrationsFrom)) {
  if (file.endsWith('.sql')) fs.copyFileSync(path.join(migrationsFrom, file), path.join(migrationsTo, file))
}

// Tests are compiled too; they are excluded from the installer but keep the build lean.
const testsDir = path.join(distDir, 'server', 'src', 'tests')
if (fs.existsSync(testsDir)) fs.rmSync(testsDir, { recursive: true, force: true })

const entry = path.join(distDir, 'server', 'src', 'index.js')
if (!fs.existsSync(entry)) {
  console.error('[build:backend] FAILED: compiled entry missing at', entry)
  process.exit(1)
}
console.log('[build:backend] ok →', path.relative(root, entry))
