import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import BetterSQLite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { getSqlite } from '../db/connection.js'
import { createAutoBackupService } from '../services/autoBackup.js'
import { getBackupStatus } from '../services/backup.js'

const temporaryFolders: string[] = []

function makeFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-auto-backup-test-'))
  temporaryFolders.push(folder)
  return folder
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

describe('automatic database backups', () => {
  it('backs up on startup when none exist or the newest backup is over 24 hours old', async () => {
    const folder = makeFolder()
    let now = new Date(2026, 9, 23, 9, 0, 0)
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => folder, liveDatabasePath: config.dbPath, clock: () => new Date(now), closeDatabase: () => {},
    })
    const initial = await service.runStartupCheck()
    expect(path.basename(initial!)).toMatch(/^auto-\d{8}-\d{6}-startup\.db$/)
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000)
    const stale = await service.runStartupCheck()
    expect(path.basename(stale!)).toMatch(/^auto-\d{8}-\d{6}-startup\.db$/)
    expect(service.listAutomaticBackups(folder)).toHaveLength(2)
  })

  it('does not run at startup when the newest backup is recent and creates a daily backup across midnight', async () => {
    const folder = makeFolder()
    let now = new Date(2026, 9, 23, 23, 59, 0)
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => folder, liveDatabasePath: config.dbPath, clock: () => new Date(now), closeDatabase: () => {},
    })
    await service.runBackup('startup')
    expect(await service.runStartupCheck()).toBeNull()
    now = new Date(2026, 9, 24, 0, 1, 0)
    const daily = await service.runDailyCheck()
    expect(path.basename(daily!)).toMatch(/^auto-\d{8}-\d{6}-daily\.db$/)
  })

  it('runs the shutdown backup once, validates it, and closes after the backup', async () => {
    const folder = makeFolder()
    let closeCount = 0
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => folder, liveDatabasePath: config.dbPath,
      closeDatabase: () => { closeCount++ },
    })
    await Promise.all([service.shutdown(), service.shutdown()])
    const shutdowns = service.listAutomaticBackups(folder).filter((item) => item.filename.endsWith('-shutdown.db'))
    expect(shutdowns).toHaveLength(1)
    expect(closeCount).toBe(1)
    const backup = new BetterSQLite3(shutdowns[0].path, { readonly: true, fileMustExist: true })
    expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    backup.close()
  })

  it('keeps the newest 14 automatic backups and leaves manual and unrelated files untouched', async () => {
    const folder = makeFolder()
    for (let index = 0; index < 20; index++) {
      const filename = `auto-20260101-${String(index).padStart(6, '0')}-daily.db`
      const file = path.join(folder, filename)
      fs.writeFileSync(file, 'old')
      const time = new Date(2026, 0, 1, 0, 0, index)
      fs.utimesSync(file, time, time)
    }
    const manual = path.join(folder, 'shootingrange-backup-20260101-000000.db')
    const unrelated = path.join(folder, 'keep-me.txt')
    fs.writeFileSync(manual, 'manual')
    fs.writeFileSync(unrelated, 'unrelated')
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => folder, liveDatabasePath: config.dbPath, closeDatabase: () => {},
    })
    await service.runBackup('daily')
    expect(service.listAutomaticBackups(folder)).toHaveLength(14)
    expect(fs.existsSync(manual)).toBe(true)
    expect(fs.existsSync(unrelated)).toBe(true)
  })

  it('records backup failures without throwing', async () => {
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => path.dirname(config.dbPath), liveDatabasePath: config.dbPath, closeDatabase: () => {},
    })
    await expect(service.runBackup('daily')).resolves.toBeNull()
    const error = getSqlite().prepare("SELECT value FROM settings WHERE key = 'last_auto_backup_error'").get() as { value: string }
    expect(error.value).toContain('separate from the live database folder')
    expect(getSqlite().prepare("SELECT id FROM activity_log WHERE action = 'AUTO_BACKUP_FAILED'").get()).toBeDefined()
  })

  it('exposes a missing-folder failure and the next scheduled check in backup status', async () => {
    const missingFolder = path.join(os.tmpdir(), `missing-auto-backup-${process.pid}-${Date.now()}`)
    const service = createAutoBackupService({
      db: getSqlite(), folder: () => missingFolder, liveDatabasePath: config.dbPath, closeDatabase: () => {},
    })
    await expect(service.runBackup('daily')).resolves.toBeNull()
    const status = getBackupStatus()
    expect(status.lastAutoBackupError).toContain('does not exist')
    expect(status.nextScheduledCheckAt).toEqual(expect.any(String))
  })
})
