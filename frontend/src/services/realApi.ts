import type { AppSettings, Participant, Transaction, User } from '@/types'
import { downloadFile, request, uploadFile, type ApiError } from '@/lib/api'

type ApiUser = {
  id: number
  full_name: string
  username: string
  role: 'admin' | 'staff'
  permissions: User['permissions']
  active: boolean
  must_change_password: boolean
  last_login_at: string | null
}
type ApiParticipant = {
  row?: number
  id: number
  bib_number: string
  noc: string
  name: string
  department: string | null
  gun_number: string
  contact_number: string | null
  category_id: number
  category_name?: string | null
  pouch_status: 'in' | 'out'
  label_printed: boolean
  label_stale: boolean
  label_printed_at: string | null
  created_at: string
}
type ApiTransaction = {
  id: number
  participant_id: number
  participant_name?: string
  participant_bib?: string
  noc?: string
  bib_number?: string
  gun_number?: string
  type: 'in' | 'out'
  created_at: string
  user_id: number | null
  user_name?: string
  manual_entry?: boolean
  status?: 'valid' | 'corrected' | 'voided'
  original_type?: 'in' | 'out'
  correction_reason?: string
  corrected_by?: number
  corrected_at?: string
}

const userFromApi = (user: ApiUser): User => ({
  id: String(user.id),
  name: user.full_name,
  username: user.username,
  password: '',
  role: user.role,
  permissions: user.permissions,
  active: user.active,
  mustChangePassword: user.must_change_password,
  lastLogin: user.last_login_at ?? undefined,
})

const participantFromApi = (item: ApiParticipant): Participant => ({
  id: String(item.id),
  bibNumber: item.bib_number,
  noc: item.noc,
  name: item.name,
  department: item.department ?? '',
  gunNumber: item.gun_number,
  contactNumber: item.contact_number ?? '',
  category: item.category_name ?? '',
  barcodeValue: item.gun_number,
  status: item.pouch_status,
  labelPrinted: item.label_printed,
  labelStale: item.label_stale,
  labelPrintedAt: item.label_printed_at,
  createdAt: item.created_at,
})

const transactionFromApi = (item: ApiTransaction): Transaction => ({
  id: String(item.id),
  participantId: String(item.participant_id),
  type: item.type === 'in' ? 'check-in' : 'check-out',
  timestamp: item.created_at,
  performedBy: String(item.user_id ?? ''),
  status: item.status ?? 'valid',
  originalType: item.original_type === 'in' ? 'check-in' : item.original_type === 'out' ? 'check-out' : undefined,
  correctionReason: item.correction_reason,
  correctedBy: item.corrected_by === undefined ? undefined : String(item.corrected_by),
  correctedAt: item.corrected_at,
  participantName: item.participant_name,
  participantBib: item.participant_bib ?? item.bib_number,
  participantNoc: item.noc,
  gunNumber: item.gun_number,
  performerName: item.user_name,
})

const settingsFromApi = (raw: Record<string, string>): AppSettings => ({
  eventName: raw.event_name ?? 'Range Operations',
  logoText: raw.logo_text ?? 'RO',
  labelSize: (raw.label_size as AppSettings['labelSize']) ?? 'medium',
  scanSound: raw.scan_sound !== 'false',
  duplicateWindowSeconds: Number(raw.duplicate_scan_window_seconds ?? 5),
  printerName: raw.printer_name,
  labelWidthMm: Number(raw.label_width_mm ?? 70),
  labelHeightMm: Number(raw.label_height_mm ?? 40),
  labelDpi: Number(raw.label_dpi ?? 203),
  labelDarkness: Number(raw.label_darkness ?? 15),
  labelSpeed: Number(raw.label_speed ?? 4),
  labelOffsetX: Number(raw.label_offset_x ?? 0),
  labelOffsetY: Number(raw.label_offset_y ?? 0),
  labelShowEventName: raw.label_show_event_name !== 'false',
  labelMediaTracking: (raw.label_media_tracking as AppSettings['labelMediaTracking']) ?? 'gap',
  printDriver: (raw.print_driver as AppSettings['printDriver']) ?? 'file',
  backupFolder: raw.backup_folder ?? '',
})

const settingsToApi = (settings: AppSettings): Record<string, string> => ({
  event_name: settings.eventName,
  logo_text: settings.logoText,
  label_size: settings.labelSize,
  scan_sound: String(settings.scanSound),
  duplicate_scan_window_seconds: String(settings.duplicateWindowSeconds),
  ...(settings.backupFolder !== undefined ? { backup_folder: settings.backupFolder } : {}),
  ...(settings.printerName ? { printer_name: settings.printerName } : {}),
  ...(settings.labelWidthMm ? { label_width_mm: String(settings.labelWidthMm) } : {}),
  ...(settings.labelHeightMm ? { label_height_mm: String(settings.labelHeightMm) } : {}),
  ...(settings.labelDpi ? { label_dpi: String(settings.labelDpi) } : {}),
})

