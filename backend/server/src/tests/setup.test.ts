/**
 * First-run setup (packaged installs).
 * Each test file gets its own temp database via tests/setup.ts.
 */
import { describe, expect, it } from 'vitest'
import supertest from 'supertest'
import { createApp } from '../app.js'
import { getSqlite } from '../db/connection.js'

const app = createApp()

/**
 * Empty the users table so setup endpoints see a fresh install.
 * activity_log and transactions are append-only (enforced by triggers), so the
 * append-only triggers are dropped for this test file only — the temp database
 * is discarded by tests/setup.ts afterwards.
 */
function clearUsers() {
  const db = getSqlite()
  db.exec('DROP TRIGGER IF EXISTS trg_activity_log_no_delete')
  db.prepare('DELETE FROM activity_log').run()
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM users').run()
}

describe('first-run setup', () => {
  it('reports needsSetup=true when there are no users', async () => {
    clearUsers()
    const res = await supertest(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body.needsSetup).toBe(true)
    expect(typeof res.body.version).toBe('string')
    expect(res.body.dataDir).toBeTruthy()
  })

  it('rejects a password shorter than 10 characters', async () => {
    clearUsers()
    const res = await supertest(app).post('/api/setup/first-admin').send({
      full_name: 'Range Admin', username: 'setupadmin', password: 'short', confirm_password: 'short',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.password).toMatch(/10 characters/)
  })

  it('rejects mismatched passwords', async () => {
    clearUsers()
    const res = await supertest(app).post('/api/setup/first-admin').send({
      full_name: 'Range Admin', username: 'setupadmin', password: 'StrongPass123', confirm_password: 'StrongPass124',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.fields.confirm_password).toBe('Passwords do not match')
  })

  it('creates the first admin without forcing a password change, then locks itself', async () => {
    clearUsers()
    const created = await supertest(app).post('/api/setup/first-admin').send({
      full_name: 'Range Admin', username: 'setupadmin', password: 'StrongPass123', confirm_password: 'StrongPass123',
    })
    expect(created.status).toBe(201)
    expect(created.body.user.role).toBe('admin')
    expect(created.body.user.must_change_password).toBe(false)

    // The account works with the chosen password.
    const login = await supertest(app).post('/api/auth/login').send({ username: 'setupadmin', password: 'StrongPass123' })
    expect(login.status).toBe(200)

    // Setup is closed forever after the first admin exists.
    const second = await supertest(app).post('/api/setup/first-admin').send({
      full_name: 'Intruder', username: 'intruder', password: 'StrongPass123', confirm_password: 'StrongPass123',
    })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('SETUP_COMPLETE')

    const status = await supertest(app).get('/api/setup/status')
    expect(status.body.needsSetup).toBe(false)
  })

  it('exposes app version and data folder for the Settings About card', async () => {
    clearUsers()
    await supertest(app).post('/api/setup/first-admin').send({
      full_name: 'Range Admin', username: 'aboutadmin', password: 'StrongPass123', confirm_password: 'StrongPass123',
    })
    const agent = supertest.agent(app)
    await agent.post('/api/auth/login').send({ username: 'aboutadmin', password: 'StrongPass123' })
    const res = await agent.get('/api/app-info')
    expect(res.status).toBe(200)
    expect(res.body.version).toBeTruthy()
    expect(res.body.dataDir).toBeTruthy()
    expect(res.body.platform).toBe(process.platform)
  })
})
