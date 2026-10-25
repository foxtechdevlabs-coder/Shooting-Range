#!/usr/bin/env node
/** Run the backend vitest suite from the repo root (cross-platform). */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'backend', 'server')
const vitest = [
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  path.join(root, 'backend', 'node_modules', 'vitest', 'vitest.mjs'),
].find((candidate) => fs.existsSync(candidate))

if (!vitest) {
  console.error('vitest is not installed. Run "npm install" in backend/ first.')
  process.exit(1)
}
execFileSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], { cwd: serverDir, stdio: 'inherit' })