async function getCategories(): Promise<Array<{ id: number; name: string; active: boolean }>> {
  const result = await request<{ data: Array<{ id: number; name: string; active: boolean }> }>('/api/categories')
  return result.data
}

async function categoryIdFor(name: string): Promise<number> {
  const categories = await getCategories()
  const category = categories.find((item) => item.name === name)
  if (!category) throw new Error(`Unknown category: ${name}`)
  return category.id
}

export const realApi = {
  request,
  async bootstrap() {
    const [me, participantResponse, transactionResponse, userResponse, categories, settingsResponse] = await Promise.all([
      request<{ user: ApiUser }>('/api/auth/me'),
      request<{ data: ApiParticipant[] }>('/api/participants', { query: { limit: 500 } }),
      request<{ data: ApiTransaction[] }>('/api/transactions', { query: { limit: 500 } }),
      request<{ data: ApiUser[] }>('/api/users').catch((error: ApiError) => error.status === 403 ? { data: [] } : Promise.reject(error)),
      getCategories(),
      request<{ settings: Record<string, string> }>('/api/settings'),
    ])
    return {
      currentUser: userFromApi(me.user),
      participants: participantResponse.data.map(participantFromApi),
      transactions: transactionResponse.data.map(transactionFromApi),
      users: userResponse.data.map(userFromApi),
      categories,
      settings: settingsFromApi(settingsResponse.settings),
      activity: [],
    }
  },
  async login(username: string, password: string) {
    const result = await request<{ user: ApiUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    return userFromApi(result.user)
  },
  async logout() { return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }) },
  async me() { const result = await request<{ user: ApiUser }>('/api/auth/me'); return userFromApi(result.user) },
  async changePassword(currentPassword: string, newPassword: string) {
    return request<{ ok: boolean }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
  },
  async listParticipants(query: Record<string, string | number | undefined> = {}) {
    const params = { ...query }
    if (typeof params.category === 'string') {
      const category = (await getCategories()).find((item) => item.name === params.category)
      delete params.category
      if (category) params.category_id = category.id
    }
    const result = await request<{ data: ApiParticipant[]; total: number; page: number; limit: number }>('/api/participants', { query: params })
    return { ...result, data: result.data.map(participantFromApi) }
  },
  async getParticipant(id: string) {
    const result = await request<{ participant: ApiParticipant; transactions: ApiTransaction[] }>(`/api/participants/${id}`)
    return { participant: participantFromApi(result.participant), transactions: result.transactions.map(transactionFromApi) }
  },
  async addParticipant(input: Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>) {
    const category_id = await categoryIdFor(input.category)
    const result = await request<{ participant: ApiParticipant }>('/api/participants', {
      method: 'POST',
      body: JSON.stringify({
        bib_number: input.bibNumber, noc: input.noc, name: input.name, department: input.department,
        gun_number: input.gunNumber, contact_number: input.contactNumber, category_id,
      }),
    })
    return participantFromApi(result.participant)
  },
  async updateParticipant(participant: Participant) {
    const category_id = await categoryIdFor(participant.category)
    const result = await request<{ participant: ApiParticipant }>(`/api/participants/${participant.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        bib_number: participant.bibNumber, noc: participant.noc, name: participant.name,
        department: participant.department, gun_number: participant.gunNumber,
        contact_number: participant.contactNumber, category_id,
      }),
    })
    return participantFromApi(result.participant)
  },
  async deleteParticipants(ids: string[]) {
    await Promise.all(ids.map((id) => request<void>(`/api/participants/${id}`, { method: 'DELETE' })))
  },
  async getImportTemplate() { return downloadFile('/api/participants/import/template', 'range-participants-template.xlsx') },
  async previewImport(file: File) {
    return uploadFile<{ previewId: string; valid: ApiParticipant[]; errors: Array<{ row: number; values: Record<string, string>; reasons: string[] }>; total: number }>('/api/participants/import/preview', file)
  },
  async commitImport(previewId: string, mode: 'skip' | 'update') {
    return request<{ imported: number; updated: number; rejected: number }>('/api/participants/import/commit', { method: 'POST', body: JSON.stringify({ previewId, mode }) })
  },
  async downloadImportErrors(previewId: string) {
    return downloadFile(`/api/participants/import/errors/${previewId}`, 'participant-import-errors.xlsx')
  },
  async scan(code: string, manual = false, confirm = false) {
    return request<{ participant: ApiParticipant; new_status: 'in' | 'out'; transaction_id: number; transaction_time: string }>('/api/scan', {
      method: 'POST', body: JSON.stringify({ code, manual, confirm }),
    })
  },
  async scanSummary() { return request<{ in: number; out: number; total: number; printed: number; unprinted: number; stale: number }>('/api/scan/summary') },
  async recentScans() {
    const result = await request<{ data: ApiTransaction[] }>('/api/scan/recent')
    return result.data.map(transactionFromApi)
  },
  async listTransactions(query: Record<string, string | number | undefined> = {}) {
    const result = await request<{ data: ApiTransaction[]; total: number; page: number; limit: number }>('/api/transactions', { query })
    return { ...result, data: result.data.map(transactionFromApi) }
  },
  async previewCorrection(input: {
    action: 'edit' | 'void' | 'add'; transactionId?: number; participantId?: number
    newType?: 'in' | 'out'; newTimestamp?: string; reason?: string
  }) {
    const result = await request<{
      oldValues: Record<string, unknown> | null
      newValues: Record<string, unknown>
      sequence: ApiTransaction[]
      pouchStatus: 'in' | 'out'
      validationErrors: string[]
    }>('/api/transactions/corrections/preview', { method: 'POST', body: JSON.stringify(input) })
    return { ...result, sequence: result.sequence.map(transactionFromApi) }
  },
  async saveCorrection(input: {
    action: 'edit' | 'void' | 'add'; transactionId?: number; participantId?: number
    newType?: 'in' | 'out'; newTimestamp?: string; reason: string
  }) {
    const result = await request<{ transaction: ApiTransaction; pouchStatus: 'in' | 'out' }>('/api/transactions/corrections', { method: 'POST', body: JSON.stringify(input) })
    return { ...result, transaction: transactionFromApi(result.transaction) }
  },
  async listCorrections(query: Record<string, string | number | undefined> = {}) {
    return request<{ data: Array<Record<string, unknown>>; total: number; page: number; limit: number }>('/api/corrections', { query })
  },
  async listUsers() {
    const result = await request<{ data: ApiUser[] }>('/api/users')
    return result.data.map(userFromApi)
  },
  async saveUser(user: Omit<User, 'id'> & { id?: string }) {
    const body = { full_name: user.name, username: user.username, role: user.role, permissions: user.permissions, active: user.active }
    const result = user.id
      ? await request<{ user: ApiUser }>(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await request<{ user: ApiUser }>('/api/users', { method: 'POST', body: JSON.stringify({ ...body, password: user.password }) })
    return userFromApi(result.user)
  },
  async resetPassword(id: string, newPassword: string) {
    return request<{ ok: boolean }>(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) })
  },
  async categories() { return getCategories() },
  async saveCategory(id: number, name: string, active: boolean) {
    const result = await request<{ category: { id: number; name: string; active: boolean } }>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name, active }) })
    return result.category
  },
  async getSettings() {
    const result = await request<{ settings: Record<string, string> }>('/api/settings')
    return settingsFromApi(result.settings)
  },
  async saveSettings(settings: AppSettings) {
    const result = await request<{ settings: Record<string, string> }>('/api/settings', { method: 'PATCH', body: JSON.stringify(settingsToApi(settings)) })
    return settingsFromApi(result.settings)
  },
  async activity(query: Record<string, string | number | undefined> = {}) {
    const result = await request<{ data: Array<{ id: number; user_id: number | null; action: string; entity: string; old_values: string | null; new_values: string | null; created_at: string; user_name?: string }>; total: number; page: number; limit: number }>('/api/activity', { query })
    return { ...result, data: result.data.map((item) => ({
      id: String(item.id), userId: String(item.user_id ?? ''), userName: item.user_name ?? '',
      action: item.action, entity: item.entity, details: item.new_values ?? item.old_values ?? '',
      timestamp: item.created_at,
    })) }
  },
  async report(name: string, query: Record<string, string | number | undefined> = {}) {
    return request<{ data: Array<Record<string, unknown>>; total: number }>(`/api/reports/${name}`, { query })
  },
  async downloadReport(name: string, query: Record<string, string | number | undefined> = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...query, format: 'xlsx' })) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    await downloadFile(`/api/reports/${name}?${params.toString()}`, `range-${name}.xlsx`)
  },
  async backupStatus() {
    return request<{ lastManualBackupAt: string | null; hoursSinceManualBackup: number | null; lastAutomaticBackupAt: string | null; backupFolder: string; allowDemoReset: boolean }>('/api/backup/status')
  },
  async createBackup(destinationPath?: string) {
    return request<{ filename: string; createdAt: string; destination: string }>('/api/backup', { method: 'POST', body: JSON.stringify(destinationPath ? { destinationPath } : {}) })
  },
  async downloadBackup() { await downloadFile('/api/backup/download', `shootingrange-backup-${new Date().toISOString().slice(0, 10)}.db`) },
  async restoreBackup(file: File, confirmation: string) {
    const body = new FormData()
    body.append('file', file)
    body.append('confirm', confirmation)
    return request<{ ok: boolean; preRestoreBackup: string }>('/api/backup/restore', { method: 'POST', body })
  },
  async exportAll() { await downloadFile('/api/export/all', 'shootingrange-export-all.xlsx') },
  async resetDemo() { return request<{ ok: boolean }>('/api/settings/reset-demo', { method: 'POST', body: JSON.stringify({}) }) },
}
