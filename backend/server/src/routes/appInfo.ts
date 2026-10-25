/**
 * GET /api/app-info — version + data folder for the Settings "About" card.
 * Requires a signed-in user; the desktop shell also injects these values
 * directly through the preload bridge.
 */
import { Router } from 'express'
import os from 'node:os'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { getEffectiveDriver, listPrinters } from '../services/printer.js'
import { getSqlite } from '../db/connection.js'
import { logger } from '../services/logger.js'

export const appInfoRouter = Router()
appInfoRouter.use(requireAuth)

appInfoRouter.get('/', (_req, res, next) => {
  try {
    const db = getSqlite()
    const printerSetting = db.prepare("SELECT value FROM settings WHERE key = 'print_driver'").get() as { value: string } | undefined
    const printerName = (db.prepare("SELECT value FROM settings WHERE key = 'printer_name'").get() as { value: string } | undefined)?.value ?? ''

    res.json({
      version: config.appVersion,
      dataDir: config.dataDir,
      logFile: logger.currentLogFile(),
      packaged: config.packaged,
      platform: os.platform(),
      arch: os.arch(),
      printDriver: getEffectiveDriver(printerSetting?.value),
      printerName,
    })
  } catch (error) { next(error) }
})

/** GET /api/app-info/printers — installed printers, used by the Settings printer picker. */
appInfoRouter.get('/printers', (_req, res, next) => {
  void (async () => {
    try {
      const printers = await listPrinters()
      res.json({ printers })
    } catch (error) { next(error) }
  })()
})
