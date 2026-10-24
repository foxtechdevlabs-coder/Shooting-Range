import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import BetterSQLite3 from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { loginAs } from './helpers.js'
import { getSqlite } from '../db/connection.js'
import { pruneBackups } from '../services/backup.js'

describe('database backups and restore', () => {
  it('creates an integrity-checked backup and rejects an invalid restore without changing live data', async () => {
    const admin = await loginAs('admin', 'AdminPass123')
    const backup = await admin.post('/api/backup').send({})
    expect(backup.status).toBe(201)
    const backupDb = new BetterSQLite3(backup.body.destination, { readonly: true, fileMustExist: true })
    expect(backupDb.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    backupDb.close()

    const before = (getSqlite().prepare('SELECT COUNT(*) AS count FROM participants').get() as { count: number }).count
    const invalid = await admin.post('/api/backup/restore').field('confirm', 'RESTORE').attach('file', Buffer.from('not sqlite'), 'invalid.db')
    expect(invalid.status).toBe(400)
    const after = (getSqlite().prepare('SELECT COUNT(*) AS count FROM participants').get() as { count: number }).count
    expect(after).toBe(before)
  })

  it('takes a pre-restore backup and restores the database atomically', async () => {
    const admin = await loginAs('admin', 'AdminPass123')
    const backup = await admin.post('/api/backup').send({})
    expect(backup.status).toBe(201)
    const db = getSqlite()
    db.prepare(`INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('909', 'IND', 'Temporary Restore Check', 'RESTORE-909', 1, 'in', 0, ?, ?)`).run(new Date().toISOString(), new Date().toISOString())
    const restored = await admin.post('/api/backup/restore').field('confirm', 'RESTORE').attach('file', backup.body.destination)
    expect(restored.status).toBe(200)
    expect(restored.body.preRestoreBackup).toMatch(/shootingrange-backup-/)
    expect(getSqlite().prepare("SELECT id FROM participants WHERE bib_number = '909'").get()).toBeUndefined()
    expect(getSqlite().prepare("SELECT action FROM activity_log WHERE action = 'RESTORE_DATABASE'").get()).toBeDefined()
  })

  it('prunes backup files beyond the 14 newest', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-prune-'))
    try {
      for (let index = 0; index < 16; index++) {
        const file = path.join(folder, `shootingrange-backup-20260101-${String(index).padStart(6, '0')}.db`)
        fs.writeFileSync(file, 'backup')
        fs.utimesSync(file, new Date(2026, 0, 1, 0, 0, index), new Date(2026, 0, 1, 0, 0, index))
      }
      pruneBackups(folder)
      expect(fs.readdirSync(folder)).toHaveLength(14)
    } finally { fs.rmSync(folder, { recursive: true, force: true }) }
  })
})
