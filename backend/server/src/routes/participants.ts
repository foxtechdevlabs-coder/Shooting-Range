import { Router } from 'express'
import ExcelJS from 'exceljs'
import { z } from 'zod'
import { getSqlite } from '../db/connection.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { apiError } from '../middleware/errorHandler.js'
import { upload, verifyXlsxSignature } from '../middleware/upload.js'
import type { Participant, Category } from '../db/schema.js'

export const participantsRouter = Router()
participantsRouter.use(requireAuth)

// ─── Import preview store (in-memory, 30 min TTL) ────────────────────────────

interface PreviewEntry {
  valid: ParsedParticipant[]
  errors: ImportError[]
  fileName: string
  createdAt: number
}

interface ParsedParticipant {
  bib_number: string
  noc: string
  name: string
  department: string
  gun_number: string
  contact_number: string
  category_id: number
  category_name: string
}

interface ImportError {
  row: number
  values: Record<string, string>
  reasons: string[]
}

const previews = new Map<string, PreviewEntry>()

// Clean up expired previews every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, entry] of previews.entries()) {
    if (entry.createdAt < cutoff) previews.delete(id)
  }
}, 5 * 60 * 1000)

function formatParticipant(p: Participant & { category_name?: string }) {
  return {
    id: p.id,
    bib_number: p.bib_number,
    noc: p.noc,
    name: p.name,
    department: p.department,
    gun_number: p.gun_number,
    contact_number: p.contact_number,
    category_id: p.category_id,
    category_name: p.category_name ?? null,
    pouch_status: p.pouch_status,
    label_printed: Boolean(p.label_printed),
    label_stale: Boolean(p.label_stale),
    label_printed_at: p.label_printed_at ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

// ─── GET /api/participants ────────────────────────────────────────────────────

const querySchema = z.object({
  search: z.string().optional(),
  noc: z.string().optional(),
  department: z.string().optional(),
  category_id: z.coerce.number().optional(),
  pouch_status: z.enum(['in', 'out']).optional(),
  label_status: z.enum(['all', 'printed', 'unprinted', 'stale']).optional(),
  page: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(20),
  sort: z.enum(['bib_number', 'name', 'noc', 'gun_number', 'created_at', 'pouch_status']).default('bib_number'),
  order: z.enum(['asc', 'desc']).default('asc'),
})

participantsRouter.get('/', requirePermission('participants.view'), (req, res, next) => {
  try {
    const query = querySchema.parse(req.query)
    const db = getSqlite()

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.search) {
      conditions.push('(p.bib_number LIKE ? OR p.name LIKE ? OR p.noc LIKE ? OR p.gun_number LIKE ?)')
      const s = `%${query.search}%`
      params.push(s, s, s, s)
    }
    if (query.noc) { conditions.push('p.noc = ?'); params.push(query.noc.toUpperCase()) }
    if (query.department) { conditions.push('p.department = ?'); params.push(query.department) }
    if (query.category_id) { conditions.push('p.category_id = ?'); params.push(query.category_id) }
    if (query.pouch_status) { conditions.push('p.pouch_status = ?'); params.push(query.pouch_status) }
    if (query.label_status === 'printed') { conditions.push('p.label_printed = 1 AND p.label_stale = 0') }
    if (query.label_status === 'unprinted') { conditions.push('p.label_printed = 0') }
    if (query.label_status === 'stale') { conditions.push('p.label_stale = 1') }


    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const allowedSort = ['bib_number', 'name', 'noc', 'gun_number', 'created_at', 'pouch_status']
    const sortCol = allowedSort.includes(query.sort) ? query.sort : 'bib_number'
    const order = query.order === 'desc' ? 'DESC' : 'ASC'

    const total = (db.prepare(`SELECT COUNT(*) as c FROM participants p ${where}`).get(...params) as { c: number }).c
    const rows = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM participants p
      LEFT JOIN categories c ON c.id = p.category_id
      ${where}
      ORDER BY p.${sortCol} ${order}
      LIMIT ? OFFSET ?
    `).all(...params, query.limit, query.page * query.limit) as (Participant & { category_name: string })[]

    res.json({ data: rows.map(formatParticipant), total, page: query.page, limit: query.limit })
  } catch (err) { next(err) }
})

// ─── GET /api/participants/:id ────────────────────────────────────────────────

participantsRouter.get('/:id', requirePermission('participants.view'), (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) apiError(400, 'INVALID_ID', 'Invalid participant ID')
    const db = getSqlite()
    const p = db.prepare('SELECT p.*, c.name as category_name FROM participants p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?').get(id) as (Participant & { category_name: string }) | undefined
    if (!p) apiError(404, 'NOT_FOUND', 'Participant not found')
    const txs = db.prepare('SELECT t.*, u.full_name as user_name FROM transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.participant_id = ? ORDER BY t.created_at DESC').all(id)
    res.json({ participant: formatParticipant(p), transactions: txs })
  } catch (err) { next(err) }
})

// ─── POST /api/participants ───────────────────────────────────────────────────

const createSchema = z.object({
  bib_number: z.string().trim().min(1, 'Bib number is required'),
  noc: z.string().trim().regex(/^[A-Z]{2,3}$/, 'NOC must be 2–3 uppercase letters'),
  name: z.string().trim().min(1).max(100),
  department: z.string().trim().max(100).optional().or(z.literal('')),
  gun_number: z.string().trim().min(1, 'Gun number is required'),
  contact_number: z.string().trim().optional().or(z.literal('')),
  category_id: z.number().int().positive(),
})

participantsRouter.post('/', requirePermission('participants.create'), (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const db = getSqlite()
    const now = new Date().toISOString()

    // Normalize gun_number and noc to uppercase
    const gun_number = body.gun_number.toUpperCase()
    const noc = body.noc.toUpperCase()

    const fields: Record<string, string> = {}
    const dupBib = db.prepare('SELECT id FROM participants WHERE bib_number = ? COLLATE NOCASE').get(body.bib_number)
    if (dupBib) fields['bib_number'] = 'This bib number is already assigned.'
    const dupGun = db.prepare('SELECT id FROM participants WHERE gun_number = ? COLLATE NOCASE').get(gun_number)
    if (dupGun) fields['gun_number'] = 'This gun number is already assigned.'
    if (Object.keys(fields).length > 0) apiError(409, 'DUPLICATE_FIELD', 'Duplicate fields', fields)

    const catExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(body.category_id)
    if (!catExists) apiError(400, 'INVALID_CATEGORY', 'Category not found.')

    const result = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, department, gun_number, contact_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'in', 0, ?, ?)
    `).run(body.bib_number, noc, body.name, body.department || null, gun_number, body.contact_number || null, body.category_id, now, now)

    const newP = db.prepare('SELECT p.*, c.name as category_name FROM participants p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?').get(result.lastInsertRowid) as Participant & { category_name: string }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at) VALUES (?, 'CREATE_PARTICIPANT', 'participant', ?, ?, ?)`).run(req.user!.id, String(newP.id), JSON.stringify({ bib_number: newP.bib_number, name: newP.name }), now)

    res.status(201).json({ participant: formatParticipant(newP) })
  } catch (err) { next(err) }
})

// ─── PATCH /api/participants/:id ──────────────────────────────────────────────

const updateSchema = createSchema.partial()

participantsRouter.patch('/:id', requirePermission('participants.edit'), (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) apiError(400, 'INVALID_ID', 'Invalid participant ID')
    const body = updateSchema.parse(req.body)
    const db = getSqlite()
    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as Participant | undefined
    if (!existing) apiError(404, 'NOT_FOUND', 'Participant not found')

    const gun_number = body.gun_number ? body.gun_number.toUpperCase() : undefined
    const gunChanged = gun_number !== undefined && gun_number !== existing.gun_number
    const noc = body.noc ? body.noc.toUpperCase() : undefined

    const fields: Record<string, string> = {}
    if (body.bib_number) {
      const dup = db.prepare('SELECT id FROM participants WHERE bib_number = ? COLLATE NOCASE AND id != ?').get(body.bib_number, id)
      if (dup) fields['bib_number'] = 'This bib number is already assigned.'
    }
    if (gun_number) {
      const dup = db.prepare('SELECT id FROM participants WHERE gun_number = ? COLLATE NOCASE AND id != ?').get(gun_number, id)
      if (dup) fields['gun_number'] = 'This gun number is already assigned.'
    }
    if (Object.keys(fields).length > 0) apiError(409, 'DUPLICATE_FIELD', 'Duplicate fields', fields)

    const old_values = formatParticipant(existing as Participant & { category_name?: string })
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE participants SET
        bib_number = COALESCE(?, bib_number),
        noc = COALESCE(?, noc),
        name = COALESCE(?, name),
        department = COALESCE(?, department),
        gun_number = COALESCE(?, gun_number),
        contact_number = COALESCE(?, contact_number),
        category_id = COALESCE(?, category_id),
        label_printed = CASE WHEN ? = 1 THEN 0 ELSE label_printed END,
        label_stale = CASE WHEN ? = 1 THEN 1 ELSE label_stale END,
        updated_at = ?
      WHERE id = ?
    `).run(
      body.bib_number ?? null, noc ?? null, body.name ?? null,
      body.department !== undefined ? (body.department || null) : null,
      gun_number ?? null,
      body.contact_number !== undefined ? (body.contact_number || null) : null,
      body.category_id ?? null,
      gunChanged ? 1 : 0,
      gunChanged ? 1 : 0,
      now, id
    )

    const updated = db.prepare('SELECT p.*, c.name as category_name FROM participants p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?').get(id) as Participant & { category_name: string }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, old_values, new_values, created_at) VALUES (?, 'UPDATE_PARTICIPANT', 'participant', ?, ?, ?, ?)`).run(req.user!.id, String(id), JSON.stringify(old_values), JSON.stringify(formatParticipant(updated)), now)


    res.json({ participant: formatParticipant(updated) })
  } catch (err) { next(err) }
})

// ─── DELETE /api/participants/:id ─────────────────────────────────────────────

participantsRouter.delete('/:id', requirePermission('participants.delete'), (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) apiError(400, 'INVALID_ID', 'Invalid participant ID')
    const db = getSqlite()
    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as Participant | undefined
    if (!existing) apiError(404, 'NOT_FOUND', 'Participant not found')

    const txCount = (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE participant_id = ?').get(id) as { c: number }).c
    if (txCount > 0) apiError(409, 'HAS_TRANSACTIONS', 'Cannot delete a participant with transaction history.')

    const now = new Date().toISOString()
    db.prepare('DELETE FROM participants WHERE id = ?').run(id)

    db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, old_values, created_at) VALUES (?, 'DELETE_PARTICIPANT', 'participant', ?, ?, ?)`).run(req.user!.id, String(id), JSON.stringify({ bib_number: existing.bib_number, name: existing.name }), now)

    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ─── Import: GET /api/participants/import/template ────────────────────────────

