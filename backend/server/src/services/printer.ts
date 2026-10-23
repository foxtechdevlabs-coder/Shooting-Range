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
const SCRIPT_PATH = path.join(__dirname, 'print-spool.ps1')

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
  if (process.env.PRINT_DRIVER === 'windows') return 'windows'
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
    const labelsDir = path.join(config.dataDir, 'labels')
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

  // Windows RAW print driver
  if (os.platform() !== 'win32') {
    throw new PrinterError('SPOOL_FAILED', 'Windows print driver is only supported on Windows OS.')
  }

  const requestedName = options?.printerName?.trim()
  if (!requestedName) {
    throw new PrinterError('PRINTER_NOT_FOUND', 'No printer name configured for Windows printing.')
  }

  const installed = await listPrinters()
  const matched = installed.find(
    (p) => p.name.toLowerCase() === requestedName.toLowerCase()
  )

  if (!matched) {
    throw new PrinterError(
      'PRINTER_NOT_FOUND',
      `Printer "${requestedName}" not found in installed printers.`
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
        SCRIPT_PATH,
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
