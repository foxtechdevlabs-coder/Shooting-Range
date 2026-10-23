/**
 * Demo seed (development only).
 * Creates ~40 participants, categories, and demo users.
 * Run: npm run seed:demo
 */
import { hash } from '@node-rs/argon2'
import { runMigrations } from './migrate.js'
import { getSqlite } from './connection.js'

console.log('Running migrations...')
runMigrations()

const db = getSqlite()
const now = new Date().toISOString()

// Categories
const categoryNames = ['Senior Men', 'Senior Women', 'Junior Men', 'Junior Women', 'Youth']
const categoryIds: Record<string, number> = {}
for (const name of categoryNames) {
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined
  if (existing) {
    categoryIds[name] = existing.id
  } else {
    const result = db.prepare('INSERT INTO categories (name, active) VALUES (?, 1)').run(name)
    categoryIds[name] = Number(result.lastInsertRowid)
  }
}
console.log('✓ Categories seeded')

// Demo users
const adminHash = await hash('Admin@1234')
const staffHash = await hash('Staff@1234')

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?)
`)

insertUser.run(
  'Alex Morgan', 'admin', adminHash, 'admin', '[]', 1, now
)
insertUser.run(
  'Jordan Lee', 'staff', staffHash, 'staff',
  JSON.stringify(['participants.view', 'participants.create', 'participants.edit', 'import.use', 'barcodes.print', 'scan.use', 'transactions.view', 'reports.view', 'reports.export']),
  0, now
)
insertUser.run(
  'Sam Taylor', 'scanner', staffHash, 'staff',
  JSON.stringify(['scan.use', 'transactions.view']),
  0, now
)
console.log('✓ Demo users seeded (admin/Admin@1234, staff/Staff@1234, scanner/Staff@1234)')

// Demo participants
const names = [
  'Aarav Sharma', 'Ananya Patel', 'Vivaan Kumar', 'Diya Nair', 'Arjun Singh',
  'Meera Reddy', 'Ishaan Gupta', 'Saanvi Rao', 'Aditya Joshi', 'Aditi Verma',
  'Kabir Menon', 'Ira Desai', 'Reyansh Das', 'Myra Iyer', 'Krishna Shah',
  'Kiara Pillai', 'Rohan Mehta', 'Pari Khanna', 'Atharv Kulkarni', 'Tara Bose',
  'Dhruv Bhat', 'Navya Sethi', 'Kian Fernandes', 'Siya Chawla', 'Siddharth Roy',
  'Anika Ghosh', 'Veer Malhotra', 'Avni Kapoor', 'Neil Thomas', 'Riya Banerjee',
  'Arnav Mishra', 'Ishita Sen', 'Samarth Rao', 'Mira Dutta', 'Yash Thakur',
  'Nisha Mathew', 'Devika Nair', 'Om Prakash', 'Zoya Khan', 'Rahul Shetty',
]
const nocs = ['IND', 'IND', 'IND', 'IND', 'NEP', 'SRI', 'BAN', 'IND']
const departments = ['Air Rifle', 'Air Pistol', 'Smallbore Rifle', 'Pistol', 'Trap & Skeet']

const insertParticipant = db.prepare(`
  INSERT OR IGNORE INTO participants (bib_number, noc, name, department, gun_number, contact_number, category_id, pouch_status, label_printed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
`)

const catNames = Object.keys(categoryIds)
for (let i = 0; i < names.length; i++) {
  const bib = String(101 + i)
  const gun = `G-${String(201 + i).padStart(3, '0')}`
  const catName = catNames[i % catNames.length]
  const status = i % 3 === 0 ? 'out' : 'in'
  insertParticipant.run(
    bib,
    nocs[i % nocs.length],
    names[i],
    departments[i % departments.length],
    gun,
    `+91 98${String(10000000 + i * 17391).slice(0, 8)}`,
    categoryIds[catName],
    status,
    now,
    now
  )
}
console.log('✓ 40 demo participants seeded')

// Seed activity log
const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: number }
db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, created_at) VALUES (?, 'DEMO_SEED', 'system', NULL, ?)`).run(adminUser?.id ?? 1, now)
console.log('✓ Demo seed complete.')
process.exit(0)