participantsRouter.get('/import/template', requirePermission('import.use'), (req, res, next) => {
  void (async () => {
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Participants')
      ws.columns = [
        { header: 'bib_number', key: 'bib_number', width: 12 },
        { header: 'noc', key: 'noc', width: 8 },
        { header: 'name', key: 'name', width: 30 },
        { header: 'department', key: 'department', width: 20 },
        { header: 'gun_number', key: 'gun_number', width: 14 },
        { header: 'contact_number', key: 'contact_number', width: 20 },
        { header: 'category', key: 'category', width: 18 },
      ]
      ws.addRow(['101', 'IND', 'Example Participant', 'Air Rifle', 'G-201', '+91 98765 43210', 'Senior Men'])
      const buf = await wb.xlsx.writeBuffer()
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', 'attachment; filename="participants-template.xlsx"')
      res.send(Buffer.from(buf))
    } catch (err) { next(err) }
  })()
})

// ─── Import: POST /api/participants/import/preview ────────────────────────────

participantsRouter.post('/import/preview', requirePermission('import.use'), upload.single('file'), (req, res, next) => {
  void (async () => {
    try {
      if (!req.file) apiError(400, 'NO_FILE', 'No file uploaded.')
      if (!verifyXlsxSignature(req.file!.buffer)) apiError(400, 'INVALID_FILE', 'The uploaded file does not appear to be a valid .xlsx file.')

      const db = getSqlite()
      const cats = db.prepare('SELECT * FROM categories').all() as Category[]
      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c]))

      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(req.file!.buffer as any)
      const ws = wb.worksheets[0]
      if (!ws) apiError(400, 'NO_WORKSHEET', 'The workbook has no worksheets.')

      // Read header row
      const headerRow = ws.getRow(1)
      const headers: string[] = []
      headerRow.eachCell((cell) => headers.push(String(cell.value ?? '').trim().toLowerCase()))

      const REQUIRED_COLS = ['bib_number', 'noc', 'name', 'gun_number', 'category']
      const OPTIONAL_COLS = ['department', 'contact_number']
      const ALL_COLS = [...REQUIRED_COLS, ...OPTIONAL_COLS]
      const missing = REQUIRED_COLS.filter((c) => !headers.includes(c))
      if (missing.length > 0) apiError(400, 'MISSING_COLUMNS', `Missing required columns: ${missing.join(', ')}`)

      // Existing data for duplicate checking
      const existingBibs = new Set((db.prepare('SELECT bib_number FROM participants').all() as { bib_number: string }[]).map((r) => r.bib_number.toUpperCase()))
      const existingGuns = new Set((db.prepare('SELECT gun_number FROM participants').all() as { gun_number: string }[]).map((r) => r.gun_number.toUpperCase()))

      const seenBibs = new Set<string>()
      const seenGuns = new Set<string>()
      const valid: ParsedParticipant[] = []
      const errors: ImportError[] = []

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return // skip header

        const values: Record<string, string> = {}
        headers.forEach((header, i) => {
          if (ALL_COLS.includes(header)) {
            values[header] = String(row.getCell(i + 1).value ?? '').trim()
          }
        })

        const reasons: string[] = []
        const bib = (values['bib_number'] ?? '').toUpperCase()
        const gun = (values['gun_number'] ?? '').toUpperCase()
        const noc = (values['noc'] ?? '').toUpperCase()
        const name = values['name'] ?? ''
        const catName = values['category'] ?? ''
        const dept = values['department'] ?? ''
        const contact = values['contact_number'] ?? ''

        if (!bib) reasons.push('bib_number is required')
        if (!noc) reasons.push('noc is required')
        else if (!/^[A-Z]{2,3}$/.test(noc)) reasons.push('noc must be 2–3 uppercase letters')
        if (!name) reasons.push('name is required')
        if (name.length > 100) reasons.push('name is too long (max 100)')
        if (!gun) reasons.push('gun_number is required')
        if (!catName) reasons.push('category is required')
        if (contact && !/^[\d\s+]+$/.test(contact)) reasons.push('contact_number has invalid characters')

        // Category lookup
        const cat = catByName.get(catName.toLowerCase())
        if (catName && !cat) reasons.push(`unknown category: "${catName}"`)

        // Duplicate in file
        if (bib && seenBibs.has(bib)) reasons.push('duplicate bib_number in this file')
        if (gun && seenGuns.has(gun)) reasons.push('duplicate gun_number in this file')

        // Duplicate in DB
        if (bib && existingBibs.has(bib) && !seenBibs.has(bib)) reasons.push('bib_number already exists in database')
        if (gun && existingGuns.has(gun) && !seenGuns.has(gun)) reasons.push('gun_number already exists in database')

        if (bib) seenBibs.add(bib)
        if (gun) seenGuns.add(gun)

        if (reasons.length > 0) {
          errors.push({ row: rowNum, values: { ...values, bib_number: bib, gun_number: gun, noc }, reasons })
        } else {
          valid.push({
            bib_number: bib, noc, name, department: dept,
            gun_number: gun, contact_number: contact,
            category_id: cat!.id, category_name: cat!.name,
          })
        }
      })

      // Store preview
      const previewId = Math.random().toString(36).slice(2) + Date.now().toString(36)
      previews.set(previewId, { valid, errors, fileName: req.file!.originalname, createdAt: Date.now() })

      res.json({ previewId, valid, errors, total: valid.length + errors.length })
    } catch (err) { next(err) }
  })()
})

