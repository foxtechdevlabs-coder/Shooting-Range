import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

// GET /api/settings – any logged-in user
settingsRouter.get('/', (req, res, next) => {
  try {
    const db = getSqlite()
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const obj: Record<string, string> = {}
    for (const row of rows) obj[row.key] = row.value
    res.json({ settings: obj })
  } catch (err) { next(err) }
})

const updateSchema = z.record(z.string(), z.string())

// PATCH /api/settings – settings.manage
settingsRouter.patch('/', requirePermission('settings.manage'), (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body)
    const db = getSqlite()
    const now = new Date().toISOString()

    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    const updateMany = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        upsert.run(key, value)
      }
    })
    updateMany()

    db.prepare(`INSERT INTO activity_log (user_id, action, entity, created_at) VALUES (?, 'UPDATE_SETTINGS', 'settings', ?)`).run(req.user!.id, now)

    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const obj: Record<string, string> = {}
    for (const row of rows) obj[row.key] = row.value
    res.json({ settings: obj })
  } catch (err) { next(err) }
})
