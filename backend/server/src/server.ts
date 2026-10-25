/**
 * Embeddable server entry point.
 *
 * `startServer()` is side-effect free until called, so the Electron main process
 * can run the backend in-process on a chosen port and data folder:
 *
 *   const server = await startServer({ port: 3001, dataDir, staticDir, appVersion })
 *   server.port      // actual port (3001, or a free port if 3001 was taken)
 *   await server.stop()
 *
 * The development CLI lives in index.ts and is a thin wrapper around this.
 */
import fs from 'node:fs'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { config, configureRuntime, ensureDataFolders, type RuntimeConfig } from './config.js'
import { closeDb } from './db/connection.js'
import { migrateWithBackup, type MigrationOutcome } from './db/preMigrationBackup.js'
import { pendingMigrations, runMigrations } from './db/migrate.js'
import { runShutdownBackup, startAutoBackup, stopAutoBackup } from './services/autoBackup.js'
import { logger } from './services/logger.js'

export interface StartServerOptions extends RuntimeConfig {
  /** Preferred port; if it is taken, any free port is used instead. */
  port?: number
  host?: string
  /** Ignore the preferred port entirely and let the OS assign one. */
  anyPort?: boolean
}

export interface RunningServer {
  port: number
  host: string
  url: string
  dataDir: string
  dbPath: string
  migration: MigrationOutcome
  /** Graceful shutdown backup (10 s budget), safe to call repeatedly. */
  runShutdownBackup: (timeoutMs?: number) => Promise<void>
  /** Close HTTP keep-alive connections, stop timers, checkpoint + close SQLite. */
  stop: () => Promise<void>
}

function listenOn(app: ReturnType<typeof createApp>, host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host)
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  configureRuntime({
    host: options.host,
    port: options.port,
    dataDir: options.dataDir,
    dbPath: options.dbPath,
    staticDir: options.staticDir,
    printScriptPath: options.printScriptPath,
    appVersion: options.appVersion,
    packaged: options.packaged,
  })
  ensureDataFolders()

  // Must be read before the SQLite connection opens (which creates the file).
  const databaseExistedBeforeStartup = fs.existsSync(config.dbPath)

  logger.info('Starting backend', {
    version: config.appVersion,
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    packaged: config.packaged,
  })

  // ── Migrations (with pre-migration backup + restore on failure) ────────────
  const migration = await migrateWithBackup(config.appVersion, runMigrations, pendingMigrations, {
    databaseExistedBeforeStartup,
  })
  if (migration.applied.length > 0) {
    logger.info('Applied migrations', { applied: migration.applied, backup: migration.backup?.path ?? null })
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  const app = createApp({ staticDir: config.staticDir })
  const host = options.host ?? config.host
  const preferred = options.anyPort ? 0 : firstDefined(options.port, config.preferredPort)

  let server: Server
  let boundPort: number
  try {
    server = await listenOn(app, host, preferred)
    const address = server.address()
    boundPort = typeof address === 'object' && address ? address.port : preferred
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE' && preferred !== 0) {
      logger.warn('Preferred port in use, falling back to any free port', { preferred })
      server = await listenOn(app, host, 0)
      const address = server.address()
      boundPort = typeof address === 'object' && address ? address.port : 0
    } else {
      logger.error('Failed to bind HTTP server', { code: code ?? 'UNKNOWN', preferred })
      throw error
    }
  }

  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}`
  console.log(`[SERVER] Listening on ${url}`)
  console.log(`[SERVER] Database: ${config.dbPath}`)
  logger.info('Backend listening', { url, dbPath: config.dbPath })

  try {
    startAutoBackup()
  } catch (error) {
    logger.warn('Automatic backup scheduler failed to start', { error })
  }

  let stopping: Promise<void> | undefined
  let shutdownBackup: Promise<void> | undefined

  async function runShutdownBackupWithTimeout(timeoutMs = 10_000): Promise<void> {
    // Guard against running twice (window close + before-quit + session-end).
    if (shutdownBackup) return shutdownBackup
    shutdownBackup = (async () => {
      const timer = new Promise<void>((resolve) => {
        const handle = setTimeout(() => {
          logger.warn('Shutdown backup timed out; continuing shutdown', { timeoutMs })
          resolve()
        }, timeoutMs)
        handle.unref?.()
      })
      try {
        await Promise.race([
          (async () => { await runShutdownBackup() })(),
          timer,
        ])
      } catch (error) {
        logger.error('Shutdown backup failed', { error })
      }
    })()
    return shutdownBackup
  }

  async function stop(): Promise<void> {
    if (stopping) return stopping
    stopping = (async () => {
      try { await stopAutoBackup() } catch (error) { logger.warn('Auto-backup stop failed', { error }) }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
      try { closeDb() } catch (error) { logger.warn('Failed to close database cleanly', { error }) }
      logger.info('Backend stopped')
    })()
    return stopping
  }

  return {
    port: boundPort,
    host,
    url,
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    migration,
    runShutdownBackup: runShutdownBackupWithTimeout,
    stop,
  }
}

function firstDefined(...values: Array<number | undefined>): number {
  for (const value of values) if (value !== undefined) return value
  return 3001
}
