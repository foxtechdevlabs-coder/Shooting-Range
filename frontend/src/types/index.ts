export type Permission =
  | 'participants.view' | 'participants.create' | 'participants.edit' | 'participants.delete'
  | 'import.use' | 'barcodes.print' | 'scan.use' | 'transactions.view' | 'transactions.correct'
  | 'reports.view' | 'reports.export' | 'users.manage' | 'settings.manage'

export type Role = 'admin' | 'staff'
export type ParticipantStatus = 'in' | 'out'
export type TransactionType = 'check-in' | 'check-out'
export type TransactionStatus = 'valid' | 'corrected' | 'voided'

export interface Participant {
  id: string
  bibNumber: string
  noc: string
  name: string
  department: string
  gunNumber: string
  contactNumber: string
  category: string
  barcodeValue: string
  status: ParticipantStatus
  labelPrinted?: boolean
  labelStale?: boolean
  labelPrintedAt?: string | null
  createdAt: string
}

export interface Transaction {
  id: string
  participantId: string
  type: TransactionType
  timestamp: string
  performedBy: string
  status: TransactionStatus
  correctionReason?: string
  correctedBy?: string
  correctedAt?: string
  originalType?: TransactionType
}

export interface User {
  id: string
  name: string
  username: string
  password: string
  role: Role
  permissions: Permission[]
  active: boolean
  lastLogin?: string
}

export interface ActivityLog {
  id: string
  userId: string
  action: string
  entity: string
  details: string
  timestamp: string
}

export interface AppSettings {
  eventName: string
  logoText: string
  labelSize: 'small' | 'medium' | 'large'
  scanSound: boolean
  duplicateWindowSeconds: number
  printerName?: string
  labelWidthMm?: number
  labelHeightMm?: number
  labelDpi?: number
  labelDarkness?: number
  labelSpeed?: number
  labelOffsetX?: number
  labelOffsetY?: number
  labelShowEventName?: boolean
  labelMediaTracking?: 'none' | 'gap'
  printDriver?: 'windows' | 'file'
}


export interface Database {
  participants: Participant[]
  transactions: Transaction[]
  users: User[]
  activity: ActivityLog[]
  settings: AppSettings
}

export const ALL_PERMISSIONS: Permission[] = [
  'participants.view', 'participants.create', 'participants.edit', 'participants.delete',
  'import.use', 'barcodes.print', 'scan.use', 'transactions.view', 'transactions.correct',
  'reports.view', 'reports.export', 'users.manage', 'settings.manage',
]

export const PERMISSION_LABELS: Record<Permission, string> = {
  'participants.view': 'View participants', 'participants.create': 'Add participants',
  'participants.edit': 'Edit participants', 'participants.delete': 'Delete participants',
  'import.use': 'Import participants', 'barcodes.print': 'Print barcodes', 'scan.use': 'Use scan station',
  'transactions.view': 'View transactions', 'transactions.correct': 'Correct transactions',
  'reports.view': 'View reports', 'reports.export': 'Export reports', 'users.manage': 'Manage users',
  'settings.manage': 'Manage settings',
}

export const CATEGORIES = ['Senior Men', 'Senior Women', 'Junior Men', 'Junior Women', 'Youth']
export const DEPARTMENTS = ['Air Rifle', 'Air Pistol', 'Smallbore Rifle', 'Pistol', 'Trap & Skeet']
