import fs from 'node:fs'
import path from 'node:path'

const requestedDataDir = process.env.DATA_DIR
const requestedDbPath = process.env.DB_PATH
const dataDir = path.resolve(requestedDataDir ?? (requestedDbPath ? path.dirname(requestedDbPath) : path.join(process.cwd(), 'data', 'load-test')))
const dbPath = path.resolve(requestedDbPath ?? path.join(dataDir, 'loadtest.db'))
const knownLivePath = path.resolve(process.cwd(), '..', '..', 'data', 'shootingrange.db')

if (dbPath === knownLivePath || path.basename(dbPath).toLowerCase() === 'shootingrange.db') {
  throw new Error(`Refusing to seed a live-looking database path: ${dbPath}`)
}
if (!requestedDataDir && !requestedDbPath && !dataDir.endsWith(`${path.sep}load-test`)) {
  throw new Error('Load-test database must be stored in a dedicated load-test folder.')
}

process.env.DATA_DIR = dataDir
process.env.DB_PATH = dbPath

const { hash } = await import('@node-rs/argon2')
const { getSqlite } = await import('../src/db/connection.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { closeDb } = await import('../src/db/connection.js')

fs.mkdirSync(dataDir, { recursive: true })
if (fs.existsSync(dbPath)) throw new Error(`Load-test database already exists; refusing to overwrite it: ${dbPath}`)
runMigrations()

const db = getSqlite()
const now = new Date()
const isoNow = now.toISOString()
const passwordHash = await hash('LoadTestPass123')
const insertUser = db.prepare(`INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at)
  VALUES ('Load Test Admin', 'loadadmin', ?, 'admin', '[]', 1, 0, ?)`)
const insertCategory = db.prepare('INSERT INTO categories (name, active) VALUES (?, 1)')
const insertParticipant = db.prepare(`INSERT INTO participants
  (bib_number, noc, name, department, gun_number, contact_number, category_id, pouch_status, label_printed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'in', 0, ?, ?)`)
const insertTransaction = db.prepare(`INSERT INTO transactions
  (participant_id, gun_number, type, created_at, user_id, manual_entry, source) VALUES (?, ?, ?, ?, 1, 0, 'scan')`)
const insertCorrection = db.prepare(`INSERT INTO corrections
  (transaction_id, action, old_values, new_values, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
const insertActivity = db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
  VALUES (1, ?, ?, ?, ?, ?)`)

const nocs = ['USA', 'IND', 'GBR', 'FRA', 'GER', 'ITA', 'JPN', 'AUS', 'CAN', 'BRA']
const departments = ['Rifle', 'Pistol', 'Shotgun', 'Junior', 'Senior', 'Coaching', 'Support', 'Officials']
const categories: number[] = []

const seed = db.transaction(() => {
  insertUser.run(passwordHash, isoNow)
  for (let index = 0; index < 6; index++) categories.push(Number(insertCategory.run(`Load Category ${index + 1}`).lastInsertRowid))
  for (let index = 0; index < 2000; index++) {
    const bib = `L${String(index + 1).padStart(4, '0')}`
    insertParticipant.run(bib, nocs[index % nocs.length], `Load Test Participant ${index + 1}`,
      departments[index % departments.length], `LT-${String(index + 1).padStart(4, '0')}`, `+1 555 ${String(index).padStart(7, '0')}`,
      categories[index % categories.length], isoNow, isoNow)
  }

  const transactionIds: number[] = []
  const participantCount = 2000
  const transactionsPerParticipant = 25
  const start = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
  for (let participant = 1; participant <= participantCount; participant++) {
    for (let movement = 0; movement < transactionsPerParticipant; movement++) {
      const time = new Date(start.getTime() + movement * 4 * 60 * 60 * 1000 + participant * 1000).toISOString()
      const result = insertTransaction.run(participant, `LT-${String(participant).padStart(4, '0')}`,
        movement % 2 === 0 ? 'out' : 'in', time)
      transactionIds.push(Number(result.lastInsertRowid))
    }
  }
  const correctionTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  for (let index = 0; index < 200; index++) {
    const transactionId = transactionIds[index * 17]
    const transaction = db.prepare('SELECT participant_id, gun_number, type, created_at FROM transactions WHERE id = ?').get(transactionId) as {
      participant_id: number; gun_number: string; type: 'in' | 'out'; created_at: string
    }
    insertCorrection.run(transactionId, 'edit',
      JSON.stringify({ type: transaction.type, created_at: transaction.created_at }),
      JSON.stringify({ type: transaction.type, created_at: transaction.created_at }),
      'Load-test audit correction', correctionTime)
  }
  for (let index = 0; index < 100; index++) {
    const transactionId = transactionIds[500 + index * 11]
    insertCorrection.run(transactionId, 'void', JSON.stringify({ type: 'out' }),
      JSON.stringify({ voided: true }), 'Load-test void correction', correctionTime)
  }
  for (let index = 0; index < 200; index++) {
    const participantId = (index % participantCount) + 1
    const gun = `LT-${String(participantId).padStart(4, '0')}`
    const createdAt = new Date(now.getTime() + (index + 1) * 1000).toISOString()
    const movementType = index % 2 === 0 ? 'out' : 'in'
    const added = db.prepare(`INSERT INTO transactions
      (participant_id, gun_number, type, created_at, user_id, manual_entry, source)
      VALUES (?, ?, ?, ?, 1, 1, 'correction')`).run(participantId, gun, movementType, createdAt)
    insertCorrection.run(null, 'add', null, JSON.stringify({
      participant_id: participantId, gun_number: gun, type: movementType, created_at: createdAt, transaction_id: Number(added.lastInsertRowid),
    }), 'Load-test missed transaction', correctionTime)
  }

  for (let index = 0; index < 20_000; index++) {
    const at = new Date(start.getTime() + index * 10_000).toISOString()
    insertActivity.run('LOAD_TEST_ACTIVITY', 'participant', String((index % participantCount) + 1),
      JSON.stringify({ sequence: index + 1 }), at)
  }
})

seed()
const counts = {
  participants: (db.prepare('SELECT COUNT(*) AS count FROM participants').get() as { count: number }).count,
  transactions: (db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count,
  corrections: (db.prepare('SELECT COUNT(*) AS count FROM corrections').get() as { count: number }).count,
  activity: (db.prepare('SELECT COUNT(*) AS count FROM activity_log').get() as { count: number }).count,
}
console.log(`Load-test database ready: ${dbPath}`)
console.table(counts)
closeDb()
