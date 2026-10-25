#!/usr/bin/env node
/**
 * Portability lint for the build scripts (runs on every OS, no dependencies).
 *
 *   node scripts/lint-scripts.mjs        (also part of `npm run verify:package`)
 *
 * Rules
 *  1. A dynamic import() must receive a *static* argument: a string literal,
 *     pathToFileURL(<path>).href, or a value that already is a file URL.
 *     import('C:\\dev\\app\\x.mjs') throws ERR_UNSUPPORTED_ESM_URL_SCHEME on
 *     Windows ("Received protocol 'c:'"), so plain paths must go through
 *     createRequire(import.meta.url) instead.
 *  2. No execSync(): it builds one shell command string, which breaks as soon as
 *     a path contains a space. Use execFileSync(cmd, [args]).
 *  3. .ps1 / .bat helpers must be plain ASCII (Windows PowerShell 5.1 and cmd
 *     mis-decode UTF-8 without a BOM).
 *
 * Violations are printed as file:line so they can be fixed immediately.
 * Output text is plain ASCII only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Never walked: generated output, dependencies and app data.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'release', 'build', 'coverage', 'out',
  '.venv', '.cache', '.next', 'data', '.arena', '.local', '.pytest_cache',
])

const SCRIPT_EXTENSIONS = new Set(['.mjs', '.cjs'])
const ASCII_EXTENSIONS = new Set(['.ps1', '.bat', '.cmd'])

/** Recursively collect files with one of the given extensions. */
function collectFiles(dir, extensions, found = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectFiles(path.join(dir, entry.name), extensions, found)
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(path.join(dir, entry.name))
    }
  }
  return found
}

/**
 * Blank out comments and string bodies so that only real code is scanned.
 * The returned string has the same length and the same line breaks as the
 * input, so indexes and line numbers line up with the original source.
 */
const REGEX_PRECEDING_CHARS = new Set('(,=:[!&|?{};+-*%~^<>'.split(''))
const REGEX_PRECEDING_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield'])

/** Does a '/' at this position start a regex literal rather than a division? */
function startsRegex(source, index, lastCodeChar, lastWord) {
  if (lastWord && REGEX_PRECEDING_WORDS.has(lastWord)) return true
  if (!lastCodeChar) return true
  return REGEX_PRECEDING_CHARS.has(lastCodeChar)
}

function maskNonCode(source) {
  const masked = source.split('')
  let state = 'code'
  let quote = ''
  let index = 0
  let lastCodeChar = ''
  let lastWord = ''
  let inCharClass = false

  const blank = (position) => {
    if (source[position] !== '\n' && source[position] !== '\r') masked[position] = ' '
  }

  /** Remember the last real code character and the last identifier seen. */
  const observe = (char) => {
    if (/[A-Za-z_$]/.test(char)) {
      lastWord = /[A-Za-z_$]/.test(lastCodeChar) ? lastWord + char : char
      lastCodeChar = char
      return
    }
    if (char.trim()) {
      lastCodeChar = char
      lastWord = ''
    }
  }

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (state === 'regex') {
      if (char === '\\') {
        blank(index)
        if (index + 1 < source.length) blank(index + 1)
        index += 2
        continue
      }
      if (char === '[') inCharClass = true
      else if (char === ']') inCharClass = false
      else if (char === '/' && !inCharClass) {
        blank(index)
        state = 'code'
        lastCodeChar = '/'
        lastWord = ''
        index += 1
        continue
      }
      blank(index)
      index += 1
      continue
    }

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line'
        blank(index); blank(index + 1)
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        state = 'block'
        blank(index); blank(index + 1)
        index += 2
        continue
      }
      if (char === '/' && startsRegex(source, index, lastCodeChar, lastWord)) {
        state = 'regex'
        inCharClass = false
        blank(index)
        index += 1
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        state = 'string'
        quote = char
        blank(index)
        index += 1
        continue
      }
      observe(char)
      index += 1
      continue
    }

    if (state === 'line') {
      if (char === '\n') {
        state = 'code'
        index += 1
        continue
      }
      blank(index)
      index += 1
      continue
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        blank(index); blank(index + 1)
        state = 'code'
        index += 2
        continue
      }
      blank(index)
      index += 1
      continue
    }

    // state === 'string'
    if (char === '\\') {
      blank(index)
      if (index + 1 < source.length) blank(index + 1)
      index += 2
      continue
    }
    if (char === quote) {
      blank(index)
      state = 'code'
      lastCodeChar = quote
      lastWord = ''
      index += 1
      continue
    }
    blank(index)
    index += 1
  }

  return masked.join('')
}

function lineOf(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1
  }
  return line
}

