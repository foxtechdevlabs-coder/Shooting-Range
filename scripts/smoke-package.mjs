#!/usr/bin/env node
/**
 * Packaged-app smoke test (run on Windows after "npm run dist").
 *
 * Launches release/win-unpacked/Shooting Range System.exe exactly like a user
 * would, but with
 *   - a throw-away data folder (SHOOTINGRANGE_DATA_DIR=<temp>)
 *   - a free port (PORT=<free>)
 * so the real data folder under %APPDATA% is never touched.
 *
 * Checks
 *   1. the process starts and GET /api/health answers within 90 s
 *   2. GET /api/setup/status reports needsSetup = true (fresh data folder)
 *   3. the SQLite database was created inside the temporary data folder
 *   4. the app closes gracefully and writes a shutdown backup
 *   5. the log contains no "Cannot find module" / startup error
 *
 * On failure the full app log plus the process stdout/stderr are printed and
 * the script exits with code 1.
 *
 * Usage: npm run smoke:package
 * Output text is plain ASCII only (Windows console safe).
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXE_NAME = 'Shooting Range System.exe'
const exePath = path.join(root, 'release', 'win-unpacked', EXE_NAME)
const HEALTH_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 1_000
const GRACEFUL_EXIT_TIMEOUT_MS = 30_000

const ascii = (value) => String(value).replace(/[^\x20-\x7E\n]/g, '?')

function log(message) {
  console.log(ascii(`[smoke] ${message}`))
}

function fail(message, extra) {
  console.error(ascii(`[smoke] FAIL: ${message}`))
  if (extra) console.error(ascii(extra))
  process.exitCode = 1
}

function tailFile(file, lines = 40) {
  if (!fs.existsSync(file)) return `(no log file at ${file})`
  const content = fs.readFileSync(file, 'utf8')
  const rows = content.trimEnd().split(/\r?\n/)
  return rows.slice(-lines).join('\n')
}

function wholeFile(file) {
  if (!fs.existsSync(file)) return `(no log file at ${file})`
  return fs.readFileSync(file, 'utf8')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function getJson(url, timeoutMs = 2_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 200)
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Close a Windows GUI app the way a user does (WM_CLOSE), then escalate. */
function requestGracefulClose(child) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore' })
      return 'taskkill (WM_CLOSE)'
    } catch {
      // fall through to the signal below
    }
  }
  try {
    child.kill('SIGTERM')
    return 'SIGTERM'
  } catch {
    return 'none (process already gone)'
  }
}