// ─── Import: POST /api/participants/import/commit ─────────────────────────────

const commitSchema = z.object({
  previewId: z.string().min(1),
  mode: z.enum(['skip', 'update']),
})

participantsRouter.post('/import/commit', requirePermission('import.use'), (req, res, next) => {
  try {
    const body = commitSchema.parse(req.body)
    const entry = previews.get(body.previewId)
    if (!entry) apiError(404, 'PREVIEW_NOT_FOUND', 'Preview not found or expired. Please re-upload the file.')
    if (Date.now() - entry!.createdAt > 30 * 60 * 1000) {
      previews.delete(body.previewId)
      apiError(410, 'PREVIEW_EXPIRED', 'Preview expired. Please re-upload the file.')
    }

    const db = getSqlite()
    const now = new Date().toISOString()
    let imported = 0, updated = 0, rejected = 0

    // Run in single transaction
    const doImport = db.transaction(() => {
      for (const row of entry!.valid) {
        const existingBib = db.prepare('SELECT id FROM participants WHERE bib_number = ? COLLATE NOCASE').get(row.bib_number) as { id: number } | undefined
        if (existingBib) {
          if (body.mode === 'skip') { rejected++; continue }
          // update mode
          db.prepare(`
            UPDATE participants SET noc = ?, name = ?, department = ?, gun_number = ?, contact_number = ?, category_id = ?, updated_at = ?
            WHERE id = ?
          `).run(row.noc, row.name, row.department || null, row.gun_number, row.contact_number || null, row.category_id, now, existingBib.id)
          updated++
        } else {
          db.prepare(`
            INSERT INTO participants (bib_number, noc, name, department, gun_number, contact_number, category_id, pouch_status, label_printed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'in', 0, ?, ?)
          `).run(row.bib_number, row.noc, row.name, row.department || null, row.gun_number, row.contact_number || null, row.category_id, now, now)
          imported++
        }
      }
    })
    doImport()

    // Record import batch
    const batchResult = db.prepare(`
      INSERT INTO import_batches (user_id, file_name, rows_imported, rows_updated, rows_rejected, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user!.id, entry!.fileName, imported, updated, rejected, now)

    db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at) VALUES (?, 'IMPORT_PARTICIPANTS', 'import_batch', ?, ?, ?)`).run(
      req.user!.id, String(batchResult.lastInsertRowid),
      JSON.stringify({ imported, updated, rejected, file: entry!.fileName }), now
    )

    previews.delete(body.previewId)
    res.json({ imported, updated, rejected })
  } catch (err) { next(err) }
})

