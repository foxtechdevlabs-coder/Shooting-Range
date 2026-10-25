import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Values injected by the host process (the Electron main process) so that a
 * packaged build never falls back to paths relative to this file — which would
 * live inside app.asar / the install folder.
 */
export interface RuntimeConfig {
  host?: string
  port?: number
  dataDir?: string
  dbPath?: string
  staticDir?: string | null
  printScriptPath?: string
  appVersion?: string
  packaged?: boolean
}

let runtime: RuntimeConfig = {}

/**
 * Apply runtime overrides. Safe to call before any DB/service is opened.
 * Creates the data directory tree so callers can rely on it existing.
 */
export function configureRuntime(overrides: RuntimeConfig): void {
  runtime = { ...runtime, ...overrides }
  fs.mkdirSync(config.dataDir, { recursive: true })
  for (const folder of ['backups', 'labels', 'logs']) {
    fs.mkdirSync(path.join(config.dataDir, folder), { recursive: true })
  }
}

/** Read back the applied overrides (used by tests and the desktop shell). */
export function getRuntimeConfig(): Readonly<RuntimeConfig> {
  return runtime
}

/**
 * Data directory resolution order (first match wins):
 *   1. startServer({ dataDir })  → configureRuntime()
 *   2. SHOOTINGRANGE_DATA_DIR env var
 *   3. DATA_DIR env var (legacy/testing)
 *   4. <repo>/data  (development default next to the compiled server)
 */
function resolveDataDir(): string {
  const fromEnv = process.env.SHOOTINGRANGE_DATA_DIR ?? process.env.DATA_DIR
  if (runtime.dataDir) return path.resolve(runtime.dataDir)
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(__dirname, '../../data')
}

function firstDefinedNumber(...values: Array<string | number | undefined>): number | undefined {
  for (const value of values) {
    if (value === undefined || value === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export const config = {
  get host(): string {
    return runtime.host ?? process.env.HOST ?? '127.0.0.1'
  },
  get port(): number {
    return firstDefinedNumber(runtime.port, process.env.PORT) ?? 3001
  },
  /** Port to try first; the server falls back to any free port if it is taken. */
  get preferredPort(): number {
    return firstDefinedNumber(process.env.PORT, 3001) ?? 3001
  },
  get dataDir(): string {
    return resolveDataDir()
  },
  get dbPath(): string {
    if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH)
    return path.join(this.dataDir, 'shootingrange.db')
  },
  get backupsDir(): string {
    return path.join(this.dataDir, 'backups')
  },
  get labelsDir(): string {
    return path.join(this.dataDir, 'labels')
  },
  get logsDir(): string {
    return path.join(this.dataDir, 'logs')
  },
  /** Folder holding the built frontend (SPA). Empty in development. */
  get staticDir(): string | null {
    if (runtime.staticDir !== undefined) return runtime.staticDir ? path.resolve(runtime.staticDir) : null
    const fromEnv = process.env.STATIC_DIR
    return fromEnv ? path.resolve(fromEnv) : null
  },
  /** print-spool.ps1 must be a real file on disk (never inside app.asar). */
  get printScriptPath(): string {
    return runtime.printScriptPath ?? process.env.PRINT_SCRIPT_PATH ?? path.join(__dirname, '..', 'services', 'print-spool.ps1')
  },
  get appVersion(): string {
    return runtime.appVersion ?? process.env.APP_VERSION ?? '1.0.0'
  },
  get packaged(): boolean {
    return runtime.packaged ?? process.env.APP_PACKAGED === 'true'
  },
  isProduction: process.env.NODE_ENV === 'production',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-secret-change-in-production',
  sessionMaxAgeDays: 7,
  loginRateLimitWindowMs: 5 * 60 * 1000, // 5 minutes
  loginRateLimitMax: 5,
  uploadRateLimitWindowMs: 60 * 1000,
  uploadRateLimitMax: 10,
}

/** Ensure the standard data sub-folders exist (idempotent). */
export function ensureDataFolders(): void {
  for (const folder of [config.dataDir, config.backupsDir, config.labelsDir, config.logsDir]) {
    fs.mkdirSync(folder, { recursive: true })
  }
}
