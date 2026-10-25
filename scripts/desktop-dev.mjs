#!/usr/bin/env node
/**
 * `npm run desktop:dev` - runs the backend, the Vite dev server and Electron
 * together for local development.
 *
 *   backend : tsx watch  -> http://127.0.0.1:3001
 *   frontend: Vite       -> http://localhost:5173
 *   electron: loads the Vite URL (the backend is NOT started twice)
 *
 * In this mode native modules run under plain Node, so no Electron rebuild is
 * needed for day-to-day work. The packaged app starts the backend in-process.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = []
let shuttingDown = false

function run(name, command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...options })
  children.push(child)
  const prefix = (line) => `[${name}] ${line}`
  child.stdout?.on('data', (data) => String(data).split(/\r?\n/).filter(Boolean).forEach((line) => console.log(prefix(line))))
  child.stderr?.on('data', (data) => String(data).split(/\r?\n/).filter(Boolean).forEach((line) => console.error(prefix(line))))
  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(prefix(`exited with code ${code}`))
    shutdown(code ?? 0)
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try { child.kill() } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 300)
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status < 500) return true
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function electronBinary() {
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
    path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    console.error('[desktop] Electron is not installed. Run "npm install" at the repo root first.')
    process.exit(1)
  }
  return found
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3001/api/health'
const devUrl = process.env.ELECTRON_START_URL ?? 'http://localhost:5173'

console.log('[desktop:dev] starting backend...')
run('backend', npm, ['--prefix', 'backend/server', 'run', 'dev'])

console.log('[desktop:dev] starting frontend...')
run('frontend', npm, ['--prefix', 'frontend', 'run', 'dev'])

const [apiReady, uiReady] = await Promise.all([waitFor(apiUrl), waitFor(devUrl)])
if (!apiReady) console.warn('[desktop:dev] backend did not answer on /api/health - starting Electron anyway')
if (!uiReady) { console.error('[desktop:dev] frontend dev server did not start'); shutdown(1) }

console.log('[desktop:dev] launching Electron against', devUrl)
const electron = run('electron', electronBinary(), ['.'], { env: { ...process.env, ELECTRON_START_URL: devUrl } })
electron.on('exit', (code) => shutdown(code ?? 0))
