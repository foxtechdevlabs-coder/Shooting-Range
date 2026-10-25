import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { categoriesRouter } from './routes/categories.js'
import { participantsRouter } from './routes/participants.js'
import { scanRouter } from './routes/scan.js'
import { dashboardRouter } from './routes/dashboard.js'
import { transactionsRouter } from './routes/transactions.js'
import { settingsRouter } from './routes/settings.js'
import { printingRouter } from './routes/printing.js'
import { labelsRouter } from './routes/labels.js'
import { correctionsRouter } from './routes/corrections.js'
import { reportsRouter } from './routes/reports.js'
import { activityRouter } from './routes/activity.js'
import { backupRouter, fullExportRouter, resetDemoRouter } from './routes/backup.js'
import { setupRouter } from './routes/setup.js'
import { appInfoRouter } from './routes/appInfo.js'
import { errorHandler } from './middleware/errorHandler.js'

/**
 * Strict CSP for the packaged app (one origin, no external assets).
 * `frame-ancestors 'none'` stops the UI being embedded; the dev preview sets
 * APP_ALLOW_FRAME_EMBED=true to opt out (never set in the packaged app).
 */
const allowFrameEmbed = process.env.APP_ALLOW_FRAME_EMBED === 'true'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  ...(allowFrameEmbed ? [] : ["frame-ancestors 'none'"]),
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export interface CreateAppOptions {
  /**
   * Folder with the built frontend (frontend/dist). When set, the backend serves
   * the SPA itself so the app runs on a single origin and cookies work.
   * Left undefined in development, where Vite serves the UI.
   */
  staticDir?: string | null
  /** Force the strict CSP even in development (default: only when serving the SPA). */
  strictCsp?: boolean
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : null
  const serveSpa = !!staticDir && fs.existsSync(path.join(staticDir, 'index.html'))

  app.disable('x-powered-by')

  // Security headers. CSP is only applied to the SPA build: in dev the Vite
  // client needs inline scripts and a websocket, which this policy forbids.
  app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: allowFrameEmbed ? false : { action: 'deny' },
  }))
  if (serveSpa || options.strictCsp) {
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
      next()
    })
  }

  // Request size limits
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  // Rate limit on auth endpoints
  const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
  })

  const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // Health check
  app.get('/api/health', (_req, res) => { res.json({ ok: true, ts: new Date().toISOString() }) })

  // First-run setup (unauthenticated, loopback-only, self-disabling)
  app.use('/api/setup', setupRouter)
  app.use('/api/app-info', appInfoRouter)

  // Routes
  app.use('/api/auth', authLimiter, authRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/categories', categoriesRouter)
  app.use('/api/participants/import', uploadLimiter)
  app.use('/api/participants', participantsRouter)
  app.use('/api/scan', scanRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api/transactions', transactionsRouter)
  app.use('/api', correctionsRouter)
  app.use('/api/activity', activityRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/backup', backupRouter)
  app.use('/api/export', fullExportRouter)
  app.use('/api/settings', resetDemoRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/printing', printingRouter)
  app.use('/api/labels', labelsRouter)

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } })
  })

  // ─── Static frontend + SPA fallback (packaged builds) ──────────────────────
  if (serveSpa) {
    app.use(express.static(staticDir!, {
      index: false,
      setHeaders: (res, filePath) => {
        // Hashed assets are immutable; index.html must always be revalidated.
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }))
    // SPA fallback: any non-API GET returns index.html (client-side routing).
    // Written as middleware so it works on both Express 4 and 5 path syntax.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return }
      res.sendFile(path.join(staticDir!, 'index.html'), (error) => {
        if (error) next(error)
      })
    })
  }

  // Global error handler (must be last)
  app.use(errorHandler)

  return app
}
