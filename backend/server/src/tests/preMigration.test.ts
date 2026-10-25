/**
 * Pre-migration backup + restore safety net.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { closeDb, getSqlite } from '../db/connection.js'
import {
  createPreMigrationBackup,
  migrateWithBackup,
  restorePreMigrationBackup,
} from '../db/preMigrationBackup.js'

const tempDirs: string[] = []

function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-migration-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('pre-migration backups', () => {
  it('writes a copy of the existing database before migrating', async () => {
    // Uses the shared temp database created by tests/setup.ts.
    const original = getSqlite().prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }
    expect(original.total).toBeGreaterThan(0)

    const backup = await createPreMigrationBackup('1.0.1', true)
    expect(backup).not.toBeNull()
    expect(fs.existsSync(backup!.path)).toBe(true)
    expect(path.basename(backup!.path)).toMatch(/^pre-migration-1\.0\.1-\d{8}-\d{6}\.db$/)
    expect(path.dirname(backup!.path)).toBe(config.backupsDir)

    // The copy is a usable database with the same rows.
    const BetterSQLite3 = (await import('better-sqlite3')).default
    const copy = new BetterSQLite3(backup!.path, { readonly: true })
    const copied = copy.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }
    copy.close()
    expect(copied.total).toBe(original.total)
  })

  it('does not create a backup on a brand-new install', async () => {
    expect(await createPreMigrationBackup('1.0.0', false)).toBeNull()
  })

  it('restores the backup when a migration fails', async () => {
    const before = (getSqlite().prepare('SELECT COUNT(*) AS total FROM participants').get() as { total: number }).total

    const outcome = migrateWithBackup(
      '1.0.1',
      () => {
        // Simulate a migration that partially applied then blew up.
        getSqlite().exec('CREATE TABLE half_migrated (id INTEGER PRIMARY KEY)')
        throw new Error('synthetic migration failure')
      },
      () => ['9001_synthetic.sql'],
      { databaseExistedBeforeStartup: true },
    )

    await expect(outcome).rejects.toThrow(/Database migration failed/)
    await expect(outcome).rejects.toThrow(/restored/)

    // The half-applied table is gone and the data is intact.
    const db = getSqlite()
    expect(before).toBeGreaterThan(0)
    const participantsNow = (db.prepare('SELECT COUNT(*) AS total FROM participants').get() as { total: number }).total
    expect(participantsNow).toBe(before)
    const halfMigrated = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_migrated'").get()
    expect(halfMigrated).toBeUndefined()
  })

  it('restorePreMigrationBackup copies the file back over the live database', () => {
    const dataDir = makeDataDir()
    const live = path.join(dataDir, 'shootingrange.db')
    fs.writeFileSync(live, 'live-database-bytes')
    const backup = path.join(dataDir, 'backups', 'pre-migration-1.0.0-20260101-000000.db')
    fs.writeFileSync(backup, 'original-database-bytes')

    // Point config at the temp folder for this assertion.
    const previousDbPath = process.env.DB_PATH
    process.env.DB_PATH = live
    try {
      closeDb()
      restorePreMigrationBackup(backup)
      expect(fs.readFileSync(live, 'utf8')).toBe('original-database-bytes')
    } finally {
      if (previousDbPath === undefined) delete process.env.DB_PATH
      else process.env.DB_PATH = previousDbPath
    }
  })
})
