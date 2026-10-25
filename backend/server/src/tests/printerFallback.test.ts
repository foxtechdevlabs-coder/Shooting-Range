/**
 * Printer failure fallback: a failed Windows-spooler print must still leave a
 * usable .zpl file in <dataDir>/labels, and surface a clear, actionable error.
 * (Runs on any OS: the non-Windows branch of the spooler is the same code path
 * the Windows "printer missing" branch takes.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { PrinterError, printZpl } from '../services/printer.js'

const SAMPLE_ZPL = '^XA^FO40,40^A0N,40,40^FDTEST^FS^XZ'

describe('printer fallback', () => {
  it('saves the ZPL to the labels folder when the printer cannot be reached', async () => {
    const before = fs.existsSync(config.labelsDir) ? fs.readdirSync(config.labelsDir) : []

    await expect(
      printZpl(SAMPLE_ZPL, { driverOverride: 'windows', printerName: 'Nonexistent ZD220' }),
    ).rejects.toBeInstanceOf(PrinterError)

    const after = fs.readdirSync(config.labelsDir)
    const created = after.filter((file) => !before.includes(file))
    expect(created.length).toBeGreaterThan(0)

    const fallback = created.find((file) => file.endsWith('.zpl'))
    expect(fallback).toBeTruthy()
    expect(fs.readFileSync(path.join(config.labelsDir, fallback!), 'utf8')).toBe(SAMPLE_ZPL)
  })

  it('keeps writing to the labels folder in file mode', async () => {
    const result = await printZpl(SAMPLE_ZPL, { driverOverride: 'file' })
    expect(result.driver).toBe('file')
    expect(fs.readFileSync(result.target, 'utf8')).toBe(SAMPLE_ZPL)
  })
})
