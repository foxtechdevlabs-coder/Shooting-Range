import { Router } from 'express'
import { hash } from '@node-rs/argon2'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import type { User } from '../db/schema.js'
import { ALL_PERMISSIONS, type Permission } from '../../../shared/permissions.js'

export const usersRouter = Router()
usersRouter.use(requireAuth)
usersRouter.use(requirePermission('users.manage'))

function formatUser(u: User) {
  return {
    id: u.id,
    full_name: u.full_name,
    username: u.username,
    role: u.role,
    permissions: JSON.parse(u.permissions ?? '[]') as Permission[],
    active: Boolean(u.active),
    must_change_password: Boolean(u.must_change_password),
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  }
}

// GET /api/users
usersRouter.get('/', (req, res, next) => {
  try {
    const db = getSqlite()
    const users = db.prepare('SELECT * FROM users ORDER BY id').all() as User[]
    res.json({ data: users.map(formatUser) })
  } catch (err) { next(err) }
})

// POST /api/users
const createSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required'),
  username: z.string().trim().min(2).regex(/^[a-z0-9_.-]+$/i, 'Invalid username format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'staff']),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).default([]),
  active: z.boolean().default(true),
})

usersRouter.post('/', (req, res, next) => {
  void (async () => {
    try {
      const body = createSchema.parse(req.body)
      const db = getSqlite()
      const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(body.username)
      if (existing) apiError(409, 'DUPLICATE_USERNAME', 'This username is already taken.')

      const passwordHash = await hash(body.password)
      const now = new Date().toISOString()

      const result = db.prepare(`
        INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(body.full_name, body.username, passwordHash, body.role, JSON.stringify(body.permissions), body.active ? 1 : 0, now)

      const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
        VALUES (?, 'CREATE_USER', 'user', ?, ?, ?)
      `).run(req.user!.id, String(newUser.id), JSON.stringify({ username: body.username, role: body.role }), now)

      res.status(201).json({ user: formatUser(newUser) })
    } catch (err) { next(err) }
  })()
})

// PATCH /api/users/:id
const updateSchema = z.object({
  full_name: z.string().trim().min(2).optional(),
  username: z.string().trim().min(2).regex(/^[a-z0-9_.-]+$/i).optional(),
  role: z.enum(['admin', 'staff']).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).optional(),
  active: z.boolean().optional(),
})

usersRouter.patch('/:id', (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10)
    if (isNaN(userId)) apiError(400, 'INVALID_ID', 'Invalid user ID')

    const body = updateSchema.parse(req.body)
    const db = getSqlite()
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined
    if (!existing) apiError(404, 'NOT_FOUND', 'User not found')

    // Guard: cannot deactivate or demote last active admin
    if (body.active === false || body.role === 'staff') {
      if (existing.role === 'admin') {
        const activeAdminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1").get() as { c: number }).c
        if (activeAdminCount <= 1) {
          apiError(409, 'LAST_ADMIN', 'Cannot deactivate or demote the last active admin account.')
        }
      }
    }

    // Check username uniqueness
    if (body.username && body.username !== existing.username) {
      const conflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(body.username, userId)
      if (conflict) apiError(409, 'DUPLICATE_USERNAME', 'This username is already taken.')
    }

    const old_values = formatUser(existing)
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        username = COALESCE(?, username),
        role = COALESCE(?, role),
        permissions = COALESCE(?, permissions),
        active = COALESCE(?, active)
      WHERE id = ?
    `).run(
      body.full_name ?? null,
      body.username ?? null,
      body.role ?? null,
      body.permissions ? JSON.stringify(body.permissions) : null,
      body.active !== undefined ? (body.active ? 1 : 0) : null,
      userId
    )

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity, entity_id, old_values, new_values, created_at)
      VALUES (?, 'UPDATE_USER', 'user', ?, ?, ?, ?)
    `).run(req.user!.id, String(userId), JSON.stringify(old_values), JSON.stringify(formatUser(updated)), now)

    res.json({ user: formatUser(updated) })
  } catch (err) { next(err) }
})

// POST /api/users/:id/reset-password
const resetPassSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

usersRouter.post('/:id/reset-password', (req, res, next) => {
  void (async () => {
    try {
      const userId = parseInt(req.params.id, 10)
      if (isNaN(userId)) apiError(400, 'INVALID_ID', 'Invalid user ID')

      const body = resetPassSchema.parse(req.body)
      const db = getSqlite()
      const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
      if (!existing) apiError(404, 'NOT_FOUND', 'User not found')

      const newHash = await hash(body.newPassword)
      const now = new Date().toISOString()
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, userId)

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, created_at)
        VALUES (?, 'RESET_PASSWORD', 'user', ?, ?)
      `).run(req.user!.id, String(userId), now)

      res.json({ ok: true })
    } catch (err) { next(err) }
  })()
})