async function main() {
  log(`node ${process.version} on ${process.platform} ${process.arch}`)

  if (process.platform !== 'win32') {
    fail('this smoke test must run on Windows (it launches the packaged .exe)')
    return
  }
  if (!fs.existsSync(exePath)) {
    fail(`packaged app not found at ${path.relative(root, exePath)}`, 'Run "npm run dist" first.')
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sr-smoke-${stamp}-`))
  const dataDir = path.join(tempRoot, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const logFile = path.join(dataDir, 'logs', 'app.log')
  const dbFile = path.join(dataDir, 'shootingrange.db')
  const backupDir = path.join(dataDir, 'backups')
  const port = await freePort()
  // A private Chromium profile keeps the single-instance lock (and every
  // Electron cache) away from the profile of a running copy of the app.
  const profileDir = path.join(tempRoot, 'profile')
  fs.mkdirSync(profileDir, { recursive: true })

  log(`data folder: ${dataDir}`)
  log(`port: ${port}`)

  const started = Date.now()
  const child = spawn(exePath, [`--user-data-dir=${profileDir}`], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
      SHOOTINGRANGE_DATA_DIR: dataDir,
      PORT: String(port),
      // Keep Electron quiet and out of any proxy / update paths.
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

  let exitedEarly = false
  let exitInfo = ''
  child.on('exit', (code, signal) => {
    exitedEarly = true
    exitInfo = `exit code ${code}, signal ${signal}`
  })

  const baseUrl = `http://127.0.0.1:${port}`
  let healthy = false
  let lastError = 'no attempt yet'

  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    if (exitedEarly) break
    try {
      const health = await getJson(`${baseUrl}/api/health`)
      if (health.status === 200 && health.body && health.body.ok === true) {
        healthy = true
        break
      }
      lastError = `unexpected /api/health response: ${health.status} ${JSON.stringify(health.body)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(POLL_INTERVAL_MS)
  }

  const startupSeconds = ((Date.now() - started) / 1000).toFixed(1)
  const problems = []

  if (!healthy) {
    problems.push(
      exitedEarly
        ? `the app exited before answering /api/health (${exitInfo})`
        : `/api/health did not answer within ${HEALTH_TIMEOUT_MS / 1000}s (last error: ${lastError})`,
    )
  } else {
    log(`backend answered /api/health after ${startupSeconds}s`)
  }

  // 2. first-run state
  if (healthy) {
    try {
      const status = await getJson(`${baseUrl}/api/setup/status`)
      if (status.status === 200 && status.body && status.body.needsSetup === true) {
        log(`setup status ok: needsSetup=true, version=${status.body.version ?? 'n/a'}`)
      } else {
        problems.push(`expected needsSetup=true, received ${status.status} ${JSON.stringify(status.body)}`)
      }
    } catch (error) {
      problems.push(`GET /api/setup/status failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 3. the app must be using the temporary data folder
    if (fs.existsSync(dbFile)) {
      log(`database created at ${dbFile}`)
    } else {
      problems.push(`database was not created at ${dbFile} (is SHOOTINGRANGE_DATA_DIR honoured?)`)
    }
    if (fs.existsSync(logFile)) {
      log(`log created at ${logFile}`)
    } else {
      problems.push(`no log file at ${logFile}`)
    }
  }

  // 4. graceful shutdown + shutdown backup
  if (!exitedEarly) {
    const how = requestGracefulClose(child)
    log(`requested graceful close via ${how}`)
    const closeStart = Date.now()
    while (!exitedEarly && Date.now() - closeStart < GRACEFUL_EXIT_TIMEOUT_MS) {
      await delay(500)
    }
    if (!exitedEarly) {
      problems.push(`the app did not exit within ${GRACEFUL_EXIT_TIMEOUT_MS / 1000}s of a close request`)
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        else child.kill('SIGKILL')
      } catch { /* already gone */ }
    } else {
      log(`app exited (${exitInfo}) after ${((Date.now() - closeStart) / 1000).toFixed(1)}s`)
    }

    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []
    const shutdownBackup = backups.find((name) => name.includes('shutdown'))
    if (shutdownBackup) {
      log(`shutdown backup written: ${shutdownBackup}`)
    } else {
      problems.push(`no shutdown backup in ${backupDir} (found: ${backups.join(', ') || 'none'})`)
    }
  }

  // 5. log must be free of startup errors
  if (fs.existsSync(logFile)) {
    const logText = fs.readFileSync(logFile, 'utf8')
    const badPatterns = ['Cannot find module', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'is not a function', 'EADDRINUSE']
    const hits = badPatterns.filter((pattern) => logText.includes(pattern))
    if (hits.length > 0) problems.push(`log contains startup errors: ${hits.join(', ')}`)
    const errorLines = logText
      .split(/\r?\n/)
      .filter((line) => line.includes('"level":"error"'))
      .slice(-10)
    if (errorLines.length > 0) problems.push(`log has ${errorLines.length} error line(s), last: ${errorLines.at(-1)}`)
  }

  if (problems.length === 0) {
    log('PASS - all smoke checks passed')
    log('--- last 15 log lines ---')
    console.log(ascii(tailFile(logFile, 15)))
    log(`temp data folder left for inspection: ${tempRoot}`)
    return
  }

  fail(`${problems.length} problem(s):\n - ${problems.join('\n - ')}`)
  console.error('\n--- full app log ---')
  console.error(ascii(wholeFile(logFile)))
  console.error('\n--- process stdout ---')
  console.error(ascii(stdout || '(empty)'))
  console.error('\n--- process stderr ---')
  console.error(ascii(stderr || '(empty)'))
  console.error(ascii(`\nTemp data folder: ${tempRoot}`))
  process.exitCode = 1
}

await main()
