/**
 * Migration runner.
 * Reads and executes SQL migration files in order.
 * Creates the migrations table to track which have been applied.
 *
 * Importing this module has no side effects; the CLI entry point is `migrate-cli.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSqlite } from './connection.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Compiled builds keep migrations next to the JS; tsx runs read the .sql sources. */
function resolveMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.readdirSync(candidate).some((file) => file.endsWith('.sql'))) {
      return candidate
    }
  }
  return candidates[0]
}

export function migrationsDir(): string {
  return resolveMigrationsDir()
}

function appliedMigrations(): Set<string> {
  const db = getSqlite()
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)
  return new Set(db.prepare('SELECT name FROM _migrations').all().map((row) => (row as { name: string }).name))
}

/** Pending migration file names, in execution order. Does not mutate the schema beyond the bookkeeping table. */
export function pendingMigrations(): string[] {
  const applied = appliedMigrations()
  return fs.readdirSync(migrationsDir())
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !applied.has(file))
}

export function runMigrations(): void {
  const db = getSqlite()
  const applied = appliedMigrations()

  for (const file of fs.readdirSync(migrationsDir()).filter((name) => name.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir(), file), 'utf-8')
    db.exec(sql)
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
    console.log(`✓ Applied migration: ${file}`)
  }
}
