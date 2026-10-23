import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'

export const transactionsRouter = Router()
transactionsRouter.use(requireAuth)
transactionsRouter.use(requirePermission('transactions.view'))

const querySchema = z.object({
  search: z.string().optional(),
  participant_id: z.coerce.number().optional(),
  gun_number: z.string().optional(),
  type: z.enum(['in', 'out']).optional(),
  user_id: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(20),
})

// GET /api/transactions
transactionsRouter.get('/', (req, res, next) => {
  try {
    const query = querySchema.parse(req.query)
    const db = getSqlite()

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.search) {
      conditions.push('(p.name LIKE ? OR p.bib_number LIKE ? OR t.gun_number LIKE ?)')
      const s = `%${query.search}%`
      params.push(s, s, s)
    }
    if (query.participant_id) { conditions.push('t.participant_id = ?'); params.push(query.participant_id) }
    if (query.gun_number) { conditions.push('t.gun_number = ? COLLATE NOCASE'); params.push(query.gun_number.toUpperCase()) }
    if (query.type) { conditions.push('t.type = ?'); params.push(query.type) }
    if (query.user_id) { conditions.push('t.user_id = ?'); params.push(query.user_id) }
    if (query.from) { conditions.push('t.created_at >= ?'); params.push(`${query.from}T00:00:00.000Z`) }
    if (query.to) { conditions.push('t.created_at <= ?'); params.push(`${query.to}T23:59:59.999Z`) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) as c FROM transactions t LEFT JOIN participants p ON p.id = t.participant_id ${where}`).get(...params) as { c: number }).c

    const rows = db.prepare(`
      SELECT t.*, p.name as participant_name, p.bib_number, p.noc, u.full_name as user_name
      FROM transactions t
      LEFT JOIN participants p ON p.id = t.participant_id
      LEFT JOIN users u ON u.id = t.user_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, query.limit, query.page * query.limit)

    res.json({ data: rows, total, page: query.page, limit: query.limit })
  } catch (err) { next(err) }
})
