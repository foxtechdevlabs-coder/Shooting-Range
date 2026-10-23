import { Router } from 'express'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import type { Category } from '../db/schema.js'

export const categoriesRouter = Router()
categoriesRouter.use(requireAuth)

// GET /api/categories – any logged-in user
categoriesRouter.get('/', (req, res, next) => {
  try {
    const db = getSqlite()
    const cats = db.prepare('SELECT * FROM categories ORDER BY name').all() as Category[]
    res.json({ data: cats })
  } catch (err) { next(err) }
})

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required'),
  active: z.boolean().default(true),
})

// POST /api/categories – settings.manage
categoriesRouter.post('/', requirePermission('settings.manage'), (req, res, next) => {
  try {
    const body = categorySchema.parse(req.body)
    const db = getSqlite()
    const existing = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(body.name)
    if (existing) apiError(409, 'DUPLICATE_CATEGORY', 'A category with this name already exists.')
    const result = db.prepare('INSERT INTO categories (name, active) VALUES (?, ?)').run(body.name, body.active ? 1 : 0)
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid) as Category
    res.status(201).json({ category: cat })
  } catch (err) { next(err) }
})

// PATCH /api/categories/:id – settings.manage
categoriesRouter.patch('/:id', requirePermission('settings.manage'), (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) apiError(400, 'INVALID_ID', 'Invalid category ID')
    const body = categorySchema.partial().parse(req.body)
    const db = getSqlite()
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined
    if (!existing) apiError(404, 'NOT_FOUND', 'Category not found')
    db.prepare('UPDATE categories SET name = COALESCE(?, name), active = COALESCE(?, active) WHERE id = ?').run(
      body.name ?? null, body.active !== undefined ? (body.active ? 1 : 0) : null, id
    )
    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category
    res.json({ category: updated })
  } catch (err) { next(err) }
})
