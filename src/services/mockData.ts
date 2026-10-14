import type { ActivityLog, Database, Participant, Permission, User } from '@/types'

const names = [
  'Aarav Sharma', 'Ananya Patel', 'Vivaan Kumar', 'Diya Nair', 'Arjun Singh', 'Meera Reddy',
  'Ishaan Gupta', 'Saanvi Rao', 'Aditya Joshi', 'Aditi Verma', 'Kabir Menon', 'Ira Desai',
  'Reyansh Das', 'Myra Iyer', 'Krishna Shah', 'Kiara Pillai', 'Rohan Mehta', 'Pari Khanna',
  'Atharv Kulkarni', 'Tara Bose', 'Dhruv Bhat', 'Navya Sethi', 'Kian Fernandes', 'Siya Chawla',
  'Siddharth Roy', 'Anika Ghosh', 'Veer Malhotra', 'Avni Kapoor', 'Neil Thomas', 'Riya Banerjee',
  'Arnav Mishra', 'Ishita Sen', 'Samarth Rao', 'Mira Dutta', 'Yash Thakur', 'Nisha Mathew',
  'Devika Nair', 'Om Prakash', 'Zoya Khan', 'Rahul Shetty',
]
const nocs = ['IND', 'IND', 'IND', 'IND', 'NEP', 'SRI', 'BAN', 'IND']
const departments = ['Air Rifle', 'Air Pistol', 'Smallbore Rifle', 'Pistol', 'Trap & Skeet']
const categories = ['Senior Men', 'Senior Women', 'Junior Men', 'Junior Women', 'Youth']

const makeParticipants = (): Participant[] => names.map((name, i) => ({
  id: `p-${String(i + 1).padStart(3, '0')}`,
  bibNumber: String(101 + i),
  noc: nocs[i % nocs.length],
  name,
  department: departments[i % departments.length],
  gunNumber: `G-${String(201 + i).padStart(3, '0')}`,
  contactNumber: `+91 98${String(10000000 + i * 17391).slice(0, 8)}`,
  category: categories[i % categories.length],
  barcodeValue: `SR${String(101 + i).padStart(5, '0')}`,
  status: i % 3 === 0 ? 'out' : 'in',
  createdAt: new Date(Date.now() - (40 - i) * 86400000).toISOString(),
}))

const adminPermissions: Permission[] = [
  'participants.view', 'participants.create', 'participants.edit', 'participants.delete',
  'import.use', 'barcodes.print', 'scan.use', 'transactions.view', 'transactions.correct',
  'reports.view', 'reports.export', 'users.manage', 'settings.manage',
]
const staffPermissions: Permission[] = [
  'participants.view', 'participants.create', 'participants.edit', 'import.use',
  'barcodes.print', 'scan.use', 'transactions.view', 'reports.view', 'reports.export',
]

const makeUsers = (): User[] => [
  { id: 'u-admin', name: 'Alex Morgan', username: 'admin', password: 'admin123', role: 'admin', permissions: adminPermissions, active: true, lastLogin: new Date().toISOString() },
  { id: 'u-staff', name: 'Jordan Lee', username: 'staff', password: 'staff123', role: 'staff', permissions: staffPermissions, active: true, lastLogin: new Date(Date.now() - 3600000).toISOString() },
  { id: 'u-range', name: 'Sam Taylor', username: 'sam', password: 'staff123', role: 'staff', permissions: ['scan.use', 'transactions.view'], active: true },
]

const makeActivity = (): ActivityLog[] => [
  { id: 'a-1', userId: 'u-admin', action: 'Signed in', entity: 'Session', details: 'Admin signed in', timestamp: new Date(Date.now() - 1800000).toISOString() },
  { id: 'a-2', userId: 'u-staff', action: 'Checked in', entity: 'Participant', details: 'Bib 101 · Aarav Sharma', timestamp: new Date(Date.now() - 3600000).toISOString() },
  { id: 'a-3', userId: 'u-admin', action: 'Added participant', entity: 'Participant', details: 'Bib 138 · Devika Nair', timestamp: new Date(Date.now() - 7200000).toISOString() },
]

export const createSeedDatabase = (): Database => {
  const participants = makeParticipants()
  const now = Date.now()
  const transactions = participants.slice(0, 14).map((p, i) => ({
    id: `t-${i + 1}`,
    participantId: p.id,
    type: i % 2 === 0 ? 'check-in' as const : 'check-out' as const,
    timestamp: new Date(now - (i + 1) * 3600000).toISOString(),
    performedBy: i % 2 === 0 ? 'u-admin' : 'u-staff',
    status: 'valid' as const,
  }))
  return {
    participants,
    transactions,
    users: makeUsers(),
    activity: makeActivity(),
    settings: { eventName: 'National Shooting Championship 2026', logoText: 'NSC', labelSize: 'medium', scanSound: true, duplicateWindowSeconds: 3 },
  }
}
