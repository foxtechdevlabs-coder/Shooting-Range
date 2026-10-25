/**
 * Locate a TypeScript 5.x compiler for the build scripts.
 *
 * The repo pins TypeScript 5.8 at the root for the Electron main process.
 * (backend/ and frontend/ declare their own newer compilers; the desktop and
 * backend build steps expect classic CommonJS/`node` module resolution, which
 * only TS 5 supports.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function resolveTsc(label = 'build') {
  const candidates = [
    path.join(root, 'node_modules', 'typescript'),
    path.join(root, 'frontend', 'node_modules', 'typescript'),
    path.join(root, 'backend', 'node_modules', 'typescript'),
  ].filter((dir) => fs.existsSync(path.join(dir, 'package.json')))

  if (candidates.length === 0) {
    console.error(`[${label}] TypeScript is not installed. Run "npm install" in the repo root first.`)
    process.exit(1)
  }

  for (const dir of candidates) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const major = Number(String(pkg.version).split('.')[0])
    const bin = path.join(dir, 'bin', 'tsc')
    if (major === 5 && fs.existsSync(bin)) return bin
  }

  const versions = candidates.map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return `${path.relative(root, dir)}=${pkg.version}`
  })
  console.error(`[${label}] Needs TypeScript 5.x (module/moduleResolution "commonjs"/"node"). Found: ${versions.join(', ')}`)
  console.error(`[${label}] Fix: npm install typescript@5.8.3 --save-dev --prefix .`)
  process.exit(1)
}
