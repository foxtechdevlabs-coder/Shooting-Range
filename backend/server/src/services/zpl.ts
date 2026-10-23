import {
  type LabelConfig,
  DEFAULT_LABEL_CONFIG,
  LABEL_LAYOUT,
  mmToDots,
  sanitizeZplText,
  sanitizeBarcodeValue,
  truncateName,
  fitCode128,
} from '../../../shared/label.js'

export interface ZplParticipantInput {
  bib_number: string
  name: string
  gun_number: string
  noc?: string
  category_name?: string | null
}

export class LabelValidationError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LabelValidationError'
    this.code = code
  }
}

/**
 * Generate ZPL for a single label.
 * Pure function: takes participant data and settings, returns ZPL string.
 * Throws LabelValidationError with code 'LABEL_TOO_WIDE' if barcode cannot fit.
 */
export function buildLabelZpl(
  participant: ZplParticipantInput,
  userSettings?: Partial<LabelConfig>
): string {
  const settings: LabelConfig = { ...DEFAULT_LABEL_CONFIG, ...userSettings }

  const widthDots = mmToDots(settings.widthMm, settings.dpi)
  const heightDots = mmToDots(settings.heightMm, settings.dpi)

  const barcodeValue = sanitizeBarcodeValue(participant.gun_number)
  if (!barcodeValue) {
    throw new LabelValidationError('LABEL_TOO_WIDE', 'Gun number is required for barcode')
  }

  // Available width for barcode considering left and right margins
  const leftMarginDots = LABEL_LAYOUT.margin.leftDots
  const rightMarginDots = LABEL_LAYOUT.margin.leftDots
  const maxBarcodeWidthDots = widthDots - leftMarginDots - rightMarginDots

  const fit = fitCode128(barcodeValue, maxBarcodeWidthDots)
  if (!fit) {
    throw new LabelValidationError(
      'LABEL_TOO_WIDE',
      `Gun number "${barcodeValue}" is too long to fit on a ${settings.widthMm}mm label`
    )
  }

  const cleanBib = sanitizeZplText(participant.bib_number)
  const cleanName = truncateName(participant.name, LABEL_LAYOUT.maxNameChars)
  const cleanGun = sanitizeZplText(barcodeValue)
  const cleanEvent = sanitizeZplText(settings.eventName ?? '')

  const showEvent = settings.showEventName && cleanEvent.length > 0
  const layout = showEvent ? LABEL_LAYOUT.withEventName : LABEL_LAYOUT.withoutEventName

  const lines: string[] = []
  lines.push('^XA')
  lines.push('^CI28') // UTF-8 encoding
  lines.push(`^PW${widthDots}`)
  lines.push(`^LL${heightDots}`)
  lines.push(`^LH${settings.offsetX},${settings.offsetY}`)
  lines.push('^MTD') // Direct thermal

  if (settings.mediaTracking === 'gap') {
    lines.push('^MNY') // Gap tracking
  } else if (settings.mediaTracking === 'none') {
    lines.push('^MNN') // Continuous
  }

  if (settings.speed > 0) {
    lines.push(`^PR${settings.speed}`)
  }
  if (settings.darkness >= 0) {
    lines.push(`~SD${settings.darkness}`)
  }

  // Event name line (optional)
  if (showEvent && 'eventLine' in layout) {
    const el = layout.eventLine
    lines.push(`^FO${leftMarginDots},${el.y}^A0N,${el.fontH},${el.fontW}^FD${cleanEvent}^FS`)
  }

  // Bib number line
  const bl = layout.bibLine
  lines.push(`^FO${leftMarginDots},${bl.y}^A0N,${bl.fontH},${bl.fontW}^FDBIB ${cleanBib}^FS`)

  // Name line
  const nl = layout.nameLine
  lines.push(`^FO${leftMarginDots},${nl.y}^A0N,${nl.fontH},${nl.fontW}^FD${cleanName}^FS`)

  // Barcode (Code 128, interpretation line off)
  const bc = layout.barcode
  lines.push(`^BY${fit.moduleWidth},3,${bc.height}`)
  lines.push(`^FO${leftMarginDots},${bc.y}^BCN,${bc.height},N,N,N^FD${barcodeValue}^FS`)

  // Readable gun number line
  const gl = layout.gunNumberLine
  lines.push(`^FO${leftMarginDots},${gl.y}^A0N,${gl.fontH},${gl.fontW}^FDGUN ${cleanGun}^FS`)

  lines.push('^PQ1')
  lines.push('^XZ')

  return lines.join('\n')
}

/**
 * Generate batch ZPL for multiple participants.
 */
export function buildBatchZpl(
  participants: ZplParticipantInput[],
  userSettings?: Partial<LabelConfig>
): string {
  if (!participants.length) return ''
  return participants.map((p) => buildLabelZpl(p, userSettings)).join('\n')
}
