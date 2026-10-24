import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type BetterSQLite3 from 'better-sqlite3'
import { config } from '../config.js'
import { closeDb, getSqlite } from '../db/connection.js'

export type AutoBackupReason = 'startup' | 'daily' | 'shutdown'
type Clock = () => Date

export interface AutoBackupServiceOptions {
  db?: BetterSQLite3.Database
  folder?: () => string
  liveDatabasePath?: string
  clock?: Clock
  checkMinutes?: number
  minimumAgeHours?: number
  timeoutMs?: number
  closeDatabase?: () => void
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

const localDay = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
const autoFilePattern = /^auto-(\d{8})-(\d{6})-(startup|daily|shutdown)\.db$/
let activeService: ReturnType<typeof createAutoBackupService> | undefined

export function createAutoBackupService(options: AutoBackupServiceOptions = {}) {
  const clock = options.clock ?? (() => new Date())
  const db = options.db ? () => options.db! : getSqlite
  const folder = options.folder ?? (() => {
    const setting = db().prepare("SELECT value FROM settings WHERE key = 'backup_folder'").get() as { value: string } | undefined
    return setting?.value || path.join(config.dataDir, 'backups')
  })
  const liveDatabasePath = options.liveDatabasePath ?? config.dbPath
  const intervalMs = Math.max(1, options.checkMinutes ?? Number(process.env.AUTO_BACKUP_CHECK_MINUTES ?? 15)) * 60_000
  const minimumAgeMs = Math.max(1, options.minimumAgeHours ?? Number(process.env.AUTO_BACKUP_MIN_AGE_HOURS ?? 24)) * 3_600_000
  const timeoutMs = options.timeoutMs ?? 10_000
  const interval = options.setIntervalFn ?? setInterval
  const clearInterval = options.clearIntervalFn ?? globalThis.clearInterval
  const close = options.closeDatabase ?? closeDb
  let timer: ReturnType<typeof setInterval> | undefined
  let shutdownPromise: Promise<void> | undefined
  let backupTask: Promise<string | null> | undefined
  let shuttingDown = false

  function listAutomaticBackups(directory: string) {
    if (!fs.existsSync(directory)) return []
    return fs.readdirSync(directory).flatMap((filename) => {
      const match = autoFilePattern.exec(filename)
      if (!match) return []
      const stat = fs.statSync(path.join(directory, filename))
      return stat.isFile() ? [{ filename, path: path.join(directory, filename), modifiedAt: stat.mtime }] : []
    }).sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime())
  }

