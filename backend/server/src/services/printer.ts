import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import type { PrinterInfo } from '../../../shared/types.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FALLBACK_SCRIPT_PATH = path.join(__dirname, 'print-spool.ps1')

/**
 * Resolve print-spool.ps1 to a real file on disk.
 *
 * In a packaged app the script is unpacked from app.asar
 * (electron-builder `asarUnpack`) and the desktop shell passes its path through
 * startServer({ printScriptPath }). If a path inside app.asar slips through,
 * copy the script to the temp folder so PowerShell can execute it.
 */
function resolveSpoolScript(): string {
  const configured = config.printScriptPath || FALLBACK_SCRIPT_PATH
  if (!configured.includes('app.asar')) return configured
  const target = path.join(os.tmpdir(), 'rangeops-print-spool.ps1')
  try {
    if (!fs.existsSync(target)) fs.copyFileSync(configured, target)
    return target
  } catch {
    return configured
  }
}

export class PrinterError extends Error {
  code: 'PRINTER_NOT_FOUND' | 'PRINTER_OFFLINE' | 'SPOOL_FAILED' | 'LABEL_TOO_WIDE'
  constructor(
    code: 'PRINTER_NOT_FOUND' | 'PRINTER_OFFLINE' | 'SPOOL_FAILED' | 'LABEL_TOO_WIDE',
    message: string
  ) {
    super(message)
    this.name = 'PrinterError'
    this.code = code
  }
}

/**
 * Determine effective print driver: 'windows' | 'file'.
 * Default is 'file' in dev/tests, unless PRINT_DRIVER env is 'windows' or override specified.
 */
export function getEffectiveDriver(override?: string | null): 'windows' | 'file' {
  if (override === 'windows' || override === 'file') return override
  const fromEnv = process.env.PRINT_DRIVER
  if (fromEnv === 'windows' || fromEnv === 'file') return fromEnv
  // Packaged Windows builds talk to the spooler by default (NFR: real printer).
  if (config.packaged && os.platform() === 'win32') return 'windows'
  return 'file'
}

/**
 * List installed printers on Windows.
 * Returns empty array on non-Windows or if enumeration fails.
 */
export async function listPrinters(): Promise<PrinterInfo[]> {
  if (os.platform() !== 'win32') {
    return []
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Printer | Select-Object Name,DriverName,PrinterStatus | ConvertTo-Json -Compress',
      ],
      { timeout: 10000 }
    )

    const trimmed = stdout.trim()
    if (!trimmed) return []

    const parsed = JSON.parse(trimmed)
    const list = Array.isArray(parsed) ? parsed : [parsed]

    return list.map((item: any) => ({
      name: String(item.Name ?? ''),
      driverName: item.DriverName ? String(item.DriverName) : undefined,
      status: typeof item.PrinterStatus === 'number' ? item.PrinterStatus : 0,
    })).filter((p) => p.name.length > 0)
  } catch (err) {
    console.warn('[Printer] Failed to list Windows printers:', err)
    return []
  }
}

/** Write the ZPL to <dataDir>/labels so a failed print still leaves a usable file. */
function saveZplFallback(zpl: string): string | null {
  try {
    const labelsDir = config.labelsDir
    fs.mkdirSync(labelsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const suffix = Math.random().toString(36).slice(2, 8)
    const filePath = path.join(labelsDir, `${stamp}-notprinted-${suffix}.zpl`)
    fs.writeFileSync(filePath, zpl, { encoding: 'utf8' })
    console.warn('[Printer] Printer unavailable; ZPL saved to', filePath)
    return filePath
  } catch (error) {
    console.error('[Printer] Could not write ZPL fallback file:', error)
    return null
  }
}

export interface PrintOptions {
  printerName?: string
  driverOverride?: 'windows' | 'file'
}

export interface PrintResult {
  driver: 'windows' | 'file'
  target: string
  bytes: number
}

/**
 * Print raw ZPL via the effective driver.
 * - 'file': writes to data/labels/<timestamp>-<random>.zpl
 * - 'windows': sends raw bytes to Windows print spooler via winspool.drv
 */
export async function printZpl(
  zpl: string,
  options?: PrintOptions
): Promise<PrintResult> {
  const driver = getEffectiveDriver(options?.driverOverride)
  const bytes = Buffer.byteLength(zpl, 'utf8')

  if (driver === 'file') {
    const labelsDir = config.labelsDir
    if (!fs.existsSync(labelsDir)) {
      fs.mkdirSync(labelsDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const suffix = Math.random().toString(36).slice(2, 8)
    const filename = `${timestamp}-${suffix}.zpl`
    const filePath = path.join(labelsDir, filename)

    // Write UTF-8 with NO BOM
    fs.writeFileSync(filePath, zpl, { encoding: 'utf8' })
    return { driver: 'file', target: filePath, bytes }
  }

  try {
    return await printViaWindowsSpooler(zpl, options, bytes)
  } catch (error) {
    // Any printer problem still leaves a usable label file behind.
    if (error instanceof PrinterError) saveZplFallback(zpl)
    throw error
  }
}

/** Windows RAW (ZPL) printing through the spooler helper script. */
async function printViaWindowsSpooler(zpl: string, options: PrintOptions | undefined, bytes: number): Promise<PrintResult> {
  if (os.platform() !== 'win32') {
    throw new PrinterError('SPOOL_FAILED', 'Windows print driver is only supported on Windows OS.')
  }

  const requestedName = options?.printerName?.trim()
  if (!requestedName) {
    throw new PrinterError(
      'PRINTER_NOT_FOUND',
      'No label printer is configured yet. Choose your printer in Settings → Barcode labels. ' +
      'The label was saved to the labels folder instead.'
    )
  }

  const installed = await listPrinters()
  const matched = installed.find(
    (p) => p.name.toLowerCase() === requestedName.toLowerCase()
  )

  if (!matched) {
    throw new PrinterError(
      'PRINTER_NOT_FOUND',
      `Printer "${requestedName}" was not found on this computer. Check it in Settings → Barcode labels. ` +
      'The label was saved to the labels folder instead.'
    )
  }

  // PrinterStatus bit 0x20 = PRINTER_STATUS_OFFLINE, 0x02 = PRINTER_STATUS_ERROR
  if (matched.status && (matched.status & 0x20 || matched.status & 0x02)) {
    throw new PrinterError(
      'PRINTER_OFFLINE',
      `Printer "${matched.name}" is currently offline or in an error state.`
    )
  }

  // Write ZPL to temp file (UTF-8 no BOM)
  const tempPath = path.join(
    os.tmpdir(),
    `rangeops-label-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zpl`
  )

  try {
    fs.writeFileSync(tempPath, zpl, { encoding: 'utf8' })

    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolveSpoolScript(),
        matched.name,
        tempPath,
      ],
      { timeout: 15000 }
    )

    return { driver: 'windows', target: matched.name, bytes }
  } catch (err: any) {
    if (err.killed || err.signal === 'SIGTERM') {
      throw new PrinterError('SPOOL_FAILED', 'Print spooler timed out after 15 seconds.')
    }
    const message = err.stderr || err.message || 'Unknown spooler error'
    if (message.includes('OpenPrinter failed') || message.includes('error code: 1801')) {
      throw new PrinterError('PRINTER_NOT_FOUND', `Printer "${matched.name}" could not be opened.`)
    }
    throw new PrinterError('SPOOL_FAILED', `Failed to send print job to spooler: ${message}`)
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup error
    }
  }
}
