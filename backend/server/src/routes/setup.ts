/**
 * First-run setup for packaged installs (no environment variables on the
 * client PC, no demo data by default).
 *
 * GET  /api/setup/status      → { needsSetup: boolean, version, dataDir }
 * POST /api/setup/first-admin  → creates the very first Admin account
 *
 * The POST endpoint is:
 *   - only reachable while the users table is empty (409 forever afterwards),
 *   - loopback-only (the desktop app is the only client),
 *   - rate limited,
 *   - validated with Zod and hashed with argon2.
 */
import { Router, type Request } from 'express'
import { hash } from '@node-rs/argon2'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { apiError } from '../middleware/errorHandler.js'
import { config } from '../config.js'
import { logger } from '../services/logger.js'
import type { User } from '../db/schema.js'

export const setupRouter = Router()

function usersExist(): boolean {
  try {
    const row = getSqlite().prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }
    return row.total > 0
  } catch {
    // Database not migrated yet: treat as "not set up".
    return false
  }
}

function isLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? ''
  const normalized = address.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

const setupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many setup attempts. Please try again later.' } },
})

// ─── GET /api/setup/status ────────────────────────────────────────────────────

setupRouter.get('/status', (_req, res, next) => {
  try {
    res.json({ needsSetup: !usersExist(), version: config.appVersion, dataDir: config.dataDir })
  } catch (error) { next(error) }
})

// ─── POST /api/setup/first-admin ──────────────────────────────────────────────

const firstAdminSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(100, 'Full name is too long'),
  username: z
    .string()
    .trim()
    .min(2, 'Username must be at least 2 characters')
    .max(40, 'Username is too long')
    .regex(/^[a-z0-9_.-]+$/i, 'Username may only contain letters, digits, . _ -'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200, 'Password is too long'),
  confirm_password: z.string().min(1, 'Please repeat the password'),
}).refine((body) => body.password === body.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

setupRouter.post('/first-admin', setupLimiter, (req, res, next) => {
  void (async () => {
    try {
      if (!isLoopback(req)) {
        apiError(403, 'LOOPBACK_ONLY', 'Account setup is only allowed from this computer.')
      }
      if (usersExist()) {
        apiError(409, 'SETUP_COMPLETE', 'Setup has already been completed on this installation.')
      }

      const body = firstAdminSchema.parse(req.body)
      const db = getSqlite()
      const now = new Date().toISOString()

      const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(body.username)
      if (existing) apiError(409, 'DUPLICATE_USERNAME', 'This username is already taken.')

      const passwordHash = await hash(body.password)
      const result = db.prepare(`
        INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at)
        VALUES (?, ?, ?, 'admin', '[]', 1, 0, ?)
      `).run(body.full_name, body.username, passwordHash, now)

      const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User
      db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
        VALUES (?, 'CREATE_FIRST_ADMIN', 'user', ?, ?, ?)`)
        .run(created.id, String(created.id), JSON.stringify({ username: created.username }), now)

      logger.info('First admin account created', { userId: created.id, username: created.username })

      res.status(201).json({
        user: {
          id: created.id,
          full_name: created.full_name,
          username: created.username,
          role: created.role,
          permissions: [],
          active: true,
          must_change_password: false,
        },
      })
    } catch (error) { next(error) }
  })()
})