  function recordFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[BACKUP] Automatic backup failed:', error)
    try {
      const connection = db()
      connection.prepare(`INSERT INTO settings (key, value) VALUES ('last_auto_backup_error', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`${clock().toISOString()} ${message}`)
      connection.prepare(`INSERT INTO activity_log (user_id, action, entity, new_values, created_at)
        VALUES (NULL, 'AUTO_BACKUP_FAILED', 'database', ?, ?)`).run(JSON.stringify({ message }), clock().toISOString())
    } catch (logError) {
      console.error('[BACKUP] Could not record automatic backup failure:', logError)
    }
  }

  async function performBackup(reason: AutoBackupReason): Promise<string | null> {
    let tempPath: string | undefined
    try {
      const destination = path.resolve(folder())
      const livePath = path.resolve(liveDatabasePath)
      if (path.dirname(livePath) === destination) {
        throw new Error('Automatic backup folder must be separate from the live database folder.')
      }
      const configuredFolder = db().prepare("SELECT value FROM settings WHERE key = 'backup_folder'").get() as { value: string } | undefined
      const defaultFolder = path.resolve(path.join(config.dataDir, 'backups'))
      if (!fs.existsSync(destination)) {
        if (configuredFolder?.value || destination !== defaultFolder) throw new Error(`Automatic backup folder does not exist: ${destination}`)
        fs.mkdirSync(destination, { recursive: true })
      }
      if (!fs.statSync(destination).isDirectory()) throw new Error(`Automatic backup destination is not a folder: ${destination}`)
      fs.accessSync(destination, fs.constants.W_OK)
      const now = clock()
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
      const filename = `auto-${timestamp}-${reason}.db`
      const finalPath = path.join(destination, filename)
      tempPath = path.join(destination, `.${filename}.${randomUUID()}.tmp`)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          db().backup(tempPath),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error(`Automatic backup timed out after ${timeoutMs}ms.`)), timeoutMs)
            timeout.unref?.()
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      fs.renameSync(tempPath, finalPath)
      fs.utimesSync(finalPath, now, now)
      tempPath = undefined
      db().prepare(`INSERT INTO settings (key, value) VALUES ('last_auto_backup_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(now.toISOString())
      db().prepare(`INSERT INTO settings (key, value) VALUES ('last_auto_backup_error', '')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      db().prepare(`INSERT INTO activity_log (user_id, action, entity, new_values, created_at)
        VALUES (NULL, 'AUTO_BACKUP', 'database', ?, ?)`).run(JSON.stringify({ filename, reason }), now.toISOString())
      const backups = listAutomaticBackups(destination)
      for (const stale of backups.slice(14)) fs.rmSync(stale.path, { force: true })
      return finalPath
    } catch (error) {
      if (tempPath) {
        try { fs.rmSync(tempPath, { force: true }) } catch (cleanupError) { console.error('[BACKUP] Could not remove incomplete temporary backup:', cleanupError) }
      }
      recordFailure(error)
      return null
    }
  }

  function runBackup(reason: AutoBackupReason): Promise<string | null> {
    if (backupTask) return backupTask
    if (shuttingDown && reason !== 'shutdown') return Promise.resolve(null)
    backupTask = performBackup(reason).finally(() => { backupTask = undefined })
    return backupTask
  }

  function newestBackup() {
    return listAutomaticBackups(path.resolve(folder()))[0]
  }

  function setNextScheduledCheck() {
    try {
      db().prepare(`INSERT INTO settings (key, value) VALUES ('next_auto_backup_check_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date(clock().getTime() + intervalMs).toISOString())
    } catch (error) {
      console.error('[BACKUP] Could not update the next automatic backup check time:', error)
    }
  }

  async function runStartupCheck() {
    try {
      const newest = newestBackup()
      const now = clock()
      if (!newest || now.getTime() - newest.modifiedAt.getTime() >= minimumAgeMs || localDay(newest.modifiedAt) !== localDay(now)) {
        return await runBackup('startup')
      }
      return null
    } catch (error) {
      recordFailure(error)
      return null
    }
  }

  async function runDailyCheck() {
    try {
      const newest = newestBackup()
      if (!newest || localDay(newest.modifiedAt) !== localDay(clock())) return await runBackup('daily')
      return null
    } catch (error) {
      recordFailure(error)
      return null
    }
  }

  function start() {
    setNextScheduledCheck()
    void runStartupCheck()
    timer = interval(() => { void runDailyCheck().finally(setNextScheduledCheck) }, intervalMs)
    timer.unref?.()
    return service
  }

  function shutdown() {
    if (!shutdownPromise) {
      shuttingDown = true
      if (timer) clearInterval(timer)
      shutdownPromise = (async () => {
        if (backupTask) await backupTask
        await runBackup('shutdown')
        try { db().pragma('wal_checkpoint(TRUNCATE)') } catch (error) { console.error('[BACKUP] WAL checkpoint failed during shutdown:', error) }
        close()
      })()
    }
    return shutdownPromise
  }

  const service = { start, runBackup, runStartupCheck, runDailyCheck, shutdown, listAutomaticBackups }
  return service
}

export function startAutoBackup(options?: AutoBackupServiceOptions) {
  activeService = createAutoBackupService(options).start()
  return activeService
}

export async function runShutdownBackup() {
  await activeService?.shutdown()
}
