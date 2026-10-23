import type { LABEL_LAYOUT } from '@shared/label'

export interface PrinterInfo {
  name: string
  driverName?: string
  status?: number
}

export interface PrinterSettingsResponse {
  printers: PrinterInfo[]
  configuredPrinter: string
  driver: 'windows' | 'file'
}

export interface PrintLabelsPayload {
  selection:
    | { type: 'ids'; ids: number[] }
    | {
        type: 'filter'
        filter: {
          noc?: string
          department?: string
          categoryId?: number
          pouchStatus?: 'in' | 'out'
          search?: string
        }
      }
    | { type: 'unprinted' }
  reason?: string
}

export interface PrintResultResponse {
  jobId: number
  count: number
  status: 'sent'
  driver: 'windows' | 'file'
}

export interface LabelPreviewData {
  participant: {
    id: number
    bib_number: string
    noc: string
    name: string
    gun_number: string
    category_name?: string | null
    label_printed: boolean
    label_stale: boolean
  }
  layout: typeof LABEL_LAYOUT
  zpl?: string
}

export interface LabelSummary {
  total: number
  printed: number
  unprinted: number
  stale: number
}

export function isMockMode(): boolean {
  return import.meta.env.VITE_USE_MOCK === 'true'
}

export function formatPrinterErrorMessage(error: any): string {
  const code = error?.code || error?.error?.code
  const message = error?.message || error?.error?.message

  switch (code) {
    case 'PRINTER_NOT_FOUND':
      return 'Configured printer not found. Please verify the Zebra printer is connected, turned on, and listed in Windows Printers.'
    case 'PRINTER_OFFLINE':
      return 'The printer is offline or in an error state. Please check the USB connection, power, and verify labels are loaded properly.'
    case 'SPOOL_FAILED':
      return 'Failed to send print job to Windows spooler. Please check the Windows Print Spooler service and clear any stalled jobs.'
    case 'LABEL_TOO_WIDE':
      return 'Gun number is too long to fit on this label format. Please check the gun number or adjust label size.'
    case 'REASON_REQUIRED':
      return 'A reason of at least 3 characters is required to reprint previously printed labels.'
    case 'EMPTY_SELECTION':
      return 'No participants match the selected print criteria.'
    default:
      return message || 'An unexpected error occurred while communicating with the printer.'
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  })

  if (!res.ok) {
    let errBody: any
    try {
      errBody = await res.json()
    } catch {
      errBody = { error: { code: 'HTTP_' + res.status, message: res.statusText } }
    }
    const err = new Error(errBody.error?.message || 'Request failed')
    ;(err as any).code = errBody.error?.code || 'REQUEST_FAILED'
    ;(err as any).status = res.status
    ;(err as any).fields = errBody.error?.fields
    throw err
  }

  return res.json()
}

export const printingApi = {
  async getPrinters(): Promise<PrinterSettingsResponse> {
    if (isMockMode()) {
      return {
        printers: [
          { name: 'Zebra ZD220 (203dpi)', driverName: 'ZDesigner ZD220-203dpi ZPL', status: 0 },
          { name: 'Microsoft Print to PDF', driverName: 'Microsoft Print to PDF', status: 0 },
        ],
        configuredPrinter: 'Zebra ZD220 (203dpi)',
        driver: 'windows',
      }
    }
    return request<PrinterSettingsResponse>('/api/printing/printers')
  },

  async printTestLabel(): Promise<{ ok: boolean; jobId: number; driver: string; printerName: string }> {
    if (isMockMode()) {
      return { ok: true, jobId: 9999, driver: 'file', printerName: 'Demo Printer' }
    }
    return request<{ ok: boolean; jobId: number; driver: string; printerName: string }>('/api/printing/test', {
      method: 'POST',
    })
  },

  async printLabels(payload: PrintLabelsPayload): Promise<PrintResultResponse> {
    if (isMockMode()) {
      const count = payload.selection.type === 'ids' ? payload.selection.ids.length : 1
      return { jobId: Math.floor(Math.random() * 1000) + 1, count, status: 'sent', driver: 'file' }
    }
    return request<PrintResultResponse>('/api/labels/print', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async getPreview(participantId: number | string): Promise<LabelPreviewData> {
    if (isMockMode()) {
      return {
        participant: {
          id: Number(participantId),
          bib_number: '101',
          noc: 'IND',
          name: 'Demo Athlete',
          gun_number: 'G-201',
          category_name: 'Senior Men',
          label_printed: false,
          label_stale: false,
        },
        layout: {} as any,
      }
    }
    return request<LabelPreviewData>(`/api/labels/preview/${participantId}`)
  },

  async getSummary(): Promise<LabelSummary> {
    if (isMockMode()) {
      return { total: 40, printed: 25, unprinted: 15, stale: 0 }
    }
    return request<LabelSummary>('/api/labels/summary')
  },
}
