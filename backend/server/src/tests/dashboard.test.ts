import { describe, expect, it } from 'vitest'
import { loginAs } from './helpers.js'

describe('Dashboard aggregates', () => {
  it('returns KPI, category, hourly, and recent activity aggregates without list endpoints', async () => {
    const agent = await loginAs('admin', 'AdminPass123')
    const response = await agent.get('/api/dashboard/summary')

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(1)
    expect(response.body.in + response.body.out).toBe(1)
    expect(response.body.categories).toEqual([{ name: 'Senior Men', value: 1 }])
    expect(response.body.hourly).toEqual(expect.any(Array))
    expect(response.body.recent).toEqual([])
  })

  it('returns structured validation errors for limits above the server cap', async () => {
    const agent = await loginAs('admin', 'AdminPass123')
    const response = await agent.get('/api/participants?limit=500')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.fields.limit).toBeDefined()
  })
})
