import type { AppSettings, Database, Participant, User } from '@/types'
import { CATEGORIES } from '@/types'
import { realApi } from './realApi'
import type { PrintLabelsPayload, PrinterSettingsResponse, LabelSummary, LabelPreviewData, PrintResultResponse } from './printingApi'

export const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'
const mock = async () => (await import('./mockApi')).api
const mockSessionKey = 'rangeops-demo-user'
const previews = new Map<string, {
  valid: Array<Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>>
  errors: Array<{ row: number; values: Record<string, string>; reasons: string[] }>
}>()

export const api = {
  async bootstrap() {
    if (!isMockMode) return realApi.bootstrap()
    const service = await mock()
    const db = service.snapshot()
    const user = db.users.find((item) => item.id === localStorage.getItem(mockSessionKey)) ?? null
    if (!user) throw Object.assign(new Error('Not signed in.'), { status: 401, code: 'UNAUTHENTICATED' })
    return { currentUser: user, ...db }
  },
  async login(username: string, password: string) {
    if (!isMockMode) return realApi.login(username, password)
    const service = await mock()
    const user = service.authenticate(username, password)
    if (!user) throw Object.assign(new Error('Invalid username or password.'), { status: 401, code: 'INVALID_CREDENTIALS' })
    localStorage.setItem(mockSessionKey, user.id)
    return user
  },
  async me() {
    if (!isMockMode) return realApi.me()
    const service = await mock()
    const user = service.snapshot().users.find((item) => item.id === localStorage.getItem(mockSessionKey))
    if (!user) throw Object.assign(new Error('Not signed in.'), { status: 401, code: 'UNAUTHENTICATED' })
    return user
  },
  async logout() {
    if (!isMockMode) return realApi.logout()
    localStorage.removeItem(mockSessionKey)
    return { ok: true }
  },
  async changePassword(currentPassword: string, newPassword: string) {
    if (!isMockMode) return realApi.changePassword(currentPassword, newPassword)
    return { ok: true }
  },
  async listParticipants(query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.listParticipants(query)
    const db = (await mock()).snapshot()
    const q = String(query.search ?? '').toLowerCase()
    const categoryName = typeof query.category === 'string' ? query.category : CATEGORIES[Number(query.category_id ?? 0) - 1]
    let rows = db.participants.filter((p) =>
      (!q || [p.name, p.bibNumber, p.noc, p.gunNumber].some((value) => value.toLowerCase().includes(q))) &&
      (!query.department || p.department === query.department) &&
      (!query.pouch_status || p.status === query.pouch_status) &&
      (!categoryName || p.category === categoryName))
    const page = Number(query.page ?? 0), limit = Number(query.limit ?? 500)
    const total = rows.length
    rows = rows.slice(page * limit, (page + 1) * limit)
    return { data: rows, total, page, limit }
  },
  async getParticipant(id: string) {
    if (!isMockMode) return realApi.getParticipant(id)
    const db = (await mock()).snapshot()
    const participant = db.participants.find((item) => item.id === id)
    if (!participant) throw new Error('Participant not found.')
    return { participant, transactions: db.transactions.filter((item) => item.participantId === id) }
  },
  async addParticipant(input: Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>) {
    if (!isMockMode) return realApi.addParticipant(input)
    return (await mock()).addParticipant(input)
  },
  async updateParticipant(participant: Participant) {
    if (!isMockMode) return realApi.updateParticipant(participant)
    return (await mock()).updateParticipant(participant)
  },
  async deleteParticipants(ids: string[]) {
    if (!isMockMode) return realApi.deleteParticipants(ids)
    return (await mock()).deleteParticipants(ids)
  },
  async getImportTemplate() {
    if (!isMockMode) return realApi.getImportTemplate()
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([['bib_number', 'noc', 'name', 'department', 'gun_number', 'contact_number', 'category'], ['141', 'IND', 'Example Participant', 'Air Rifle', 'G-241', '+91 98765 43210', 'Senior Men']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Participants')
    XLSX.writeFile(workbook, 'range-participants-template.xlsx')
  },
  async previewImport(file: File) {
    if (!isMockMode) return realApi.previewImport(file)
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const input = sheet ? XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' }) : []
    const valid: Array<Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>> = []
    const errors: Array<{ row: number; values: Record<string, string>; reasons: string[] }> = []
    input.forEach((row, index) => {
      const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]))
      const reasons = ['bib_number', 'noc', 'name', 'gun_number', 'category'].filter((key) => !values[key]).map((key) => `${key} is required`)
      if (reasons.length) errors.push({ row: index + 2, values, reasons })
      else valid.push({
        bibNumber: values.bib_number, noc: values.noc, name: values.name, department: values.department ?? '',
        gunNumber: values.gun_number, contactNumber: values.contact_number ?? '', category: values.category,
      })
    })
    const previewId = crypto.randomUUID()
    previews.set(previewId, { valid, errors })
    return { previewId, valid: valid.map((item) => ({ ...item, bib_number: item.bibNumber, gun_number: item.gunNumber, contact_number: item.contactNumber, category_name: item.category })), errors, total: valid.length + errors.length }
  },
  async commitImport(previewId: string, mode: 'skip' | 'update') {
    if (!isMockMode) return realApi.commitImport(previewId, mode)
    const preview = previews.get(previewId)
    if (!preview) throw new Error('Import preview not found.')
    const db = (await mock()).snapshot()
    const service = await mock()
    let imported = 0, updated = 0, rejected = 0
    for (const row of preview.valid) {
      const existing = db.participants.find((item) => item.bibNumber.toLowerCase() === row.bibNumber.toLowerCase())
      if (existing && mode === 'skip') { rejected++; continue }
      if (existing) { service.updateParticipant({ ...existing, ...row }); updated++ }
      else { service.addParticipant(row); imported++ }
    }
    previews.delete(previewId)
    return { imported, updated, rejected }
  },
  async downloadImportErrors(previewId: string) {
    if (!isMockMode) return realApi.downloadImportErrors(previewId)
    const preview = previews.get(previewId)
    if (!preview) throw new Error('Import preview not found.')
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(preview.errors), 'Import errors')
    XLSX.writeFile(workbook, 'participant-import-errors.xlsx')
  },
  async scan(code: string, manual = false, confirm = false) {
    if (!isMockMode) return realApi.scan(code, manual, confirm)
    const service = await mock()
    const snapshot = service.snapshot()
    const participant = snapshot.participants.find((item) => [item.barcodeValue, item.bibNumber, item.gunNumber].some((value) => value.toLowerCase() === code.trim().toLowerCase()))
    const previous = participant && snapshot.transactions.find((item) => item.participantId === participant.id)
    if (participant && previous && !confirm && Date.now() - Date.parse(previous.timestamp) < service.settings().duplicateWindowSeconds * 1000) {
      throw Object.assign(new Error('This pouch was just scanned. Confirm to proceed.'), { status: 409, code: 'DUPLICATE_SCAN' })
    }
    const result = service.scanParticipant(code, localStorage.getItem(mockSessionKey) ?? '')
    if (!result.participant || !result.transaction) throw Object.assign(new Error(result.error ?? 'Participant not found.'), { status: 404, code: 'UNKNOWN_CODE' })
    const p = result.participant, t = result.transaction
    return {
      participant: { id: Number(p.id.replace(/\D/g, '')) || 1, bib_number: p.bibNumber, name: p.name, noc: p.noc, gun_number: p.gunNumber, category_name: p.category, pouch_status: p.status },
      new_status: p.status, transaction_id: Number(t.id.replace(/\D/g, '')) || Date.now(), transaction_time: t.timestamp,
    }
  },
  async scanSummary() {
    if (!isMockMode) return realApi.scanSummary()
    const db = (await mock()).snapshot()
    const out = db.participants.filter((item) => item.status === 'out').length
    return { in: db.participants.length - out, out, total: db.participants.length, printed: 0, unprinted: db.participants.length, stale: 0 }
  },
  async recentScans() {
    if (!isMockMode) return realApi.recentScans()
    return (await mock()).snapshot().transactions.slice(0, 10)
  },
  async listTransactions(query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.listTransactions(query)
    const db = (await mock()).snapshot()
    const page = Number(query.page ?? 0), limit = Number(query.limit ?? 500)
    const rows = db.transactions.slice(page * limit, (page + 1) * limit)
    return { data: rows, total: db.transactions.length, page, limit }
  },
  async listUsers() {
    if (!isMockMode) return realApi.listUsers()
    return (await mock()).snapshot().users
  },
  async saveUser(user: Omit<User, 'id'> & { id?: string }) {
    if (!isMockMode) return realApi.saveUser(user)
    return (await mock()).saveUser(user)
  },
  async resetPassword(id: string, newPassword: string) {
    if (!isMockMode) return realApi.resetPassword(id, newPassword)
    const service = await mock()
    const user = service.snapshot().users.find((item) => item.id === id)
    if (user) service.saveUser({ ...user, password: newPassword })
    return { ok: true }
  },
  async categories() {
    if (!isMockMode) return realApi.categories()
    return (await import('@/types')).CATEGORIES.map((name, index) => ({ id: index + 1, name, active: true }))
  },
  async saveCategory(id: number, name: string, active: boolean) {
    if (!isMockMode) return realApi.saveCategory(id, name, active)
    return { id, name, active }
  },
  async getSettings() {
    if (!isMockMode) return realApi.getSettings()
    return (await mock()).settings()
  },
  async saveSettings(settings: AppSettings) {
    if (!isMockMode) return realApi.saveSettings(settings)
    ;(await mock()).saveSettings(settings)
    return settings
  },
  async activity(query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.activity(query)
    const data = (await mock()).snapshot().activity
    return { data, total: data.length, page: 0, limit: data.length }
  },
  async previewCorrection(input: {
    action: 'edit' | 'void' | 'add'; transactionId?: number; participantId?: number
    newType?: 'in' | 'out'; newTimestamp?: string; reason?: string
  }) {
    if (!isMockMode) return realApi.previewCorrection(input)
    throw new Error('Transaction corrections require the server-backed API.')
  },
  async saveCorrection(input: {
    action: 'edit' | 'void' | 'add'; transactionId?: number; participantId?: number
    newType?: 'in' | 'out'; newTimestamp?: string; reason: string
  }) {
    if (!isMockMode) return realApi.saveCorrection(input)
    throw new Error('Transaction corrections require the server-backed API.')
  },
  async listCorrections(query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.listCorrections(query)
    return { data: [], total: 0, page: 0, limit: 50 }
  },
  async report(name: string, query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.report(name, query)
    const db = (await mock()).snapshot()
    if (name === 'participants') return { data: db.participants.map((row) => ({ ...row })), total: db.participants.length }
    if (name === 'transactions') return { data: db.transactions.map((row) => ({ ...row })), total: db.transactions.length }
    if (name === 'pouches-out') {
      const rows = db.participants.filter((participant) => participant.status === 'out')
      return { data: rows.map((row) => ({ ...row })), total: rows.length }
    }
    if (name === 'user-activity') return { data: db.activity.map((row) => ({ ...row })), total: db.activity.length }
    return { data: [], total: 0 }
  },
  async downloadReport(name: string, query: Record<string, string | number | undefined> = {}) {
    if (!isMockMode) return realApi.downloadReport(name, query)
    throw new Error('Report downloads require the server-backed API.')
  },
  async backupStatus() {
    if (!isMockMode) return realApi.backupStatus()
    return { lastManualBackupAt: null, hoursSinceManualBackup: null, lastAutomaticBackupAt: null, backupFolder: '', allowDemoReset: true }
  },
  async createBackup(destinationPath?: string) {
    if (!isMockMode) return realApi.createBackup(destinationPath)
    return { filename: 'demo-backup.json', createdAt: new Date().toISOString(), destination: 'browser download' }
  },
  async downloadBackup() {
    if (!isMockMode) return realApi.downloadBackup()
    const service = await mock()
    const blob = new Blob([JSON.stringify(service.exportBackup())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'rangeops-demo-backup.json'
    a.click()
    URL.revokeObjectURL(a.href)
  },
  async restoreBackup(file: File, confirmation: string) {
    if (!isMockMode) return realApi.restoreBackup(file, confirmation)
    const content = JSON.parse(await file.text()) as Database
    ;(await mock()).restoreBackup(content)
    return { ok: true, preRestoreBackup: '' }
  },
  async exportAll() {
    if (!isMockMode) return realApi.exportAll()
    throw new Error('Full Excel export requires the server-backed API.')
  },
  async resetDemo() {
    if (!isMockMode) return realApi.resetDemo()
    ;(await mock()).reset()
    return { ok: true }
  },
  async exportBackup() {
    if (!isMockMode) throw new Error('Server-side backup is not available yet.')
    return (await mock()).exportBackup()
  },
  async reset() {
    if (!isMockMode) throw new Error('Server-side demo reset is not available.')
    ;(await mock()).reset()
  },
}

export const printingApi = {
  async getPrinters(): Promise<PrinterSettingsResponse> {
    if (!isMockMode) return (await import('./printingApi')).printingApi.getPrinters()
    return { printers: [{ name: 'Demo Printer', status: 0 }], configuredPrinter: 'Demo Printer', driver: 'file' }
  },
  async printTestLabel() {
    if (!isMockMode) return (await import('./printingApi')).printingApi.printTestLabel()
    return { ok: true, jobId: 1, driver: 'file', printerName: 'Demo Printer' }
  },
  async printLabels(_payload: PrintLabelsPayload): Promise<PrintResultResponse> {
    if (!isMockMode) return (await import('./printingApi')).printingApi.printLabels(_payload)
    return { jobId: Date.now(), count: _payload.selection.type === 'ids' ? _payload.selection.ids.length : 1, status: 'sent', driver: 'file' }
  },
  async getPreview(id: number | string): Promise<LabelPreviewData> {
    if (!isMockMode) return (await import('./printingApi')).printingApi.getPreview(id)
    const participant = (await mock()).snapshot().participants.find((item) => item.id === String(id))
    if (!participant) throw new Error('Participant not found.')
    return { participant: { id: Number(id), bib_number: participant.bibNumber, noc: participant.noc, name: participant.name, gun_number: participant.gunNumber, label_printed: false, label_stale: false }, layout: {} as LabelPreviewData['layout'] }
  },
  async getSummary(): Promise<LabelSummary> {
    if (!isMockMode) return (await import('./printingApi')).printingApi.getSummary()
    const count = (await mock()).snapshot().participants.length
    return { total: count, printed: 0, unprinted: count, stale: 0 }
  },
  async getJobs() {
    if (!isMockMode) return (await import('./printingApi')).printingApi.getJobs()
    return []
  },
}
