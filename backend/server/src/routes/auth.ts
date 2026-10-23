import { Router } from 'express'
import { hash, verify } from '@node-rs/argon2'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import type { User } from '../db/schema.js'
import type { Permission } from '../../../shared/permissions.js'

export const authRouter = Router()

// In-memory login failure tracker: ip -> { count, until }
const loginFailures = new Map<string, { count: number; until: number }>()

function getClientIp(req: import('express').Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function isLocked(ip: string): boolean {
  const entry = loginFailures.get(ip)
  if (!entry) return false
  if (Date.now() > entry.until) { loginFailures.delete(ip); return false }
  return entry.count >= 5
}

function recordFailure(ip: string) {
  const entry = loginFailures.get(ip)
  if (entry && Date.now() < entry.until) {
    entry.count++
  } else {
    loginFailures.set(ip, { count: 1, until: Date.now() + 5 * 60 * 1000 })
  }
}

function clearFailure(ip: string) {
  loginFailures.delete(ip)
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

authRouter.post('/login', (req, res, next) => {
  void (async () => {
    try {
      const ip = getClientIp(req)

      if (isLocked(ip)) {
        res.status(429).json({
          error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Please try again in 5 minutes.' },
        })
        return
      }

      const body = loginSchema.safeParse(req.body)
      if (!body.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Username and password are required.' } })
        return
      }

      const db = getSqlite()
      const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(body.data.username) as User | undefined

      const GENERIC_MSG = 'Invalid username or password.'

      // Always run hash verification to prevent timing attacks
      const passwordToCheck = user?.password_hash ?? '$argon2id$v=19$m=65536,t=3,p=4$placeholder'
      let passwordOk = false
      try {
        passwordOk = await verify(passwordToCheck, body.data.password)
      } catch {
        // Invalid hash (placeholder) — ignore
      }

      if (!user || !passwordOk) {
        recordFailure(ip)
        // Log failed attempt
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
          VALUES (NULL, 'LOGIN_FAILED', 'session', NULL, ?, ?)
        `).run(JSON.stringify({ username: body.data.username, ip }), new Date().toISOString())

        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: GENERIC_MSG } })
        return
      }

      if (!user.active) {
        recordFailure(ip)
        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: GENERIC_MSG } })
        return
      }

      clearFailure(ip)

      // Create session
      const sessionId = uuidv4()
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      db.prepare('INSERT INTO sessions (id, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)').run(
        sessionId, user.id, expiresAt, now
      )

      // Update last_login_at
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id)

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, created_at)
        VALUES (?, 'LOGIN', 'session', ?, ?)
      `).run(user.id, String(user.id), now)

      // Set session cookie
      res.cookie('session_id', sessionId, {
        httpOnly: true,
        sameSite: 'strict',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })

      const permissions = JSON.parse(user.permissions ?? '[]') as Permission[]

      res.json({
        user: {
          id: user.id,
          full_name: user.full_name,
          username: user.username,
          role: user.role,
          permissions,
          active: user.active,
          must_change_password: Boolean(user.must_change_password),
          created_at: user.created_at,
          last_login_at: now,
        },
      })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

authRouter.post('/logout', requireAuth, (req, res, next) => {
  try {
    const db = getSqlite()
    const now = new Date().toISOString()

    if (req.sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId)
    }

    if (req.user) {
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, created_at)
        VALUES (?, 'LOGOUT', 'session', ?, ?)
      `).run(req.user.id, String(req.user.id), now)
    }

    res.clearCookie('session_id')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, (req, res) => {
  const user = req.user!
  const db = getSqlite()
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User
  const permissions = JSON.parse(userRow.permissions ?? '[]') as Permission[]
  res.json({
    user: {
      id: userRow.id,
      full_name: userRow.full_name,
      username: userRow.username,
      role: userRow.role,
      permissions,
      active: userRow.active,
      must_change_password: Boolean(userRow.must_change_password),
      created_at: userRow.created_at,
      last_login_at: userRow.last_login_at,
    },
  })
})

// ─── POST /api/auth/change-password ──────────────────────────────────────────

const changePassSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

authRouter.post('/change-password', requireAuth, (req, res, next) => {
  void (async () => {
    try {
      const body = changePassSchema.parse(req.body)
      const db = getSqlite()
      const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as User

      const ok = await verify(userRow.password_hash, body.currentPassword)
      if (!ok) {
        apiError(400, 'WRONG_PASSWORD', 'Current password is incorrect.')
      }

      const newHash = await hash(body.newPassword)
      const now = new Date().toISOString()
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
        newHash, req.user!.id
      )

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, created_at)
        VALUES (?, 'CHANGE_PASSWORD', 'user', ?, ?)
      `).run(req.user!.id, String(req.user!.id), now)

      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })()
})
