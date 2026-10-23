/**
 * Production seed: creates the first admin from environment variables.
 * Run: npm run seed
 * Env: ADMIN_USERNAME, ADMIN_PASSWORD
 */
import { hash } from '@node-rs/argon2'
import { runMigrations } from './migrate.js'
import { getSqlite } from './connection.js'

const username = process.env.ADMIN_USERNAME
const password = process.env.ADMIN_PASSWORD

if (!username || !password) {
  console.error('Error: ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required.')
  console.error('Example: ADMIN_USERNAME=admin ADMIN_PASSWORD=MySecurePass123 npm run seed')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Error: ADMIN_PASSWORD must be at least 8 characters.')
  process.exit(1)
}

console.log('Running migrations...')
runMigrations()

const db = getSqlite()
const passwordHash = await hash(password)
const now = new Date().toISOString()

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
if (existing) {
  console.log(`Admin user "${username}" already exists. Use the reset-password endpoint to change password.`)
} else {
  db.prepare(`
    INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at)
    VALUES (?, ?, ?, 'admin', '[]', 1, 1, ?)
  `).run('Administrator', username, passwordHash, now)
  console.log(`✓ Created admin user: ${username}`)
  console.log('  must_change_password = true — they must set a new password on first login.')
}

process.exit(0)
