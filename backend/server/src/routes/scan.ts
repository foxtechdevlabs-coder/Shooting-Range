import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import type { Participant } from '../db/schema.js'
import { effectiveTransactionSelect } from '../services/effectiveTransactions.js'

export const scanRouter = Router()
scanRouter.use(requireAuth)
scanRouter.use(requirePermission('scan.use'))

/** Normalize barcode: trim whitespace/control chars, uppercase */
function normalizeCode(code: string): string {
  return code.replace(/[\x00-\x1F\x7F]/g, '').trim().toUpperCase()
}

const scanSchema = z.object({
  code: z.string().min(1, 'Scan code is required'),
  manual: z.boolean().optional().default(false),
  confirm: z.boolean().optional().default(false),
})

// ─── POST /api/scan ───────────────────────────────────────────────────────────

scanRouter.post('/', (req, res, next) => {
  try {
    const body = scanSchema.parse(req.body)
    const code = normalizeCode(body.code)
    if (!code) apiError(400, 'EMPTY_CODE', 'Scan code is empty after normalization.')

    const db = getSqlite()

    // Look up participant by gun_number (stored uppercase)
    const participant = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM participants p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.gun_number = ?
    `).get(code) as (Participant & { category_name: string }) | undefined

    if (!participant) {
      res.status(404).json({
        error: { code: 'UNKNOWN_CODE', message: `No participant found for barcode "${code}".` },
      })
      return
    }

    // Duplicate scan window check
    const windowSetting = db.prepare("SELECT value FROM settings WHERE key = 'duplicate_scan_window_seconds'").get() as { value: string } | undefined
    const windowSecs = parseInt(windowSetting?.value ?? '5', 10)
    const windowStart = new Date(Date.now() - windowSecs * 1000).toISOString()

    if (!body.confirm) {
      const recentScan = db.prepare(`${effectiveTransactionSelect(`t.participant_id = ? AND COALESCE(json_extract(c.new_values, '$.created_at'), t.created_at) >= ?
        AND c.action IS NOT 'void' AND json_extract(c.new_values, '$.voided') IS NOT 1`)}
        ORDER BY created_at DESC, t.id DESC LIMIT 1`).get(participant.id, windowStart)

      if (recentScan) {
        res.status(409).json({
          error: { code: 'DUPLICATE_SCAN', message: 'This pouch was just scanned. Confirm to proceed.', needsConfirmation: true },
        })
        return
      }
    }

    // Toggle pouch status and insert transaction atomically
    const newStatus: 'in' | 'out' = participant.pouch_status === 'in' ? 'out' : 'in'
    const txType: 'in' | 'out' = newStatus // transaction type = new status
    const now = new Date().toISOString()

    const doScan = db.transaction(() => {
      db.prepare('UPDATE participants SET pouch_status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, participant.id)
      const txResult = db.prepare(`
        INSERT INTO transactions (participant_id, gun_number, type, created_at, user_id, manual_entry)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(participant.id, participant.gun_number, txType, now, req.user!.id, body.manual ? 1 : 0)
      return txResult.lastInsertRowid
    })

    const txId = doScan() as number

    res.json({
      participant: {
        id: participant.id,
        bib_number: participant.bib_number,
        name: participant.name,
        noc: participant.noc,
        gun_number: participant.gun_number,
        category_name: participant.category_name,
        pouch_status: newStatus,
      },
      new_status: newStatus,
      transaction_id: txId,
      transaction_time: now,
    })
  } catch (err) { next(err) }
})

// ─── GET /api/scan/summary ────────────────────────────────────────────────────

scanRouter.get('/summary', (req, res, next) => {
  try {
    const db = getSqlite()
    const inCount = (db.prepare("SELECT COUNT(*) as c FROM participants WHERE pouch_status = 'in'").get() as { c: number }).c
    const outCount = (db.prepare("SELECT COUNT(*) as c FROM participants WHERE pouch_status = 'out'").get() as { c: number }).c
    const total = inCount + outCount

    const printed = (db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 1 AND label_stale = 0').get() as { c: number }).c
    const unprinted = (db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 0').get() as { c: number }).c
    const stale = (db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_stale = 1').get() as { c: number }).c

    res.json({ in: inCount, out: outCount, total, printed, unprinted, stale })
  } catch (err) { next(err) }
})

// ─── GET /api/scan/recent ─────────────────────────────────────────────────────

scanRouter.get('/recent', (req, res, next) => {
  try {
    const db = getSqlite()
    const rows = db.prepare(`
      WITH candidate_ids AS (
        SELECT id FROM transactions
        WHERE source = 'correction' OR id IN (SELECT transaction_id FROM corrections WHERE transaction_id IS NOT NULL)
        UNION
        SELECT id FROM (
          SELECT t.id FROM transactions t
          WHERE t.source != 'correction'
            AND NOT EXISTS (SELECT 1 FROM corrections c WHERE c.transaction_id = t.id)
          ORDER BY t.created_at DESC, t.id DESC LIMIT 10
        )
      )
      ${effectiveTransactionSelect('t.id IN (SELECT id FROM candidate_ids)')}
      ORDER BY created_at DESC, t.id DESC LIMIT 10
    `).all()
    res.json({ data: rows })
  } catch (err) { next(err) }
})
