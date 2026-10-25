#!/usr/bin/env node
/**
 * `npm run verify:package` - static verification of the desktop packaging.
 *
 * Runs anywhere (Windows, macOS, Linux) and does not need Electron installed:
 * it inspects the compiled output and the electron-builder configuration, then
 * reports PASS/FAIL per rule. The Windows installer itself is verified with
 * verify-package.ps1 on the test machine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
const failures = []

function check(ok, label, detail = '') {
  checks++
  if (!ok) failures.push(`${label}${detail ? ` - ${detail}` : ''}`)
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const builderYml = read(path.join(root, 'electron-builder.yml'))

console.log('\n1) Build output present (npm run build:all)')
const mainCjs = path.join(root, 'desktop', 'dist', 'main.cjs')
const preloadCjs = path.join(root, 'desktop', 'dist', 'preload.cjs')
const backendEntry = path.join(root, 'backend', 'server', 'dist', 'server', 'src', 'server.bundle.cjs')
const backendEsmEntry = path.join(root, 'backend', 'server', 'dist', 'server', 'src', 'server.js')
const backendMigrations = path.join(root, 'backend', 'server', 'dist', 'server', 'src', 'db', 'migrations')
const frontendIndex = path.join(root, 'frontend', 'dist', 'index.html')

check(fs.existsSync(mainCjs), 'desktop/dist/main.cjs exists (CommonJS)')
check(fs.existsSync(preloadCjs), 'desktop/dist/preload.cjs exists (CommonJS)')
check(fs.existsSync(backendEntry), 'backend CommonJS bundle exists (loaded by the Electron main)', path.relative(root, backendEntry))
check(fs.existsSync(backendEsmEntry), 'backend ESM build exists (dev CLI)', path.relative(root, backendEsmEntry))
check(fs.existsSync(backendEntry) && /module\.exports/.test(read(backendEntry)), 'backend bundle is CommonJS (module.exports)')
check(fs.existsSync(backendEntry) && /startServer/.test(read(backendEntry)), 'backend bundle exports startServer')
check(fs.existsSync(backendMigrations) && fs.readdirSync(backendMigrations).some((f) => f.endsWith('.sql')), 'SQL migrations copied into the backend build')
check(fs.existsSync(frontendIndex), 'frontend/dist/index.html exists (SPA served by the backend)')

console.log('\n2) Desktop shell hardening (desktop/dist/main.cjs)')
const main = read(mainCjs)
check(/contextIsolation:\s*true/.test(main), 'contextIsolation enabled')
check(/nodeIntegration:\s*false/.test(main), 'nodeIntegration disabled')
check(/sandbox:\s*true/.test(main), 'sandbox enabled')
check(/webSecurity:\s*true/.test(main), 'webSecurity enabled')
check(/devTools:\s*isDev/.test(main), 'devTools only in development builds')
check(/setWindowOpenHandler/.test(main) && /action:\s*["']deny["']/.test(main), 'window.open denied')
check(/will-navigate/.test(main), 'navigation away from the app origin blocked')
check(/setPermissionRequestHandler/.test(main), 'permission requests denied')
check(/requestSingleInstanceLock/.test(main), 'single-instance lock present')
check(/session-end/.test(main), 'Windows session-end (shutdown) handled')
check(/before-quit/.test(main), 'before-quit shutdown path present')
check(/runShutdownBackup/.test(main), 'shutdown backup is called on quit')
check(/print-spool\.ps1/.test(main) && /process\.resourcesPath/.test(main), 'print-spool.ps1 resolved from resources (not app.asar)')
check(/3001/.test(main) && /process\.env\.PORT/.test(main), 'prefers port 3001 (PORT env override, free port fallback in the backend)')
check(/require\(entry\)/.test(main), 'loads the backend with a CommonJS require() (works inside app.asar)')
check(!/import\(pathToFileURL|import\(\s*entry\s*\)/.test(main), 'no dynamic import() of the backend (fails inside app.asar)')
check(/server\.bundle\.cjs/.test(main), 'backend entry points at server.bundle.cjs')
check(/app\.asar\.unpacked/.test(main), 'prefers the unpacked backend copy when present')
check(!/electron-updater|autoUpdater|sentry|google-analytics|mixpanel|segment\.io/i.test(main), 'no updater / analytics / crash reporters')

console.log('\n3) Preload allow-list (desktop/dist/preload.cjs)')
const preload = read(preloadCjs)
const handlers = [...preload.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
const expected = ['desktop:select-folder', 'desktop:show-item', 'desktop:export-logs', 'desktop:app-info']
check(handlers.length === 4, 'exactly four IPC channels used', handlers.join(', '))
check(expected.every((channel) => handlers.includes(channel)), 'only the allow-listed channels')
check(/contextBridge\.exposeInMainWorld\(\s*['"]rangeopsDesktop['"]/.test(preload), 'exposed as window.rangeopsDesktop only')
check(!/require\(\s*['"]node:(fs|path|child_process|os)['"]\s*\)/.test(preload), 'no Node modules imported in the preload')
check(!/ipcRenderer\.(send|sendSync|on)\(/.test(preload), 'no generic ipcRenderer.send/on')

console.log('\n4) Backend packaging rules')
check(/asarUnpack/.test(builderYml) && /\*\*\/\*\.node/.test(builderYml), 'asarUnpack covers **/*.node')
check(/@node-rs/.test(builderYml), '@node-rs (argon2) unpacked')
check(/extraResources/.test(builderYml) && /print-spool\.ps1/.test(builderYml), 'print-spool.ps1 shipped via extraResources')
check(/deleteAppDataOnUninstall:\s*false/.test(builderYml), 'uninstall keeps app data')
check(/perMachine:\s*false/.test(builderYml), 'per-user install (no admin required)')
check(/oneClick:\s*false/.test(builderYml), 'assisted installer (choose folder)')
check(/artifactName:\s*ShootingRangeSystem-Setup-\$\{version\}\.exe/.test(builderYml), 'installer filename ShootingRangeSystem-Setup-<version>.exe')
check(/publish:\s*null/.test(builderYml), 'no publish/auto-update channel')
check((builderYml.match(/!backend\/server\/dist\/server\/src\/tests\/\*\*/) ?? []).length === 1, 'tests excluded from the package')
check(/^\d+\.\d+\.\d+$/.test(String(pkg.version)), 'root package.json version is semver (single source of truth)', String(pkg.version))

