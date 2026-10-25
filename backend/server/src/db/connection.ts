/**
 * Database connection singleton.
 * Uses better-sqlite3 in WAL mode with foreign keys enabled.
 * Drizzle ORM wraps the connection.
 */
import BetterSQLite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import * as schema from './schema.js'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _sqlite: BetterSQLite3.Database | null = null

export function getDb() {
  if (_db) return _db

  // Ensure data directory exists
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })

  _sqlite = new BetterSQLite3(config.dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('synchronous = NORMAL')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.pragma('busy_timeout = 5000')
  _sqlite.pragma('cache_size = -64000')

  _db = drizzle(_sqlite, { schema })
  return _db
}

export function getSqlite(): BetterSQLite3.Database {
  // Make sure drizzle is initialized first (which creates the sqlite connection)
  getDb()
  if (!_sqlite) throw new Error('SQLite not initialized')
  return _sqlite
}

/** Flush the WAL into the main database file so a copied .db is complete. */
export function checkpointDb(): void {
  if (!_sqlite) return
  try {
    _sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    console.warn('[DB] WAL checkpoint failed:', error)
  }
}

/**
 * Close the connection cleanly: checkpoint the WAL first so the single
 * .db file on disk is self-contained (important for pen-drive copies/backups),
 * then close. Safe to call twice.
 */
export function closeDb() {
  if (_sqlite) checkpointDb()
  try {
    _sqlite?.close()
  } catch (error) {
    console.warn('[DB] Error while closing the database:', error)
  }
  _sqlite = null
  _db = null
}

export function isDbOpen(): boolean {
  return _sqlite !== null
}
