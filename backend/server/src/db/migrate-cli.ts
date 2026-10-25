/**
 * CLI wrapper kept for development: `npm run migrate`.
 * The migration logic itself lives in migrate.ts and is import-safe.
 */
import { closeDb } from './connection.js'
import { runMigrations } from './migrate.js'

runMigrations()
console.log('Migrations complete.')
closeDb()
