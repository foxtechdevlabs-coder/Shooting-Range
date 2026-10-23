/**
 * Migration runner.
 * Reads and executes SQL migration files in order.
 * Creates the migrations table to track which have been applied.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSqlite } from './connection.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

export function runMigrations() {
  const db = getSqlite()

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((row: any) => row.name as string)
  )

  // Read migration files sorted
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    db.exec(sql)
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
      file,
      new Date().toISOString()
    )
    console.log(`✓ Applied migration: ${file}`)
  }
}

// Run when executed directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')
if (process.argv[1]?.includes('migrate')) {
  runMigrations()
  console.log('Migrations complete.')
  process.exit(0)
}
