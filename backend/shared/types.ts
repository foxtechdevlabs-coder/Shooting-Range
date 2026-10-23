// Shared API response types used by both frontend and backend
import type { Permission } from './permissions.js'
import type { LABEL_LAYOUT } from './label.js'

export interface ApiUser {
  id: number
  full_name: string
  username: string
  role: 'admin' | 'staff'
  permissions: Permission[]
  active: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
}

export interface ApiCategory {
  id: number
  name: string
  active: boolean
}

export interface ApiParticipant {
  id: number
  bib_number: string
  noc: string
  name: string
  department: string | null
  gun_number: string
  contact_number: string | null
  category_id: number
  category_name?: string
  pouch_status: 'in' | 'out'
  label_printed: boolean
  label_stale: boolean
  label_printed_at: string | null
  created_at: string
  updated_at: string
}

export interface ApiTransaction {
  id: number
  participant_id: number
  participant_name?: string
  participant_bib?: string
  gun_number: string
  type: 'in' | 'out'
  created_at: string
  user_id: number
  user_name?: string
  manual_entry: boolean
}

export interface ApiScanResult {
  participant: {
    id: number
    bib_number: string
    name: string
    noc: string
    gun_number: string
    category_name: string
    pouch_status: 'in' | 'out'
  }
  new_status: 'in' | 'out'
  transaction_id: number
  transaction_time: string
}

export interface ApiSettings {
  event_name: string
  duplicate_scan_window_seconds: string
  idle_timeout_minutes: string
  scan_sound?: string
  logo_text?: string
  label_size?: string
  printer_name?: string
  label_width_mm?: string
  label_height_mm?: string
  label_dpi?: string
  label_darkness?: string
  label_speed?: string
  label_offset_x?: string
  label_offset_y?: string
  label_show_event_name?: string
  label_media_tracking?: string
  print_driver?: string
}

export interface ApiError {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ImportPreviewResponse {
  previewId: string
  valid: ApiParticipant[]
  errors: Array<{
    row: number
    values: Record<string, string>
    reasons: string[]
  }>
  total: number
}

export interface ImportCommitResponse {
  imported: number
  updated: number
  rejected: number
}

export interface PrinterInfo {
  name: string
  driverName?: string
  status?: number
}

export interface PrintJob {
  id: number
  user_id: number | null
  user_name?: string
  created_at: string
  kind: 'print' | 'reprint' | 'test'
  label_count: number
  reason: string | null
  status: 'sent' | 'failed'
  error: string | null
  printer_name: string
}

export interface PrintSummaryResponse {
  total: number
  printed: number
  unprinted: number
  stale: number
}

export interface LabelPreviewResponse {
  participant: ApiParticipant
  layout: typeof LABEL_LAYOUT
  zpl?: string
}

export interface PrintLabelsRequest {
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

export interface PrintLabelsResponse {
  jobId: number
  count: number
  status: 'sent'
  driver: string
}
