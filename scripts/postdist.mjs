#!/usr/bin/env node
/**
 * `npm run postdist` - runs after `electron-builder --win nsis`.
 *
 *   1. writes release/SHA256SUMS.txt for the installer
 *   2. builds the pen-drive folder: release/PenDrive/
 *        ShootingRangeSystem-Setup-<version>.exe
 *        SHA256SUMS.txt
 *        INSTALL.txt
 *        drivers/README.txt
 *   3. sanity-checks the packaged app (no absolute build-machine paths, no dev DB)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const penDriveDir = path.join(releaseDir, 'PenDrive')
const assetsDir = path.join(root, 'build', 'installer-assets')

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const installers = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((file) => /^ShootingRangeSystem-Setup-.*\.exe$/i.test(file))
  : []

if (installers.length === 0) {
  console.error('[postdist] No installer found in release/. Did electron-builder succeed?')
  process.exit(1)
}

// Newest installer wins when several versions are present.
const installer = installers
  .map((file) => ({ file, mtime: fs.statSync(path.join(releaseDir, file)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0].file
const installerPath = path.join(releaseDir, installer)

// --- 1. SHA-256 ------------------------------------------------------------
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
const installerHash = sha256(installerPath)
const checksumLine = `${installerHash}  ${installer}\n`
fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), checksumLine, 'utf8')
console.log(`[postdist] SHA-256 ${installerHash}`)

// --- 2. Pen-drive folder ---------------------------------------------------
fs.rmSync(penDriveDir, { recursive: true, force: true })
fs.mkdirSync(path.join(penDriveDir, 'drivers'), { recursive: true })

fs.copyFileSync(installerPath, path.join(penDriveDir, installer))
fs.writeFileSync(path.join(penDriveDir, 'SHA256SUMS.txt'), checksumLine, 'utf8')

function copyAsset(relative, destination) {
  const source = path.join(assetsDir, relative)
  if (!fs.existsSync(source)) {
    console.warn(`[postdist] missing asset: ${path.relative(root, source)}`)
    return
  }
  const text = fs.readFileSync(source, 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{INSTALLER}}', installer)
  fs.writeFileSync(destination, text, 'utf8')
}
copyAsset('INSTALL.txt', path.join(penDriveDir, 'INSTALL.txt'))
copyAsset(path.join('drivers', 'README.txt'), path.join(penDriveDir, 'drivers', 'README.txt'))

// Verification helper for the person doing the install (steps 1-9 of the checklist).
const verifyScript = path.join(root, 'verify-package.ps1')
if (fs.existsSync(verifyScript)) fs.copyFileSync(verifyScript, path.join(penDriveDir, 'verify-package.ps1'))
const checklist = path.join(root, 'WINDOWS-TEST-CHECKLIST.md')
if (fs.existsSync(checklist)) fs.copyFileSync(checklist, path.join(penDriveDir, 'WINDOWS-TEST-CHECKLIST.md'))

// --- 3. Sanity checks on the unpacked app ----------------------------------
const unpackedDir = path.join(releaseDir, 'win-unpacked')
const problems = []
if (fs.existsSync(unpackedDir)) {
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar')
  if (fs.existsSync(asarPath)) {
    const asar = fs.readFileSync(asarPath)
    // The build-machine path can appear with either slash style; check both so
    // this also works when the build runs on Windows.
    const machinePaths = [...new Set([root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\')])]
    for (const machinePath of machinePaths) {
      if (machinePath.length > 8 && asar.includes(Buffer.from(machinePath, 'utf8'))) {
        problems.push(`app.asar contains the build-machine path ${machinePath}`)
      }
    }
    for (const banned of ['shootingrange.db', 'loadtest.db', '.env']) {
      if (asar.includes(Buffer.from(banned, 'utf8'))) problems.push(`app.asar contains ${banned}`)
    }
    // Everything the packaged app needs at runtime must really be in the asar
    // (the asar header lists every file path, so searching the bytes is enough).
    const required = [
      ['desktop/dist/main.cjs', 'Electron main process'],
      ['backend/server/dist/server/src/server.bundle.cjs', 'backend CommonJS bundle'],
      ['backend/server/dist/server/src/db/migrations', 'SQL migrations'],
      ['frontend/dist/index.html', 'frontend build'],
      ['node_modules/better-sqlite3/package.json', 'better-sqlite3 package'],
      ['node_modules/@node-rs/argon2/package.json', '@node-rs/argon2 package'],
    ]
    // asar stores paths with forward slashes regardless of the build OS.
    for (const [needle, label] of required) {
      if (!asar.includes(Buffer.from(needle, 'utf8'))) problems.push(`app.asar is missing ${label} (${needle})`)
    }
  } else {
    problems.push('resources/app.asar is missing')
  }
  if (!fs.existsSync(path.join(unpackedDir, 'resources', 'print-spool.ps1'))) {
    problems.push('resources/print-spool.ps1 is missing (extraResources)')
  }
  const unpackedNode = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.node')) unpackedNode.push(path.relative(unpackedDir, full))
    }
  }
  const unpackedRoot = path.join(unpackedDir, 'resources', 'app.asar.unpacked')
  if (fs.existsSync(unpackedRoot)) walk(unpackedRoot)
  const hasSqlite = unpackedNode.some((file) => file.includes('better_sqlite3.node') || file.includes('better-sqlite3'))
  const hasArgon2 = unpackedNode.some((file) => /argon2.*\.node$/i.test(file))
  if (!hasSqlite) problems.push('better-sqlite3 native binary was not unpacked from app.asar')
  if (!hasArgon2) problems.push('@node-rs/argon2 native binary was not unpacked from app.asar')
} else {
  console.warn('[postdist] release/win-unpacked not found - skipping packaging sanity checks')
}

const sizeMb = (fs.statSync(installerPath).size / (1024 * 1024)).toFixed(1)
console.log(`[postdist] Pen-drive folder ready: ${path.relative(root, penDriveDir)}  (installer ${sizeMb} MB)`)

if (problems.length > 0) {
  console.error('\n[postdist] PACKAGING PROBLEMS:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('[postdist] packaging sanity checks passed')
