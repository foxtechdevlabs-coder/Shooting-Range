#!/usr/bin/env node
/**
 * Verifies the "page size <= 200 / real server-side pagination" fix end to end.
 *
 *   node scripts/verify-pagination.mjs
 *
 * Optional environment:
 *   BASE_URL   default http://127.0.0.1:5173   (use :3001 to hit the API directly)
 *   USERNAME   default loadadmin               (load-test DB) — falls back to admin
 *   PASSWORD   default LoadTestPass123         — falls back to Admin@1234
 *
 * What it does:
 *   1. Static scan of frontend/src: no request may ask for limit > 200.
 *   2. Logs in and calls every endpoint the pages use, exactly as the UI does.
 *   3. Fails if any of those calls returns 4xx/5xx or sends limit > 200.
 *   4. Confirms the backend still rejects limit=500 with 400 VALIDATION_ERROR
 *      (the cap must NOT be raised).
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const MAX_LIMIT = 200
const credentials = [
  { username: process.env.USERNAME ?? 'loadadmin', password: process.env.PASSWORD ?? 'LoadTestPass123' },
  { username: 'admin', password: 'Admin@1234' },
]

const repoRoot = path.resolve(import.meta.dirname, '..')
const failures = []
let checks = 0

function check(ok, label, extra = '') {
  checks++
  if (!ok) failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? `  (${extra})` : ''}`)
}

// ─── 1. Static scan ──────────────────────────────────────────────────────────

console.log(`\n1) Static scan of frontend/src (no limit above ${MAX_LIMIT})`)

const srcDir = path.join(repoRoot, 'frontend', 'src')
const sourceFiles = fs.readdirSync(srcDir, { recursive: true })
  .filter((file) => /\.(ts|tsx)$/.test(String(file)))
  .map((file) => path.join(srcDir, String(file)))

const offenders = []
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\blimit\s*[:=]\s*['"`]?(\d+)['"`]?/g)) {
    const value = Number(match[1])
    if (value > MAX_LIMIT) offenders.push(`${path.relative(repoRoot, file)}: limit ${value}`)
  }
  for (const match of text.matchAll(/[?&]limit=(\d+)/g)) {
    const value = Number(match[1])
    if (value > MAX_LIMIT) offenders.push(`${path.relative(repoRoot, file)}: limit=${value}`)
  }
}
check(offenders.length === 0, `${sourceFiles.length} frontend files contain no limit > ${MAX_LIMIT}`, offenders.join(', '))

// ─── 2. Login ───────────────────────────────────────────────────────────────

console.log(`\n2) Login against ${BASE_URL}`)

let cookie = ''
let session = null
for (const attempt of credentials) {
  let response
  try {
    response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt),
    })
  } catch (error) {
    console.error(`\nCannot reach ${BASE_URL}: ${error.message}`)
    console.error('Start the API (and Vite dev server) first, then re-run this script.')
    process.exit(2)
  }
  if (!response.ok) continue
  cookie = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
  const payload = await response.json()
  session = { ...attempt, role: payload.user?.role, name: payload.user?.full_name }
  break
}
if (!session) {
  console.error('\nLogin failed for every candidate credential. Set USERNAME / PASSWORD and retry.')
  process.exit(2)
}
console.log(`  using ${session.username} (${session.role})${session.name ? ` · ${session.name}` : ''}`)

// ─── 3. The requests each screen performs ───────────────────────────────────

const requests = [
  // Dashboard
  ['GET', '/api/dashboard/summary', 'Dashboard KPIs + charts (aggregates only)'],
  // Participants table
  ['GET', '/api/participants?page=0&limit=25&sort=bib_number&order=asc', 'Participants · page 1, size 25'],
  ['GET', '/api/participants?page=1&limit=50&sort=name&order=desc', 'Participants · page 2, size 50, sorted'],
  ['GET', '/api/participants?page=0&limit=100&label_status=unprinted', 'Participants · page size 100 + label filter'],
  ['GET', '/api/participants?page=0&limit=25&search=LT-1', 'Participants · debounced search'],
  ['GET', '/api/participants?page=0&limit=20&search=LT-1', 'Picker/autocomplete (manual scan, correction dialog)'],
  // Transactions table
  ['GET', '/api/transactions?page=0&limit=25&sort=created_at&order=desc', 'Transactions · page 1, size 25'],
  ['GET', '/api/transactions?page=40&limit=50&status=corrected', 'Transactions · deep page + filter'],
  ['GET', '/api/transactions?page=0&limit=100&search=LT-02', 'Transactions · search, size 100'],
  // Barcodes
  ['GET', '/api/labels/summary', 'Barcode counts (server side)'],
  ['GET', '/api/labels/jobs', 'Print jobs'],
  // Reports (on-screen view is paginated; xlsx is a separate stream)
  ['GET', '/api/reports/participants?page=0&limit=25', 'Report · participants'],
  ['GET', '/api/reports/pouches-out?page=0&limit=50', 'Report · pouches out'],
  ['GET', '/api/reports/transactions?page=0&limit=100', 'Report · transactions'],
  // Scan station + shell data
  ['GET', '/api/scan/summary', 'Scan counters'],
  ['GET', '/api/scan/recent', 'Scan live feed'],
  ['GET', '/api/users?page=0&limit=50', 'Users list'],
  ['GET', '/api/activity?limit=50', 'Activity log'],
  ['GET', '/api/categories', 'Categories'],
  ['GET', '/api/settings', 'Settings'],
]

console.log('\n3) Requests the screens make (expect 200, limit <= 200)')

for (const [method, url, label] of requests) {
  const started = performance.now()
  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, { method, headers: { cookie } })
  } catch (error) {
    check(false, label, `network error: ${error.message}`)
    continue
  }
  const ms = Math.round(performance.now() - started)
  const requestedLimit = Number(new URL(url, BASE_URL).searchParams.get('limit') ?? 0)
  const body = await response.json().catch(() => ({}))
  const detail = `${response.status} · ${ms} ms${requestedLimit ? ` · limit ${requestedLimit}` : ''}` +
    (typeof body.total === 'number' ? ` · total ${body.total}` : '')
  check(response.status === 200 && requestedLimit <= MAX_LIMIT, label, detail)
}

// ─── 4. The cap must still exist on the backend ─────────────────────────────

console.log(`\n4) Backend still enforces the ${MAX_LIMIT} cap`)

for (const url of ['/api/participants?limit=500', '/api/transactions?limit=500', '/api/reports/participants?limit=500']) {
  const response = await fetch(`${BASE_URL}${url}`, { headers: { cookie } })
  const body = await response.json().catch(() => ({}))
  const isValidationError = response.status === 400 && body.error?.code === 'VALIDATION_ERROR' && Boolean(body.error?.fields?.limit)
  check(isValidationError, `limit=500 rejected on ${url.split('?')[0]}`, `${response.status} ${body.error?.code ?? ''}`)
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : 'FAILURES'} — ${checks - failures.length}/${checks} passed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log('No request returned 4xx/5xx, and no limit above 200 was sent.')
