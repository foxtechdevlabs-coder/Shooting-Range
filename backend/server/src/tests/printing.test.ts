import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'

import { loginAs } from './helpers.js'
import { getSqlite } from '../db/connection.js'
import * as printerModule from '../services/printer.js'

describe('Printing and Barcode Labels API', () => {
  it('enforces permissions: staff without barcodes.print gets 403', async () => {
    const staff = await loginAs('staff', 'StaffPass123')
    const res = await staff.post('/api/labels/print').send({
      selection: { type: 'unprinted' },
    })
    expect(res.status).toBe(403)
  })

  it('enforces permissions: staff without settings.manage gets 403 on printing admin routes', async () => {
    const staff = await loginAs('staff', 'StaffPass123')
    const res = await staff.get('/api/printing/printers')
    expect(res.status).toBe(403)

    const testRes = await staff.post('/api/printing/test')
    expect(testRes.status).toBe(403)
  })

  it('admin can list printers and print a test label', async () => {
    const admin = await loginAs('admin', 'AdminPass123')
    const listRes = await admin.get('/api/printing/printers')
    expect(listRes.status).toBe(200)
    expect(listRes.body).toHaveProperty('printers')
    expect(listRes.body).toHaveProperty('driver')

    const testRes = await admin.post('/api/printing/test')
    expect(testRes.status).toBe(200)
    expect(testRes.body.ok).toBe(true)
    expect(testRes.body.jobId).toBeGreaterThan(0)

    const db = getSqlite()
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(testRes.body.jobId) as any
    expect(job).toBeDefined()
    expect(job.kind).toBe('test')
    expect(job.status).toBe('sent')
  })

  it('first print marks participants printed; second print without reason fails; with reason succeeds as reprint', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()

    // Insert fresh participant
    const insertRes = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('501', 'IND', 'Print Test Athlete', 'G-501', 1, 'in', 0, ?, ?)
    `).run(now, now)
    const pId = Number(insertRes.lastInsertRowid)

    const printerStaff = await loginAs('printerstaff', 'StaffPass123')

    // First print
    const print1 = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'ids', ids: [pId] },
    })
    expect(print1.status).toBe(200)
    expect(print1.body.count).toBe(1)
    expect(print1.body.status).toBe('sent')

    const pAfter1 = db.prepare('SELECT * FROM participants WHERE id = ?').get(pId) as any
    expect(pAfter1.label_printed).toBe(1)
    expect(pAfter1.label_stale).toBe(0)
    expect(pAfter1.label_printed_at).not.toBeNull()

    const job1 = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(print1.body.jobId) as any
    expect(job1.kind).toBe('print')

    // Second print without reason -> 400 REASON_REQUIRED
    const print2Fail = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'ids', ids: [pId] },
    })
    expect(print2Fail.status).toBe(400)
    expect(print2Fail.body.error.code).toBe('REASON_REQUIRED')

    // Second print with short reason (< 3 chars) -> 400 REASON_REQUIRED
    const print2Short = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'ids', ids: [pId] },
      reason: 'no',
    })
    expect(print2Short.status).toBe(400)
    expect(print2Short.body.error.code).toBe('REASON_REQUIRED')

    // Second print with valid reason -> 200, kind "reprint"
    const print2Success = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'ids', ids: [pId] },
      reason: 'Label damaged during practice',
    })
    expect(print2Success.status).toBe(200)

    const job2 = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(print2Success.body.jobId) as any
    expect(job2.kind).toBe('reprint')
    expect(job2.reason).toBe('Label damaged during practice')
  })

  it('unprinted selection only includes participants with label_printed = false', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()

    // Participant A: printed
    const rA = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('601', 'IND', 'Printed Athlete', 'G-601', 1, 'in', 1, ?, ?)
    `).run(now, now)

    // Participant B: unprinted
    const rB = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('602', 'IND', 'Unprinted Athlete', 'G-602', 1, 'in', 0, ?, ?)
    `).run(now, now)

    const printerStaff = await loginAs('printerstaff', 'StaffPass123')
    const res = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'unprinted' },
    })

    expect(res.status).toBe(200)

    // Check items printed in this job: only 602, not 601
    const items = db.prepare('SELECT * FROM print_job_items WHERE job_id = ?').all(res.body.jobId) as any[]
    const gunNumbers = items.map((i) => i.gun_number)
    expect(gunNumbers).toContain('G-602')
    expect(gunNumbers).not.toContain('G-601')
  })

  it('changing a gun number sets label_stale = true and label_printed = false', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()

    // Insert printed participant
    const r = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('701', 'IND', 'Gun Change Athlete', 'G-701', 1, 'in', 1, ?, ?)
    `).run(now, now)
    const pId = Number(r.lastInsertRowid)

    const admin = await loginAs('admin', 'AdminPass123')

    // PATCH with same gun number: stays printed, stale stays 0
    await admin.patch(`/api/participants/${pId}`).send({ gun_number: 'G-701' })
    const pSame = db.prepare('SELECT * FROM participants WHERE id = ?').get(pId) as any
    expect(pSame.label_printed).toBe(1)
    expect(pSame.label_stale).toBe(0)

    // PATCH with new gun number: label_printed becomes 0, label_stale becomes 1
    const patchRes = await admin.patch(`/api/participants/${pId}`).send({
      gun_number: 'G-701-NEW',
    })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.participant.label_printed).toBe(false)
    expect(patchRes.body.participant.label_stale).toBe(true)

    const pAfter = db.prepare('SELECT * FROM participants WHERE id = ?').get(pId) as any
    expect(pAfter.label_printed).toBe(0)
    expect(pAfter.label_stale).toBe(1)

    // Check activity_log contains old and new values
    const log = db.prepare("SELECT * FROM activity_log WHERE entity = 'participant' AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get(String(pId)) as any
    expect(log).toBeDefined()
    expect(log.old_values).toContain('G-701')
    expect(log.new_values).toContain('G-701-NEW')
  })

  it('failed print leaves participant flags unchanged and records a failed job', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()

    const r = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, label_stale, created_at, updated_at)
      VALUES ('801', 'IND', 'Fail Test Athlete', 'G-801', 1, 'in', 0, 0, ?, ?)
    `).run(now, now)
    const pId = Number(r.lastInsertRowid)

    // Mock printer transport failure using vi.spyOn
    const spy = vi.spyOn(printerModule, 'printZpl').mockRejectedValueOnce(
      new printerModule.PrinterError('SPOOL_FAILED', 'Simulated spooler failure')
    )

    try {
      const printerStaff = await loginAs('printerstaff', 'StaffPass123')
      const res = await printerStaff.post('/api/labels/print').send({
        selection: { type: 'ids', ids: [pId] },
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('SPOOL_FAILED')

      // Participant flags unchanged
      const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(pId) as any
      expect(p.label_printed).toBe(0)
      expect(p.label_stale).toBe(0)

      // Failed job recorded
      const failedJob = db.prepare("SELECT * FROM print_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1").get() as any
      expect(failedJob).toBeDefined()
      expect(failedJob.error).toContain('Simulated spooler failure')
    } finally {
      spy.mockRestore()
    }
  })


  it('print_jobs and print_job_items reject UPDATE and DELETE via triggers', () => {
    const db = getSqlite()
    const now = new Date().toISOString()

    const rJob = db.prepare(`
      INSERT INTO print_jobs (user_id, created_at, kind, label_count, reason, status, printer_name)
      VALUES (1, ?, 'test', 1, NULL, 'sent', 'TestPrinter')
    `).run(now)
    const jobId = Number(rJob.lastInsertRowid)

    const rItem = db.prepare(`
      INSERT INTO print_job_items (job_id, participant_id, gun_number)
      VALUES (?, NULL, 'GUN-TRIG')
    `).run(jobId)
    const itemId = Number(rItem.lastInsertRowid)

    // UPDATE on print_jobs should abort
    expect(() => {
      db.prepare('UPDATE print_jobs SET label_count = 99 WHERE id = ?').run(jobId)
    }).toThrow(/append-only/i)

    // DELETE on print_jobs should abort
    expect(() => {
      db.prepare('DELETE FROM print_jobs WHERE id = ?').run(jobId)
    }).toThrow(/append-only/i)

    // UPDATE on print_job_items should abort
    expect(() => {
      db.prepare("UPDATE print_job_items SET gun_number = 'CHANGED' WHERE id = ?").run(itemId)
    }).toThrow(/append-only/i)

    // DELETE on print_job_items should abort
    expect(() => {
      db.prepare('DELETE FROM print_job_items WHERE id = ?').run(itemId)
    }).toThrow(/append-only/i)
  })

  it('printing 5 labels with PRINT_DRIVER=file creates one .zpl file containing 5 labels', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()
    const ids: number[] = []

    for (let i = 1; i <= 5; i++) {
      const res = db.prepare(`
        INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
        VALUES (?, 'IND', ?, ?, 1, 'in', 0, ?, ?)
      `).run(`B90${i}`, `Batch Athlete ${i}`, `G-90${i}`, now, now)
      ids.push(Number(res.lastInsertRowid))
    }

    const printerStaff = await loginAs('printerstaff', 'StaffPass123')
    const res = await printerStaff.post('/api/labels/print').send({
      selection: { type: 'ids', ids },
    })

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(5)
    expect(res.body.driver).toBe('file')

    // Find created .zpl file in labels directory
    const labelsDir = path.join(process.env.DATA_DIR!, 'labels')
    expect(fs.existsSync(labelsDir)).toBe(true)

    const files = fs.readdirSync(labelsDir).filter((f) => f.endsWith('.zpl'))
    expect(files.length).toBeGreaterThan(0)

    // Get the most recent file
    const latestFile = files.sort().pop()!
    const fileContent = fs.readFileSync(path.join(labelsDir, latestFile), 'utf8')

    // Count ^XA and ^XZ in this file
    const xaCount = (fileContent.match(/\^XA/g) || []).length
    const xzCount = (fileContent.match(/\^XZ/g) || []).length

    expect(xaCount).toBe(5)
    expect(xzCount).toBe(5)

    for (let i = 1; i <= 5; i++) {
      expect(fileContent).toContain(`G-90${i}`)
      expect(fileContent).toContain(`Batch Athlete ${i}`)
    }
  })

  it('preview endpoint returns participant, layout spec, and zpl for settings.manage', async () => {
    const db = getSqlite()
    const now = new Date().toISOString()
    const res = db.prepare(`
      INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('999', 'IND', 'Preview Athlete', 'G-999', 1, 'in', 0, ?, ?)
    `).run(now, now)
    const pId = Number(res.lastInsertRowid)

    // Printer staff (no settings.manage): gets participant and layout, no zpl
    const printerStaff = await loginAs('printerstaff', 'StaffPass123')
    const staffRes = await printerStaff.get(`/api/labels/preview/${pId}`)
    expect(staffRes.status).toBe(200)
    expect(staffRes.body.participant.bib_number).toBe('999')
    expect(staffRes.body.layout).toBeDefined()
    expect(staffRes.body.zpl).toBeUndefined()

    // Admin (has settings.manage): gets zpl included for debugging
    const admin = await loginAs('admin', 'AdminPass123')
    const adminRes = await admin.get(`/api/labels/preview/${pId}`)
    expect(adminRes.status).toBe(200)
    expect(adminRes.body.zpl).toBeDefined()
    expect(adminRes.body.zpl).toContain('^FDGUN G-999^FS')
  })
})
