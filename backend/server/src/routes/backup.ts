import { Router } from 'express'
import BetterSQLite3 from 'better-sqlite3'
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { getSqlite, closeDb } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedDemo } from '../db/seed.demo.js'
import { config } from '../config.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import { createDatabaseBackup, defaultBackupFolder, getBackupStatus, validateBackupFolder } from '../services/backup.js'

export const backupRouter = Router()
backupRouter.use(requireAuth)
backupRouter.use(requireAdmin)

export const fullExportRouter = Router()

export const resetDemoRouter = Router()

const restoreTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-restore-'))
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: restoreTempDir,
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.db`),
  }),
  limits: { fileSize: 1024 * 1024 * 500, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname.toLowerCase().endsWith('.db')) {
      callback(new Error('Only .db files are accepted'))
      return
    }
    callback(null, true)
  },
})

function validateDatabaseFile(filePath: string) {
  const fd = fs.openSync(filePath, 'r')
  const header = Buffer.alloc(16)
  try { fs.readSync(fd, header, 0, 16, 0) } finally { fs.closeSync(fd) }
  if (header.toString('binary') !== 'SQLite format 3\u0000') apiError(400, 'INVALID_DATABASE', 'The uploaded file is not a valid SQLite database.')
  let candidate: BetterSQLite3.Database | undefined
  try {
    candidate = new BetterSQLite3(filePath, { readonly: true, fileMustExist: true })
    const integrity = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') apiError(400, 'DATABASE_INTEGRITY_FAILED', 'Database integrity check failed.')
    const tables = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((item) => item.name))
    const requiredTables = ['users', 'participants', 'transactions', 'activity_log', 'corrections', '_migrations']
    if (requiredTables.some((table) => !tables.has(table))) apiError(400, 'DATABASE_SCHEMA_INVALID', 'The uploaded database is missing required tables.')
    const migrations = new Set((candidate.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((item) => item.name))
    if (!migrations.has('0001_initial.sql') || !migrations.has('0002_barcode_printing.sql') || !migrations.has('0003_corrections.sql')) {
      apiError(400, 'DATABASE_SCHEMA_VERSION', 'The uploaded database schema version is unsupported.')
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error) throw error
    apiError(400, 'DATABASE_INVALID', 'The uploaded database could not be opened.')
  } finally {
    candidate?.close()
  }
}

backupRouter.get('/status', (_req, res, next) => {
  try { res.json({ ...getBackupStatus(), allowDemoReset: process.env.ALLOW_DEMO_RESET === 'true' }) } catch (error) { next(error) }
})

backupRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body as { destinationPath?: unknown }
    if (body.destinationPath !== undefined && typeof body.destinationPath !== 'string') {
      apiError(400, 'INVALID_BACKUP_PATH', 'destinationPath must be a folder path.')
    }
    const folder = body.destinationPath ? validateBackupFolder(body.destinationPath as string) : defaultBackupFolder()
    const result = await createDatabaseBackup(folder, true)
    res.status(201).json({ filename: result.filename, createdAt: result.createdAt, destination: result.path })
  } catch (error) { next(error) }
})

backupRouter.get('/download', async (_req, res, next) => {
  const filePath = path.join(os.tmpdir(), `rangeops-download-${randomUUID()}.db`)
  try {
    await getSqlite().backup(filePath)
    res.download(filePath, `shootingrange-backup-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.db`, (error) => {
      fs.rmSync(filePath, { force: true })
      if (error && !res.headersSent) next(error)
    })
  } catch (error) {
    fs.rmSync(filePath, { force: true })
    next(Object.assign(new Error(`Backup download failed: ${error instanceof Error ? error.message : 'database backup failed'}`), { status: 500, code: 'BACKUP_FAILED' }))
  }
})

backupRouter.post('/restore', restoreUpload.single('file'), (req, res, next) => {
  const uploadedPath = req.file?.path
  try {
    if (!req.file) apiError(400, 'NO_FILE', 'Upload a SQLite .db file to restore.')
    if (req.body.confirm !== 'RESTORE') apiError(400, 'RESTORE_CONFIRMATION_REQUIRED', 'Type RESTORE to confirm this operation.')
    validateDatabaseFile(uploadedPath!)
    const folder = validateBackupFolder(defaultBackupFolder())
    const preRestore = createDatabaseBackup(folder).then((result) => result.path)
    void preRestore.then((preRestorePath) => {
      const originalPath = config.dbPath
      const replacedOldPath = `${originalPath}.pre-restore-${randomUUID()}`
      const replacementPath = `${originalPath}.restore-${randomUUID()}`
      try {
        const liveDb = getSqlite()
        liveDb.pragma('wal_checkpoint(TRUNCATE)')
        closeDb()
        fs.copyFileSync(uploadedPath!, replacementPath)
        fs.renameSync(originalPath, replacedOldPath)
        try {
          fs.renameSync(replacementPath, originalPath)
          for (const suffix of ['-wal', '-shm']) fs.rmSync(`${originalPath}${suffix}`, { force: true })
          runMigrations()
          const db = getSqlite()
          const actor = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user!.id) as { id: number } | undefined
          db.prepare(`INSERT INTO activity_log (user_id, action, entity, old_values, new_values, created_at)
            VALUES (?, 'RESTORE_DATABASE', 'database', ?, ?, ?)`)
            .run(actor?.id ?? null, JSON.stringify({ replaced: true }), JSON.stringify({ pre_restore_backup: preRestorePath }), new Date().toISOString())
          fs.rmSync(replacedOldPath, { force: true })
          fs.rmSync(uploadedPath!, { force: true })
          res.json({ ok: true, preRestoreBackup: path.basename(preRestorePath) })
        } catch (error) {
          closeDb()
          fs.rmSync(originalPath, { force: true })
          fs.renameSync(replacedOldPath, originalPath)
          runMigrations()
          throw error
        }
      } catch (error) {
        if (fs.existsSync(replacedOldPath) && !fs.existsSync(originalPath)) fs.renameSync(replacedOldPath, originalPath)
        next(Object.assign(new Error(`Restore failed; the existing database was preserved. ${error instanceof Error ? error.message : ''}`), { status: 500, code: 'RESTORE_FAILED' }))
      } finally {
        fs.rmSync(replacementPath, { force: true })
        fs.rmSync(uploadedPath!, { force: true })
      }
    }).catch(next)
  } catch (error) {
    if (uploadedPath) fs.rmSync(uploadedPath, { force: true })
    next(error)
  }
})

fullExportRouter.get('/all', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = getSqlite()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO activity_log (user_id, action, entity, new_values, created_at)
      VALUES (?, 'EXPORT_ALL_DATA', 'database', ?, ?)`).run(req.user!.id, JSON.stringify({ format: 'xlsx' }), now)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="shootingrange-export-all.xlsx"')
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false, useSharedStrings: false })
    const sheets: Array<[string, Iterable<Record<string, unknown>>]> = [
      ['Participants', db.prepare(`SELECT p.*, c.name AS category FROM participants p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id`).iterate() as Iterable<Record<string, unknown>>],
      ['Transactions', (await import('../services/effectiveTransactions.js')).effectiveTransactions(db).map((row) => ({ ...row }))],
      ['Corrections', db.prepare(`SELECT c.*, u.full_name AS user_name FROM corrections c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id`).iterate() as Iterable<Record<string, unknown>>],
      ['Activity', db.prepare(`SELECT a.*, u.full_name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id`).iterate() as Iterable<Record<string, unknown>>],
    ]
    for (const [name, rows] of sheets) {
      const sheet = workbook.addWorksheet(name)
      let header: string[] | undefined
      for (const row of rows) {
        if (!header) {
          header = Object.keys(row)
          sheet.addRow(header).commit()
        }
        sheet.addRow(header.map((key) => {
          const value = row[key]
          return typeof value === 'string' && value.length > 32000 ? value.slice(0, 32000) : value as string | number | boolean | null | undefined
        })).commit()
      }
      if (!header) sheet.addRow(['No records']).commit()
      sheet.commit()
    }
    await workbook.commit()
  } catch (error) { next(error) }
})

resetDemoRouter.post('/reset-demo', requireAuth, requireAdmin, (_req, res, next) => {
  if (process.env.ALLOW_DEMO_RESET !== 'true') {
    res.status(403).json({ error: { code: 'DEMO_RESET_DISABLED', message: 'Demo reset is disabled on this server.' } })
    return
  }
  try {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${config.dbPath}${suffix}`, { force: true })
    runMigrations()
    void seedDemo().then(() => res.json({ ok: true })).catch(next)
  } catch (error) { next(error) }
})
