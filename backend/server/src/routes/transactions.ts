import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { effectiveTransactions } from '../services/effectiveTransactions.js'

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
  limit: z.coerce.number().int().positive().max(500).default(20),
})

transactionsRouter.get('/', (req, res, next) => {
  try {
    const query = querySchema.parse(req.query)
    const search = query.search?.toLowerCase()
    const from = query.from ? `${query.from}T00:00:00.000Z` : undefined
    const to = query.to ? `${query.to}T23:59:59.999Z` : undefined
    const rows = effectiveTransactions(getSqlite()).filter((row) =>
      (!search || `${row.participant_name ?? ''} ${row.bib_number ?? ''} ${row.gun_number}`.toLowerCase().includes(search)) &&
      (!query.participant_id || row.participant_id === query.participant_id) &&
      (!query.gun_number || row.gun_number.toLowerCase() === query.gun_number.toLowerCase()) &&
      (!query.type || row.type === query.type) &&
      (!query.status || row.status === query.status) &&
      (!query.user_id || row.user_id === query.user_id) &&
      (!from || row.created_at >= from) &&
      (!to || row.created_at <= to))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    const total = rows.length
    const data = rows.slice(query.page * query.limit, (query.page + 1) * query.limit)
    res.json({ data, total, page: query.page, limit: query.limit })
  } catch (err) { next(err) }
})