/** Is this import() argument a static / already-URL value? */
function isAllowedImportArgument(argument) {
  if (!argument) return false
  // 'x' or "x" (no escapes needed for module specifiers)
  if (/^'[^'\\]*'$/.test(argument) || /^"[^"\\]*"$/.test(argument)) return true
  // `x` without interpolation
  if (/^`[^`\\$]*`$/.test(argument)) return true
  // pathToFileURL(anything) or anything already ending in .href
  if (/^pathToFileURL\s*\(/.test(argument)) return true
  if (/\.href\s*$/.test(argument) && !/^['"]/.test(argument)) return true
  return false
}

function findDynamicImportProblems(file) {
  const source = fs.readFileSync(file, 'utf8')
  const masked = maskNonCode(source)
  const problems = []
  const pattern = /(?<![\w$])import\s*\(/g
  let match

  while ((match = pattern.exec(masked)) !== null) {
    const openParen = match.index + match[0].lastIndexOf('(')
    // Walk to the matching close paren; strings are blanked, so their parens
    // cannot confuse the depth count.
    let depth = 0
    let closeParen = -1
    for (let i = openParen; i < masked.length; i += 1) {
      if (masked[i] === '(') depth += 1
      else if (masked[i] === ')') {
        depth -= 1
        if (depth === 0) {
          closeParen = i
          break
        }
      }
    }
    if (closeParen === -1) {
      problems.push({ line: lineOf(source, match.index), message: 'unbalanced import( )' })
      continue
    }
    const argument = source.slice(openParen + 1, closeParen).trim()
    if (isAllowedImportArgument(argument)) continue
    problems.push({
      line: lineOf(source, match.index),
      message: `import(${argument}) receives a computed/plain path; use a string literal, `
        + 'pathToFileURL(path).href, or createRequire(import.meta.url) for native paths',
    })
  }
  return problems
}

function findExecSyncProblems(file) {
  const source = fs.readFileSync(file, 'utf8')
  const masked = maskNonCode(source)
  const problems = []
  const pattern = /(?<![\w$.])execSync\s*\(/g
  let match
  while ((match = pattern.exec(masked)) !== null) {
    problems.push({
      line: lineOf(source, match.index),
      message: 'execSync() runs one shell command string and breaks on paths with spaces; '
        + 'use execFileSync(command, [args])',
    })
  }
  return problems
}

function findNonAsciiLines(file) {
  const source = fs.readFileSync(file, 'utf8')
  const problems = []
  source.split(/\r?\n/).forEach((text, index) => {
    const bad = [...text].filter((char) => char.codePointAt(0) > 127)
    if (bad.length > 0) {
      problems.push({
        line: index + 1,
        message: `non-ASCII characters (${bad.slice(0, 3).join(' ')}); `
          + 'Windows PowerShell 5.1 / cmd mis-decode these - replace with plain ASCII',
      })
    }
  })
  return problems
}

/**
 * Run every rule.
 * @returns {{results: {ok: boolean, label: string, detail: string}[], failures: string[], stats: object}}
 */
export function lintScripts() {
  const results = []
  const failures = []

  const scripts = collectFiles(root, SCRIPT_EXTENSIONS)
  const helpers = collectFiles(root, ASCII_EXTENSIONS)

  const dynamicImportProblems = []
  const execSyncProblems = []
  for (const file of scripts) {
    for (const problem of findDynamicImportProblems(file)) {
      const where = `${path.relative(root, file).replace(/\\/g, '/')}:${problem.line}`
      dynamicImportProblems.push(`${where} - ${problem.message}`)
    }
    for (const problem of findExecSyncProblems(file)) {
      const where = `${path.relative(root, file).replace(/\\/g, '/')}:${problem.line}`
      execSyncProblems.push(`${where} - ${problem.message}`)
    }
  }

  const asciiProblems = []
  for (const file of helpers) {
    for (const problem of findNonAsciiLines(file)) {
      const where = `${path.relative(root, file).replace(/\\/g, '/')}:${problem.line}`
      asciiProblems.push(`${where} - ${problem.message}`)
    }
  }

  const push = (problems, okLabel, failLabel) => {
    const ok = problems.length === 0
    results.push({
      ok,
      label: ok ? okLabel : failLabel,
      detail: ok ? '' : problems.map((line) => `\n      ${line}`).join(''),
    })
    if (!ok) failures.push(...problems)
  }

  push(
    dynamicImportProblems,
    `dynamic import() arguments are static or file URLs (${scripts.length} script file(s) scanned)`,
    `dynamic import() with a computed/plain path (${dynamicImportProblems.length}) - fails on Windows`,
  )
  push(
    execSyncProblems,
    'no execSync() shell strings in scripts',
    `execSync() found (${execSyncProblems.length}) - breaks on paths with spaces`,
  )
  push(
    asciiProblems,
    `.ps1/.bat helpers are plain ASCII (${helpers.length} file(s) scanned)`,
    `non-ASCII text in .ps1/.bat helpers (${asciiProblems.length} line(s))`,
  )

  return { results, failures, stats: { scripts: scripts.length, helpers: helpers.length } }
}

// Run when executed directly (`npm run lint:scripts`), stay silent when imported
// by scripts/verify-package.mjs.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    // realpath + resolve keeps this true on Windows (drive letter case, 8.3 names).
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  console.log('\nScript portability lint (Windows-safe import(), no shell strings, ASCII helpers)\n')
  const { results, failures, stats } = lintScripts()
  for (const result of results) {
    console.log(`${result.ok ? '  PASS' : '  FAIL'}  ${result.label}${result.detail}`)
  }
  console.log(`\n${stats.scripts} .mjs/.cjs file(s) and ${stats.helpers} .ps1/.bat file(s) scanned.`)
  if (failures.length > 0) {
    console.log(`\n${failures.length} problem(s) found.`)
    process.exit(1)
  }
  console.log('\nNo problems found.')
}
