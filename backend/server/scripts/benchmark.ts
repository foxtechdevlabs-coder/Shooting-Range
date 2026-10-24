import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import ExcelJS from 'exceljs'

const benchmarkDataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data', 'load-test'))
const benchmarkDbPath = path.resolve(process.env.DB_PATH ?? path.join(benchmarkDataDir, 'loadtest.db'))
process.env.DATA_DIR = benchmarkDataDir
process.env.DB_PATH = benchmarkDbPath

import { config } from '../src/config.js'
import { getSqlite, closeDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createApp } from '../src/app.js'

type Measurement = { name: string; medianMs: number; p95Ms: number; samples: number; pass: boolean }
const dbPath = path.resolve(config.dbPath)
if (path.basename(dbPath).toLowerCase() === 'shootingrange.db' || !dbPath.toLowerCase().includes('loadtest')) {
  throw new Error(`Benchmark must target an isolated load-test database; current DB_PATH is ${dbPath}`)
}

runMigrations()
const db = getSqlite()
const admin = db.prepare("SELECT id FROM users WHERE username = 'loadadmin'").get()
if (!admin) throw new Error('Load-test admin not found. Run npm run seed:load first.')

const server = createApp().listen(0, '127.0.0.1')
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve)
  server.once('error', reject)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Failed to bind benchmark HTTP server.')
const baseUrl = `http://127.0.0.1:${address.port}`
let cookie = ''

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Connection: 'close', ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  })
  return response
}

async function readJson(response: Response) {
  const value = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(value)}`)
  return value
}

function summarize(name: string, times: number[], targetMs: number): Measurement {
  const sorted = [...times].sort((a, b) => a - b)
  const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
  const medianMs = percentile(0.5)
  const p95Ms = percentile(0.95)
  return { name, medianMs: Number(medianMs.toFixed(2)), p95Ms: Number(p95Ms.toFixed(2)), samples: times.length, pass: p95Ms < targetMs }
}

const results: Measurement[] = []
const temporaryFiles: string[] = []
try {
  const login = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'loadadmin', password: 'LoadTestPass123' }),
  })
  if (!login.ok) throw new Error(`Load-test login failed: ${login.status} ${await login.text()}`)
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie) throw new Error('Login response did not issue the session cookie.')

  const gunRows = db.prepare('SELECT gun_number FROM participants WHERE id <= 200 ORDER BY id').all() as Array<{ gun_number: string }>
  const scanTimes: number[] = []
  for (let index = 0; index < 200; index++) {
    const started = performance.now()
    const response = await request('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: gunRows[index % gunRows.length].gun_number, manual: true, confirm: true }),
    })
    if (!response.ok) throw new Error(`Scan benchmark failed: ${response.status} ${await response.text()}`)
    await response.arrayBuffer()
    scanTimes.push(performance.now() - started)
  }
  results.push(summarize('POST /api/scan (200 mixed guns)', scanTimes, 1000))

  for (const [name, endpoint] of [
    ['GET /api/participants search+filters', '/api/participants?search=L0&noc=USA&page=0&limit=100&sort=bib_number'],
    ['GET /api/transactions filters', '/api/transactions?gun_number=LT-00&type=out&page=0&limit=100'],
  ] as const) {
    const times: number[] = []
    for (let index = 0; index < 30; index++) {
      const started = performance.now()
      const response = await request(endpoint)
      await readJson(response)
      times.push(performance.now() - started)
    }
    results.push(summarize(name, times, 250))
  }

  const exportPath = path.join(os.tmpdir(), `loadtest-transactions-${process.pid}.xlsx`)
  temporaryFiles.push(exportPath)
  const rssBefore = process.memoryUsage().rss
  const exportStart = performance.now()
  const exportResponse = await request('/api/reports/transactions?format=xlsx')
  if (!exportResponse.ok || !exportResponse.body) throw new Error(`Transaction export failed: ${exportResponse.status} ${await exportResponse.text()}`)
  const output = fs.createWriteStream(exportPath)
  let exportBytes = 0
  for await (const part of exportResponse.body) {
    const chunk = Buffer.from(part)
    exportBytes += chunk.length
    if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve))
  }
  output.end()
  await new Promise<void>((resolve, reject) => { output.once('finish', resolve); output.once('error', reject) })
  const exportMs = performance.now() - exportStart
  const rssAfter = process.memoryUsage().rss
  const memoryGrowthMb = (rssAfter - rssBefore) / (1024 * 1024)
  const exportPass = exportMs < 30_000 && memoryGrowthMb < 200
  results.push({
    name: `Excel export (${exportBytes.toLocaleString('en-US')} bytes; ${memoryGrowthMb.toFixed(1)} MB RSS growth)`,
    medianMs: Number(exportMs.toFixed(2)), p95Ms: Number(exportMs.toFixed(2)), samples: 1, pass: exportPass,
  })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Participants')
  sheet.addRow(['bib_number', 'noc', 'name', 'gun_number', 'category'])
  for (let index = 0; index < 1000; index++) {
    sheet.addRow([`IMP${String(index + 1).padStart(4, '0')}`, 'USA', `Import Participant ${index + 1}`,
      `IMP-GUN-${String(index + 1).padStart(4, '0')}`, 'Load Category 1'])
  }
  const importBuffer = await workbook.xlsx.writeBuffer()
  const form = new FormData()
  form.append('file', new Blob([importBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'benchmark-1000.xlsx')
  const importStart = performance.now()
  const previewResponse = await request('/api/participants/import/preview', { method: 'POST', body: form })
  const preview = await readJson(previewResponse)
  const commitResponse = await request('/api/participants/import/commit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId: preview.previewId, mode: 'skip' }),
  })
  await readJson(commitResponse)
  const importMs = performance.now() - importStart
  results.push({ name: 'Excel import (1,000 rows preview+commit)', medianMs: Number(importMs.toFixed(2)), p95Ms: Number(importMs.toFixed(2)), samples: 1, pass: importMs < 30_000 })

  const backupPath = path.join(os.tmpdir(), `loadtest-backup-${process.pid}.db`)
  temporaryFiles.push(backupPath)
  const backupStart = performance.now()
  await db.backup(backupPath)
  const backupMs = performance.now() - backupStart
  const backupBytes = fs.statSync(backupPath).size
  results.push({
    name: `Full database backup (${backupBytes.toLocaleString('en-US')} bytes)`,
    medianMs: Number(backupMs.toFixed(2)), p95Ms: Number(backupMs.toFixed(2)), samples: 1, pass: backupMs < 30_000,
  })

  console.log(`Database: ${dbPath}`)
  console.log(`Export file size: ${fs.statSync(exportPath).size.toLocaleString('en-US')} bytes; RSS before ${Math.round(rssBefore / 1024 / 1024)} MB, after ${Math.round(rssAfter / 1024 / 1024)} MB.`)
  console.table(results.map(({ name, medianMs, p95Ms, samples, pass }) => ({
    Measurement: name, 'Median ms': medianMs, 'p95 ms': p95Ms, Samples: samples, Result: pass ? 'PASS' : 'FAIL',
  })))
  if (results.some((result) => !result.pass)) process.exitCode = 1
} finally {
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()))
  server.closeAllConnections()
  await Promise.race([serverClosed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  closeDb()
  for (const filename of temporaryFiles) fs.rmSync(filename, { force: true })
}
