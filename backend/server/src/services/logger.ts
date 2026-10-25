/**
 * Rotating file logger (NFR-11 support logs).
 *
 * Writes to <dataDir>/logs/app.log with 5 files × 5 MB maximum.
 * Never log passwords, session ids, tokens or full request bodies:
 * callers pass identifiers only, and `sanitize()` strips known secret keys.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const SECRET_KEYS = /pass(word)?|session|token|secret|cookie|authorization/i

export type LogLevel = 'info' | 'warn' | 'error'

let logFilePath: string | null = null

export function logsDirectory(): string {
  return config.logsDir
}

function activeLogFile(): string {
  if (!logFilePath) logFilePath = path.join(logsDirectory(), 'app.log')
  return logFilePath
}

function rotateIfNeeded(file: string): void {
  let size = 0
  try {
    size = fs.statSync(file).size
  } catch {
    return
  }
  if (size < MAX_BYTES) return

  // app.log → app.1.log → app.2.log … dropping the oldest.
  for (let index = MAX_FILES - 1; index >= 1; index--) {
    const from = index === 1 ? file : file.replace(/\.log$/, `.${index - 1}.log`)
    const to = file.replace(/\.log$/, `.${index}.log`)
    if (fs.existsSync(from)) {
      try { fs.renameSync(from, to) } catch { /* best effort */ }
    }
  }
}

/** Remove obviously sensitive values from structured metadata. */
function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEYS.test(key)) { clean[key] = '[redacted]'; continue }
    if (value instanceof Error) {
      clean[key] = { name: value.name, message: value.message }
      continue
    }
    if (value && typeof value === 'object') {
      clean[key] = sanitize(value as Record<string, unknown>)
      continue
    }
    clean[key] = value
  }
  return clean
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: sanitize(meta) } : {}),
  })
  try {
    const file = activeLogFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    rotateIfNeeded(file)
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  } catch (error) {
    // Never let logging break the app; fall back to stderr.
    console.error('[LOG-WRITE-FAILED]', error instanceof Error ? error.message : error)
  }
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) { write('info', message, meta) },
  warn(message: string, meta?: Record<string, unknown>) { write('warn', message, meta) },
  error(message: string, meta?: Record<string, unknown>) { write('error', message, meta) },
  /** Absolute path of the current log file, for the "backend failed" dialog. */
  currentLogFile: activeLogFile,
}