console.log('\n4b) Toolchain pinned for the rebuild (package.json)')
const devDeps = pkg.devDependencies ?? {}
check(/^\d+\.\d+\.\d+$/.test(String(devDeps.electron ?? '')), 'electron pinned to an exact version (no ^ or ~)', String(devDeps.electron))
check(!Object.prototype.hasOwnProperty.call(devDeps, '@electron/rebuild'), '@electron/rebuild not duplicated in devDependencies (electron-builder runs it)')
check(typeof devDeps.esbuild === 'string', 'esbuild present (builds the CommonJS backend bundle)')
check(typeof pkg.scripts?.['smoke:package'] === 'string', '"smoke:package" script present', String(pkg.scripts?.['smoke:package']))
check(fs.existsSync(path.join(root, 'scripts', 'smoke-package.mjs')), 'scripts/smoke-package.mjs exists')
const lockFile = path.join(root, 'package-lock.json')
if (fs.existsSync(lockFile)) {
  let lockedElectron = ''
  try {
    lockedElectron = JSON.parse(read(lockFile)).packages?.['node_modules/electron']?.version ?? ''
  } catch {
    lockedElectron = 'unreadable'
  }
  check(lockedElectron === devDeps.electron, 'package-lock.json electron version matches the pin', lockedElectron || 'missing')
  let lockedVersion = ''
  try {
    lockedVersion = JSON.parse(read(lockFile)).version ?? ''
  } catch {
    lockedVersion = 'unreadable'
  }
  check(lockedVersion === pkg.version, 'package-lock.json version matches package.json', lockedVersion || 'missing')
} else {
  check(false, 'package-lock.json present at the repo root')
}

console.log('\n5) No secrets or machine paths in build output')
const scanTargets = [mainCjs, preloadCjs, backendEntry, frontendIndex].filter((file) => fs.existsSync(file))
for (const file of scanTargets) {
  const text = read(file)
  const machinePath = root.replace(/\\/g, '/')
  check(!text.includes(machinePath), `no absolute build path in ${path.relative(root, file)}`)
}
const backendSrc = path.join(root, 'backend', 'server', 'dist')
const envFiles = fs.existsSync(backendSrc)
  ? fs.readdirSync(backendSrc, { recursive: true }).filter((f) => /(^|[\\/])\.env/.test(String(f)))
  : []
check(envFiles.length === 0, 'no .env files in the backend build', envFiles.join(', '))

console.log('\n6) Data lives outside the install folder')
check(/function resolveDataDir/.test(main) && /getPath\(['"]userData['"]\)/.test(main), 'dataDir derived from app.getPath("userData")')
check(/SHOOTINGRANGE_DATA_DIR/.test(main), 'SHOOTINGRANGE_DATA_DIR override supported')
check(/data-location\.json/.test(main), 'optional data-location.json override supported')
check(/startServer\(\{/.test(main) && /dataDir/.test(main), 'dataDir injected into startServer()')

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : 'FAILURES'} - ${checks - failures.length}/${checks} passed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log('Installer-level checks (native ABI, real install/uninstall) run on Windows: verify-package.ps1')
