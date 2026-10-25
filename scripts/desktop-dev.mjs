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
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const npm = isWindows ? 'npm.cmd' : 'npm'
const children = []
let shuttingDown = false

/**
 * Windows can only start npm.cmd through a shell, and with a shell Node joins
 * the argument array into one command line without quoting. Any argument that
 * contains a space (for example an install path like "C:\Program Files\...")
 * therefore has to be quoted here by hand.
 */
function quoteForShell(value) {
  const text = String(value)
  return /[\s"]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

function run(name, command, args, options = {}) {
  const useShell = Boolean(options.shell)
  const child = spawn(command, useShell ? args.map(quoteForShell) : args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    shell: useShell,
  })
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

function killTree(child) {
  // On Windows child.kill() only ends the shell that started npm.cmd, leaving
  // vite/tsx running; taskkill /T /F ends the whole tree.
  if (isWindows && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch { /* already gone */ }
  }
  try { child.kill() } catch { /* already gone */ }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
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
    // A real executable: spawned directly, no shell, so spaces in the path are safe.
    { file: path.join(root, 'node_modules', 'electron', 'dist', isWindows ? 'electron.exe' : 'electron'), shell: false },
    // Windows shim: .cmd/.bat can only be started through cmd.exe.
    { file: path.join(root, 'node_modules', '.bin', isWindows ? 'electron.cmd' : 'electron'), shell: isWindows },
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate.file))
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
run('backend', npm, ['--prefix', 'backend/server', 'run', 'dev'], { shell: isWindows })

console.log('[desktop:dev] starting frontend...')
run('frontend', npm, ['--prefix', 'frontend', 'run', 'dev'], { shell: isWindows })

const [apiReady, uiReady] = await Promise.all([waitFor(apiUrl), waitFor(devUrl)])
if (!apiReady) console.warn('[desktop:dev] backend did not answer on /api/health - starting Electron anyway')
if (!uiReady) { console.error('[desktop:dev] frontend dev server did not start'); shutdown(1) }

console.log('[desktop:dev] launching Electron against', devUrl)
// Spawned without a shell so a repo path containing spaces stays one argument.
const electron = electronBinary()
const electronChild = run('electron', electron.file, ['.'], {
  shell: electron.shell,
  env: { ...process.env, ELECTRON_START_URL: devUrl },
})
electronChild.on('exit', (code) => shutdown(code ?? 0))