// ─── Import: GET /api/participants/import/errors/:previewId ──────────────────

participantsRouter.get('/import/errors/:previewId', requirePermission('import.use'), (req, res, next) => {
  void (async () => {
    try {
      const entry = previews.get(String(req.params.previewId))
      if (!entry) apiError(404, 'PREVIEW_NOT_FOUND', 'Preview not found or expired.')

      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Import Errors')
      ws.columns = [
        { header: 'Row', key: 'row', width: 8 },
        { header: 'bib_number', key: 'bib_number', width: 12 },
        { header: 'noc', key: 'noc', width: 8 },
        { header: 'name', key: 'name', width: 30 },
        { header: 'department', key: 'department', width: 20 },
        { header: 'gun_number', key: 'gun_number', width: 14 },
        { header: 'contact_number', key: 'contact_number', width: 20 },
        { header: 'category', key: 'category', width: 18 },
        { header: 'Errors', key: 'errors', width: 60 },
      ]
      for (const err of entry!.errors) {
        ws.addRow({ row: err.row, ...err.values, errors: err.reasons.join('; ') })
      }
      const buf = await wb.xlsx.writeBuffer()
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', 'attachment; filename="import-errors.xlsx"')
      res.send(Buffer.from(buf))
    } catch (err) { next(err) }
  })()
})
