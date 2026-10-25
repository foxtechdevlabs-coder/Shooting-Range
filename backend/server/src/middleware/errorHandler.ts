/**
 * Global error handler.
 * Hides internal details; writes structured entries to logs/app.log and stderr.
 * Always returns consistent { error: { code, message, fields? } } JSON.
 */
import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../services/logger.js'

function routeOf(req: Request): string {
  return `${req.method} ${req.originalUrl.split('?')[0]}`
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  // Already responded
  if (res.headersSent) {
    logger.error('Error after response was sent', { route: routeOf(req), error: err })
    next(err)
    return
  }

  // Zod validation errors: 400, warn level, no stack trace
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    logger.warn('VALIDATION_ERROR', { route: routeOf(req), issues })
    console.warn('[WARN] VALIDATION_ERROR', issues)
    const fields: Record<string, string> = {}
    for (const issue of err.issues) {
      const key = issue.path.join('.')
      fields[key] = issue.message
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed. Check the fields below.',
        fields,
      },
    })
    return
  }

  // Known API errors with a status (thrown by apiError)
  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as Record<string, unknown>).status === 'number' &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  ) {
    const e = err as { status: number; code: string; message?: string; fields?: Record<string, string> }
    const message = typeof e.message === 'string' ? e.message : 'Request failed.'
    if (e.status >= 500) {
      logger.error('API error', { route: routeOf(req), status: e.status, code: e.code, message })
    } else if (e.status !== 404) {
      logger.warn('API error', { route: routeOf(req), status: e.status, code: e.code, message })
    }
    res.status(e.status).json({
      error: {
        code: e.code,
        message,
        ...(e.fields ? { fields: e.fields } : {}),
      },
    })
    return
  }

  // Multer / upload errors
  if (err instanceof Error && (err.message === 'Only .xlsx files are accepted' || err.name === 'MulterError')) {
    logger.warn('Upload rejected', { route: routeOf(req), message: err.message })
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: err.message },
    })
    return
  }

  // Generic 500 — log the stack to the log file, never to the client
  const error = err instanceof Error ? err : new Error(String(err))
  logger.error('Unhandled error', {
    route: routeOf(req),
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 12).join('\n'),
  })
  console.error('[ERROR]', err)

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    },
  })
}

/** Helper: throw a structured API error */
export function apiError(status: number, code: string, message: string, fields?: Record<string, string>): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw { status, code, message, fields }
}
