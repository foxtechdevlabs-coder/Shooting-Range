/**
 * Pre-migration safety net.
 *
 * Before any pending migration is applied to an existing database, a copy is
 * written to <dataDir>/backups/pre-migration-<version>-<timestamp>.db.
 * If the migration then fails, that copy is restored so the app never starts on
 * a half-migrated database.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { closeDb, getSqlite } from './connection.js'

export interface PreMigrationBackup {
  path: string
  createdAt: string
  fromVersion: string
}

function timestamp(date = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sanitizeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z._-]+/g, '-') || 'unknown'
}

/** True when the database file already exists (i.e. this is not a first run). */
export function databaseExists(): boolean {
  return fs.existsSync(config.dbPath)
}

/**
 * Copy the live database (WAL-safe, via SQLite's online backup API) before migrations run.
 * Returns null when there is no database yet (fresh install — nothing to protect).
 */
export async function createPreMigrationBackup(
  appVersion: string,
  existedBeforeConnect?: boolean,
): Promise<PreMigrationBackup | null> {
  // A brand-new install has nothing to protect. `existedBeforeConnect` is
  // captured by the caller *before* the SQLite connection is opened, because
  // opening a connection creates an empty database file.
  const existed = existedBeforeConnect ?? databaseExists()
  if (!existed) return null

  fs.mkdirSync(config.backupsDir, { recursive: true })
  const createdAt = new Date().toISOString()
  const target = path.join(
    config.backupsDir,
    `pre-migration-${sanitizeVersion(appVersion)}-${timestamp()}.db`,
  )

  // A copy of data already in the WAL is essential; the backup API includes it.
  await getSqlite().backup(target)
  console.log(`[DB] Pre-migration backup written: ${target}`)
  return { path: target, createdAt, fromVersion: appVersion }
}

/**
 * Restore a pre-migration backup over the live database.
 * Closes the connection, removes WAL/SHM side files, copies the backup back.
 */
export function restorePreMigrationBackup(backupPath: string): void {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Pre-migration backup is missing: ${backupPath}`)
  }
  closeDb()
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${config.dbPath}${suffix}`, { force: true })
  }
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  fs.copyFileSync(backupPath, config.dbPath)
  console.log(`[DB] Restored pre-migration backup: ${backupPath}`)
}

export interface MigrationOutcome {
  applied: string[]
  backup: PreMigrationBackup | null
  restored: boolean
}

/**
 * Run pending migrations with the safety net described in the file header.
 * Throws an Error with a user-facing message when migration fails (after restoring).
 */
export async function migrateWithBackup(
  appVersion: string,
  runMigrations: () => void,
  pendingMigrations: () => string[],
  options: { databaseExistedBeforeStartup?: boolean } = {},
): Promise<MigrationOutcome> {
  const pending = pendingMigrations()
  if (pending.length === 0) return { applied: [], backup: null, restored: false }

  const backup = await createPreMigrationBackup(appVersion, options.databaseExistedBeforeStartup)
  try {
    runMigrations()
    return { applied: pending, backup, restored: false }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (backup) {
      try {
        restorePreMigrationBackup(backup.path)
      } catch (restoreError) {
        const restoreDetail = restoreError instanceof Error ? restoreError.message : String(restoreError)
        throw new Error(
          `Database migration failed (${detail}) and the automatic restore also failed (${restoreDetail}). ` +
          `A copy of the database before the upgrade is at: ${backup.path}`,
        )
      }
      throw new Error(
        `Database migration failed: ${detail}. Your database was restored to its state before the upgrade. ` +
        `Backup: ${backup.path}`,
      )
    }
    throw new Error(`Database migration failed on a new database: ${detail}`)
  }
}
