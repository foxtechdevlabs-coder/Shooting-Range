import { describe, it, expect } from 'vitest'
import { buildLabelZpl, buildBatchZpl, LabelValidationError } from '../services/zpl.js'

describe('ZPL generator', () => {
  it('generates correct ^PW/^LL for 50x25 at 203 dpi with Code 128 barcode', () => {
    const zpl = buildLabelZpl({
      bib_number: '101',
      name: 'John Doe',
      gun_number: 'G-201',
    })

    expect(zpl).toContain('^XA')
    expect(zpl).toContain('^PW400')
    expect(zpl).toContain('^LL200')
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain('^MTD')
    expect(zpl).toContain('^MNY')
    expect(zpl).toContain('^BY2,3,')
    expect(zpl).toContain('^BCN,')
    expect(zpl).toContain('^FDG-201^FS')
    expect(zpl).toContain('^FDBIB 101^FS')
    expect(zpl).toContain('^FDJohn Doe^FS')
    expect(zpl).toContain('^FDGUN G-201^FS')
    expect(zpl).toContain('^PQ1')
    expect(zpl).toContain('^XZ')
  })

  it('sanitizes text containing ^ and ~ and uppercases gun number', () => {
    const zpl = buildLabelZpl({
      bib_number: '101^XZ',
      name: 'Jane~Doe^MTD',
      gun_number: 'g-abc^123~xyz',
    })

    // ^ replaced with _, ~ replaced with -
    expect(zpl).not.toContain('101^XZ')
    expect(zpl).toContain('^FDBIB 101_XZ^FS')
    expect(zpl).toContain('^FDJane-Doe_MTD^FS')
    expect(zpl).toContain('^FDG-ABC_123-XYZ^FS')
  })

  it('truncates long names to 24 characters without wrapping', () => {
    const zpl = buildLabelZpl({
      bib_number: '205',
      name: 'Alexander Maximilian Konstantinos III of Athens',
      gun_number: 'G-305',
    })

    // 24 chars max
    expect(zpl).toContain('^FDAlexander Maximilian Kon^FS')
    expect(zpl).not.toContain('Alexander Maximilian Konstantinos III of Athens')
  })

  it('picks ^BY 1 for medium-long barcodes and rejects overly long gun numbers with LABEL_TOO_WIDE', () => {
    // Length 15: (11 * 15 + 55) * 2 = 440 dots (> 360 available), so ^BY 1 is picked: 220 dots (<= 360)
    const zpl = buildLabelZpl({
      bib_number: '301',
      name: 'Test Athlete',
      gun_number: '123456789012345',
    })
    expect(zpl).toContain('^BY1,3,')

    // Overly long: length 30 -> 11 * 30 + 55 = 385 modules (> 360 dots max width)
    expect(() => {
      buildLabelZpl({
        bib_number: '302',
        name: 'Test Athlete',
        gun_number: 'A'.repeat(30),
      })
    }).toThrowError(LabelValidationError)

    try {
      buildLabelZpl({
        bib_number: '302',
        name: 'Test Athlete',
        gun_number: 'A'.repeat(30),
      })
    } catch (e: any) {
      expect(e.code).toBe('LABEL_TOO_WIDE')
    }
  })

  it('includes optional event name when showEventName is true', () => {
    const zpl = buildLabelZpl(
      {
        bib_number: '101',
        name: 'John Doe',
        gun_number: 'G-201',
      },
      {
        showEventName: true,
        eventName: 'National Shooting Championship 2026',
      }
    )

    expect(zpl).toContain('^FDNational Shooting Championship 2026^FS')
  })

  it('concatenates batch labels', () => {
    const batch = buildBatchZpl([
      { bib_number: '101', name: 'Athlete 1', gun_number: 'G-101' },
      { bib_number: '102', name: 'Athlete 2', gun_number: 'G-102' },
    ])

    const startCount = (batch.match(/\^XA/g) || []).length
    const endCount = (batch.match(/\^XZ/g) || []).length
    expect(startCount).toBe(2)
    expect(endCount).toBe(2)
  })
})
