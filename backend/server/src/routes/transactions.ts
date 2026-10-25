import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { effectiveTransactionSelect } from '../services/effectiveTransactions.js'

export const transactionsRouter = Router()
transactionsRouter.use(requireAuth)
transactionsRouter.use(requirePermission('transactions.view'))

const querySchema = z.object({
  search: z.string().optional(),
  participant_id: z.coerce.number().optional(),
  gun_number: z.string().optional(),
  type: z.enum(['in', 'out']).optional(),
  status: z.enum(['valid', 'corrected', 'voided']).optional(),
  user_id: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(200).default(20),
  sort: z.enum(['created_at', 'participant_name', 'gun_number', 'type', 'user_name']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

transactionsRouter.get('/', (req, res, next) => {
  try {
    const query = querySchema.parse(req.query)
    const conditions: string[] = []
    const params: Array<string | number> = []
    const effectiveTime = "COALESCE(json_extract(c.new_values, '$.created_at'), t.created_at)"
    const effectiveType = "COALESCE(json_extract(c.new_values, '$.type'), t.type)"
    const effectiveStatus = "CASE WHEN c.action = 'void' OR json_extract(c.new_values, '$.voided') = 1 THEN 'voided' WHEN c.id IS NOT NULL OR t.source = 'correction' THEN 'corrected' ELSE 'valid' END"
    if (query.search) {
      conditions.push('(p.name LIKE ? OR p.bib_number LIKE ? OR t.gun_number LIKE ?)')
      const search = `%${query.search}%`
      params.push(search, search, search)
    }
    if (query.participant_id) { conditions.push('t.participant_id = ?'); params.push(query.participant_id) }
    if (query.gun_number) { conditions.push('t.gun_number = ? COLLATE NOCASE'); params.push(query.gun_number) }
    if (query.type) { conditions.push(`${effectiveType} = ?`); params.push(query.type) }
    if (query.status) { conditions.push(`${effectiveStatus} = ?`); params.push(query.status) }
    if (query.user_id) { conditions.push('t.user_id = ?'); params.push(query.user_id) }
    if (query.from) { conditions.push(`${effectiveTime} >= ?`); params.push(`${query.from}T00:00:00.000Z`) }
    if (query.to) { conditions.push(`${effectiveTime} <= ?`); params.push(`${query.to}T23:59:59.999Z`) }
    const where = conditions.length ? conditions.join(' AND ') : '1 = 1'
    const db = getSqlite()
    const select = effectiveTransactionSelect(where)
    const total = (db.prepare(`SELECT COUNT(*) AS total FROM (${select}) effective_rows`).get(...params) as { total: number }).total
    const sortColumns = {
      created_at: "COALESCE(json_extract(c.new_values, '$.created_at'), t.created_at)",
      participant_name: 'p.name',
      gun_number: 't.gun_number',
      type: effectiveType,
      user_name: 'u.full_name',
    } as const
    const data = db.prepare(`${select} ORDER BY ${sortColumns[query.sort]} ${query.order.toUpperCase()}, t.id ${query.order.toUpperCase()} LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.page * query.limit)
    res.json({ data, total, page: query.page, limit: query.limit })
  } catch (err) { next(err) }
})
