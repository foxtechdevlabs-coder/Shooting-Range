import { createSeedDatabase } from './mockData'
import type { AppSettings, Database, Participant, Transaction, TransactionType, User } from '@/types'

const STORAGE_KEY = 'range-management-db-v1'
const readDatabase = (): Database => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...createSeedDatabase(), ...JSON.parse(stored) as Partial<Database> }
  } catch (error) {
    console.error('Could not read local range data.', error)
  }
  const initial = createSeedDatabase()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
  return initial
}
let database = readDatabase()
const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
const id = (prefix: string) => `${prefix}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export const api = {
  snapshot: (): Database => structuredClone(database),
  subscribe: (listener: (data: Database) => void) => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        database = JSON.parse(event.newValue) as Database
        listener(api.snapshot())
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  },
  authenticate: (username: string, password: string): User | undefined =>
    database.users.find((user) => user.active && user.username.toLowerCase() === username.toLowerCase() && user.password === password),
  addActivity: (userId: string, action: string, entity: string, details: string) => {
    database.activity.unshift({ id: id('a'), userId, action, entity, details, timestamp: new Date().toISOString() })
    persist()
  },
  addParticipant: (input: Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'> & Partial<Pick<Participant, 'status'>>, userId = 'current') => {
    if (database.participants.some((p) => p.bibNumber.toLowerCase() === input.bibNumber.toLowerCase())) throw new Error('Bib number already exists.')
    if (database.participants.some((p) => p.gunNumber.toLowerCase() === input.gunNumber.toLowerCase())) throw new Error('Gun number already exists.')
    const participant: Participant = { ...input, id: id('p'), barcodeValue: `SR${input.bibNumber}`, status: input.status ?? 'in', createdAt: new Date().toISOString() }
    database.participants.unshift(participant)
    api.addActivity(userId, 'Added participant', 'Participant', `Bib ${participant.bibNumber} · ${participant.name}`)
    persist()
    return participant
  },
  updateParticipant: (participant: Participant, userId = 'current') => {
    if (database.participants.some((p) => p.id !== participant.id && p.bibNumber.toLowerCase() === participant.bibNumber.toLowerCase())) throw new Error('Bib number already exists.')
    if (database.participants.some((p) => p.id !== participant.id && p.gunNumber.toLowerCase() === participant.gunNumber.toLowerCase())) throw new Error('Gun number already exists.')
    const existing = database.participants.find((p) => p.id === participant.id)
    const gunChanged = existing && existing.gunNumber.toLowerCase() !== participant.gunNumber.toLowerCase()
    const updatedRecord = {
      ...participant,
      labelPrinted: gunChanged ? false : (participant.labelPrinted ?? existing?.labelPrinted ?? false),
      labelStale: gunChanged ? true : (participant.labelStale ?? existing?.labelStale ?? false),
    }
    database.participants = database.participants.map((p) => p.id === participant.id ? updatedRecord : p)
    api.addActivity(userId, 'Updated participant', 'Participant', `Bib ${participant.bibNumber} · ${participant.name}`)
    persist()
    return updatedRecord
  },
  deleteParticipants: (ids: string[], userId = 'current') => {
    const removed = database.participants.filter((p) => ids.includes(p.id))
    database.participants = database.participants.filter((p) => !ids.includes(p.id))
    removed.forEach((p) => api.addActivity(userId, 'Deleted participant', 'Participant', `Bib ${p.bibNumber} · ${p.name}`))
    persist()
  },
  importParticipants: (inputs: Array<Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>>, userId = 'current') => {
    const bibNumbers = new Set(database.participants.map((p) => p.bibNumber.toLowerCase()))
    const gunNumbers = new Set(database.participants.map((p) => p.gunNumber.toLowerCase()))
    for (const input of inputs) {
      const bib = input.bibNumber.toLowerCase()
      const gun = input.gunNumber.toLowerCase()
      if (bibNumbers.has(bib)) throw new Error(`Bib number ${input.bibNumber} is already assigned.`)
      if (gunNumbers.has(gun)) throw new Error(`Gun number ${input.gunNumber} is already assigned.`)
      bibNumbers.add(bib)
      gunNumbers.add(gun)
    }
    const added = inputs.map((input) => ({
      ...input,
      id: id('p'),
      barcodeValue: `SR${input.bibNumber}`,
      status: 'in' as const,
      createdAt: new Date().toISOString(),
    }))
    database.participants = [...added, ...database.participants]
    added.forEach((participant) => api.addActivity(userId, 'Added participant', 'Participant', `Bib ${participant.bibNumber} · ${participant.name}`))
    persist()
    return added
  },
  scanParticipant: (barcode: string, userId: string): { participant?: Participant; transaction?: Transaction; error?: string } => {
    const participant = database.participants.find((p) => [p.barcodeValue, p.bibNumber, p.gunNumber].some((v) => v.toLowerCase() === barcode.trim().toLowerCase()))
    if (!participant) return { error: `No participant found for “${barcode}”.` }
    const type: TransactionType = participant.status === 'in' ? 'check-out' : 'check-in'
    participant.status = type === 'check-in' ? 'in' : 'out'
    const transaction: Transaction = { id: id('t'), participantId: participant.id, type, timestamp: new Date().toISOString(), performedBy: userId, status: 'valid' }
    database.transactions.unshift(transaction)
    api.addActivity(userId, type === 'check-in' ? 'Checked in' : 'Checked out', 'Participant', `Bib ${participant.bibNumber} · ${participant.name}`)
    persist()
    return { participant: { ...participant }, transaction }
  },
  correctTransaction: (transactionId: string, type: TransactionType | 'voided', reason: string, userId: string) => {
    const transaction = database.transactions.find((t) => t.id === transactionId)
    if (!transaction) throw new Error('Transaction not found.')
    if (transaction.status !== 'valid') throw new Error('Only valid transactions can be corrected.')
    const originalType = transaction.type
    transaction.originalType = originalType
    transaction.status = type === 'voided' ? 'voided' : 'corrected'
    if (type !== 'voided') transaction.type = type
    transaction.correctionReason = reason
    transaction.correctedBy = userId
    transaction.correctedAt = new Date().toISOString()
    const participant = database.participants.find((p) => p.id === transaction.participantId)
    if (participant) participant.status = type === 'voided' ? participant.status : type === 'check-in' ? 'in' : 'out'
    api.addActivity(userId, 'Corrected transaction', 'Transaction', `${transactionId}: ${originalType} → ${type}; ${reason}`)
    persist()
  },
  saveUser: (user: Omit<User, 'id'> & { id?: string }, actorId = 'current') => {
    if (database.users.some((u) => u.username.toLowerCase() === user.username.toLowerCase() && u.id !== user.id)) throw new Error('Username already exists.')
    const saved: User = { ...user, id: user.id ?? id('u') }
    database.users = user.id ? database.users.map((u) => u.id === user.id ? saved : u) : [...database.users, saved]
    api.addActivity(actorId, user.id ? 'Updated user' : 'Added user', 'User', saved.username)
    persist()
    return saved
  },
  settings: (): AppSettings => ({ ...database.settings }),
  saveSettings: (settings: AppSettings, userId = 'current') => {
    database.settings = settings
    api.addActivity(userId, 'Updated settings', 'Settings', 'Event and scan station settings updated')
    persist()
  },
  exportBackup: () => JSON.stringify(database, null, 2),
  restoreBackup: (data: Database) => {
    if (!data || !Array.isArray(data.participants) || !Array.isArray(data.users) || !Array.isArray(data.transactions) || !Array.isArray(data.activity) || !data.settings) throw new Error('This file is not a valid range-management backup.')
    database = data
    persist()
  },
  reset: () => { database = createSeedDatabase(); persist() },
}
