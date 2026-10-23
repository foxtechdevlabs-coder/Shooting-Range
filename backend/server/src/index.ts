import { createApp } from './app.js'
import { config } from './config.js'
import { runMigrations } from './db/migrate.js'

// Run migrations on startup
console.log('[DB] Running migrations...')
runMigrations()
console.log('[DB] Migrations complete.')

const app = createApp()

const server = app.listen(config.port, config.host, () => {
  console.log(`[SERVER] Listening on http://${config.host}:${config.port}`)
  console.log(`[SERVER] Database: ${config.dbPath}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down...')
  server.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
