/**
 * Development CLI entry point.
 *
 * All startup logic lives in server.ts (`startServer`), which the Electron main
 * process also uses. This file only wires process signals and logging.
 */
import { startServer } from './server.js'
import { logger } from './services/logger.js'

async function main() {
  console.log('[DB] Running migrations...')
  const server = await startServer({
    host: process.env.HOST,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  })
  console.log('[DB] Migrations complete.')

  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[SERVER] ${signal} received, shutting down...`)
    logger.info('Shutdown requested', { signal })
    try {
      await server.runShutdownBackup(10_000)
      await server.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })

  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', { name: error.name, message: error.message, stack: error.stack })
    console.error('[FATAL]', error)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) })
    console.error('[FATAL] Unhandled rejection:', reason)
  })
}

main().catch((error) => {
  logger.error('Server failed to start', { error })
  console.error('[FATAL] Server failed to start:', error)
  process.exit(1)
})
