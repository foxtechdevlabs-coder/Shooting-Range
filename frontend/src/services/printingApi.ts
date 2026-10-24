import type { LABEL_LAYOUT } from '@shared/label'
import { request } from '@/lib/api'

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

export function formatPrinterErrorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string; error?: { code?: string; message?: string } }
  const code = value?.code || value?.error?.code
  const message = value?.message || value?.error?.message

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

export const printingApi = {
  async getPrinters(): Promise<PrinterSettingsResponse> {
    return request<PrinterSettingsResponse>('/api/printing/printers')
  },

  async printTestLabel(): Promise<{ ok: boolean; jobId: number; driver: string; printerName: string }> {
    return request<{ ok: boolean; jobId: number; driver: string; printerName: string }>('/api/printing/test', {
      method: 'POST',
    })
  },

  async printLabels(payload: PrintLabelsPayload): Promise<PrintResultResponse> {
    return request<PrintResultResponse>('/api/labels/print', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async getPreview(participantId: number | string): Promise<LabelPreviewData> {
    return request<LabelPreviewData>(`/api/labels/preview/${participantId}`)
  },

  async getSummary(): Promise<LabelSummary> {
    return request<LabelSummary>('/api/labels/summary')
  },

  async getJobs() {
    const result = await request<{ data: Array<Record<string, unknown>> }>('/api/labels/jobs')
    return result.data
  },
}
