/**
 * Helper: create an authenticated supertest agent by logging in.
 */
import supertest from 'supertest'
import { createApp } from '../app.js'

const app = createApp()

export function agent() {
  return supertest.agent(app)
}

export async function loginAs(username: string, password: string) {
  const ag = agent()
  const res = await ag.post('/api/auth/login').send({ username, password })
  if (res.status !== 200) throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  return ag
}
