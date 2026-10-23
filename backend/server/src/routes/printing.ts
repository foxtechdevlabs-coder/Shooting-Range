import { Router } from 'express'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import { listPrinters, printZpl, getEffectiveDriver, PrinterError } from '../services/printer.js'
import { buildLabelZpl, LabelValidationError } from '../services/zpl.js'
import type { LabelConfig } from '../../../shared/label.js'

export const printingRouter = Router()
printingRouter.use(requireAuth)

export function getLabelConfigFromDb(db: any): {
  labelConfig: LabelConfig
  printerName: string
  driverOverride?: 'windows' | 'file'
} {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))

  const widthMm = parseFloat(map.get('label_width_mm') ?? '50') || 50
  const heightMm = parseFloat(map.get('label_height_mm') ?? '25') || 25
  const dpi = parseInt(map.get('label_dpi') ?? '203', 10) || 203
  const darknessVal = parseInt(map.get('label_darkness') ?? '20', 10)
  const darkness = isNaN(darknessVal) ? 20 : darknessVal
  const speed = parseInt(map.get('label_speed') ?? '3', 10) || 3
  const offsetX = parseInt(map.get('label_offset_x') ?? '0', 10) || 0
  const offsetY = parseInt(map.get('label_offset_y') ?? '0', 10) || 0
  const showEventName = map.get('label_show_event_name') === 'true'
  const eventName = map.get('event_name') ?? ''
  const mediaTracking = (map.get('label_media_tracking') === 'none' ? 'none' : 'gap') as 'none' | 'gap'
  const printerName = map.get('printer_name') ?? ''
  const printDriverSetting = map.get('print_driver')
  const driverOverride =
    printDriverSetting === 'windows' || printDriverSetting === 'file'
      ? printDriverSetting
      : undefined

  return {
    labelConfig: {
      widthMm,
      heightMm,
      dpi,
      darkness,
      speed,
      offsetX,
      offsetY,
      showEventName,
      eventName,
      mediaTracking,
      printerName,
      printDriver: driverOverride,
    },
    printerName,
    driverOverride,
  }
}

// ─── GET /api/printing/printers ───────────────────────────────────────────────
printingRouter.get('/printers', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const db = getSqlite()
    const { printerName, driverOverride } = getLabelConfigFromDb(db)
    const effectiveDriver = getEffectiveDriver(driverOverride)
    const printers = await listPrinters()

    res.json({
      printers,
      configuredPrinter: printerName,
      driver: effectiveDriver,
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/printing/test ──────────────────────────────────────────────────
printingRouter.post('/test', requirePermission('settings.manage'), async (req, res, next) => {
  const db = getSqlite()
  const { labelConfig, printerName, driverOverride } = getLabelConfigFromDb(db)
  const effectiveDriver = getEffectiveDriver(driverOverride)
  const now = new Date().toISOString()
  const targetPrinter = printerName || 'Default / File'

  try {
    // Generate sample test label
    const testParticipant = {
      bib_number: 'TEST',
      name: 'SAMPLE ATHLETE',
      gun_number: 'TEST-GUN-01',
    }

    const zpl = buildLabelZpl(testParticipant, labelConfig)
    const result = await printZpl(zpl, { printerName, driverOverride })

    // Record successful test print job
    const insertJob = db.prepare(`
      INSERT INTO print_jobs (user_id, created_at, kind, label_count, reason, status, error, printer_name)
      VALUES (?, ?, 'test', 1, NULL, 'sent', NULL, ?)
    `)
    const jobResult = insertJob.run(req.user!.id, now, result.target)
    const jobId = Number(jobResult.lastInsertRowid)

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
      VALUES (?, 'PRINT_TEST_LABEL', 'print_job', ?, ?, ?)
    `).run(req.user!.id, String(jobId), JSON.stringify({ target: result.target, driver: result.driver }), now)

    res.json({
      ok: true,
      jobId,
      driver: result.driver,
      printerName: result.target,
    })
  } catch (err: any) {
    // Record failed test job
    try {
      db.prepare(`
        INSERT INTO print_jobs (user_id, created_at, kind, label_count, reason, status, error, printer_name)
        VALUES (?, ?, 'test', 1, NULL, 'failed', ?, ?)
      `).run(req.user!.id, now, err.message ?? 'Unknown error', targetPrinter)
    } catch {
      // Ignore failure to record job
    }

    if (err instanceof LabelValidationError) {
      apiError(400, err.code, err.message)
    } else if (err instanceof PrinterError) {
      apiError(400, err.code, err.message)
    } else {
      apiError(500, 'SPOOL_FAILED', err.message || 'Failed to print test label')
    }
  }
})
