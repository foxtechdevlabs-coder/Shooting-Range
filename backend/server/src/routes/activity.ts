import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'

export const activityRouter = Router()
activityRouter.use(requireAuth)
activityRouter.use(requireAdmin)

activityRouter.get('/', (req, res, next) => {
  try {
    const query = z.object({
      from: z.string().optional(), to: z.string().optional(), user_id: z.coerce.number().int().positive().optional(),
      action: z.string().optional(), entity: z.string().optional(),
      page: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().positive().max(200).default(50),
    }).parse(req.query)
    const conditions: string[] = []
    const params: (string | number)[] = []
    if (query.from) { conditions.push('a.created_at >= ?'); params.push(`${query.from}T00:00:00.000Z`) }
    if (query.to) { conditions.push('a.created_at <= ?'); params.push(`${query.to}T23:59:59.999Z`) }
    if (query.user_id) { conditions.push('a.user_id = ?'); params.push(query.user_id) }
    if (query.action) { conditions.push('a.action = ?'); params.push(query.action) }
    if (query.entity) { conditions.push('a.entity = ?'); params.push(query.entity) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const db = getSqlite()
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM activity_log a ${where}`).get(...params) as { count: number }).count
    const data = db.prepare(`SELECT a.*, u.full_name AS user_name FROM activity_log a
      LEFT JOIN users u ON u.id = a.user_id ${where}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.page * query.limit)
    res.json({ data, total, page: query.page, limit: query.limit })
  } catch (error) { next(error) }
})
