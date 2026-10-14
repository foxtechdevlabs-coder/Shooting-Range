import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, FileClock, Search, ShieldAlert, SquarePen } from 'lucide-react'
import { Button, Field, Modal, PageHeading } from '@/components/ui'
import { api } from '@/services/api'
import { formatDateTime } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { Transaction, TransactionType } from '@/types'

export function TransactionsPage() {
  const { transactions, participants, users, refresh, notify, can } = useAppStore()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [correcting, setCorrecting] = useState<Transaction | null>(null)
  const [correctType, setCorrectType] = useState<TransactionType | 'voided'>('check-in')
  const [reason, setReason] = useState('')
  const filtered = useMemo(() => transactions.filter((t) => {
    const p = participants.find((item) => item.id === t.participantId)
    const query = search.toLowerCase()
    return (!query || [p?.name, p?.bibNumber, p?.gunNumber, t.id].some((v) => v?.toLowerCase().includes(query)))
      && (!type || t.type === type) && (!status || t.status === status) && (!user || t.performedBy === user)
      && (!from || new Date(t.timestamp) >= new Date(`${from}T00:00:00`)) && (!to || new Date(t.timestamp) <= new Date(`${to}T23:59:59`))
  }), [transactions, participants, search, type, status, user, from, to])
  const pageSize = 12
  const correct = () => {
    if (!correcting || !reason.trim()) return
    api.correctTransaction(correcting.id, correctType, reason.trim(), useAppStore.getState().currentUser?.id ?? '')
    refresh(); notify('Transaction correction recorded'); setCorrecting(null); setReason('')
  }
  return <div className="page">
    <PageHeading eyebrow="AUDIT TRAIL" title="Transactions" description="A complete, auditable log of firearm check-ins and check-outs." actions={<span className="transaction-total"><FileClock size={16} />{transactions.length} records</span>} />
    <section className="panel table-panel"><div className="table-toolbar"><div className="toolbar-left"><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Search participant or gun..." aria-label="Search transactions" /></div><select className="filter-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter type"><option value="">All movements</option><option value="check-in">Check-in</option><option value="check-out">Check-out</option></select><select className="filter-select" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Filter staff">{<option value="">All staff</option>}{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter audit status"><option value="">All records</option><option value="valid">Valid</option><option value="corrected">Corrected</option><option value="voided">Voided</option></select></div><div className="toolbar-right date-range-filters"><label><CalendarDays size={14} /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label><span>to</span><label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label></div></div>
      <div className="table-scroll"><table className="data-table transaction-table"><thead><tr><th>Participant</th><th>Movement</th><th>Gun no.</th><th>Date & time</th><th>Performed by</th><th>Record status</th><th>Audit trail</th><th /></tr></thead><tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map((t) => { const p = participants.find((item) => item.id === t.participantId); const actor = users.find((u) => u.id === t.performedBy); return <tr key={t.id}><td><div className="transaction-person"><span className="table-avatar">{p?.name.split(' ').map((v) => v[0]).slice(0, 2).join('') ?? '?'}</span><div><b>{p?.name ?? 'Participant removed'}</b><small>Bib {p?.bibNumber ?? '—'} · {p?.noc ?? '—'}</small></div></div></td><td><span className={`movement ${t.type === 'check-in' ? 'movement-in' : 'movement-out'}`}>{t.type === 'check-in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{t.type === 'check-in' ? 'Check-in' : 'Check-out'}</span></td><td className="mono">{p?.gunNumber ?? '—'}</td><td>{formatDateTime(t.timestamp)}</td><td>{actor?.name ?? '—'}</td><td><span className={`audit-badge audit-${t.status}`}>{t.status}</span></td><td>{t.status !== 'valid' ? <button className="audit-detail" onClick={() => setCorrecting(t)}><ShieldAlert size={14} />View audit</button> : <span className="muted-dash">—</span>}</td><td>{can('transactions.correct') && t.status === 'valid' && <button className="row-icon-button" aria-label="Correct transaction" title="Correct transaction" onClick={() => { setCorrecting(t); setCorrectType(t.type) }}><SquarePen size={15} /></button>}</td></tr> })}{filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state"><FileClock size={24} /><b>No transactions found</b><span>Try changing your filters.</span></div></td></tr>}</tbody></table></div>
      <footer className="table-footer"><span>Showing <b>{filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)}</b> of <b>{filtered.length}</b> transactions</span><div className="pagination"><button className="button button-outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}><ChevronLeft size={15} /> Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / pageSize))}</span><button className="button button-outline" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}>Next <ChevronRight size={15} /></button></div></footer>
    </section>
    {correcting && <Modal title={correcting.status === 'valid' ? 'Correct transaction' : 'Transaction audit trail'} onClose={() => setCorrecting(null)} footer={correcting.status === 'valid' ? <><Button variant="secondary" onClick={() => setCorrecting(null)}>Cancel</Button><Button variant="primary" disabled={!reason.trim()} onClick={correct}>Save correction</Button></> : <Button variant="secondary" onClick={() => setCorrecting(null)}>Close</Button>}>
      {correcting.status === 'valid' ? <><div className="correction-notice"><ShieldAlert size={17} /><span>Corrections are recorded permanently in the audit trail.</span></div><Field label="Correct movement"><select value={correctType} onChange={(e) => setCorrectType(e.target.value as TransactionType | 'voided')}><option value="check-in">Check-in</option><option value="check-out">Check-out</option><option value="voided">Void this transaction</option></select></Field><Field label="Reason for correction"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this record is being corrected..." required /></Field></> : <div className="audit-trail"><div><small>Original movement</small><b>{correcting.originalType ?? correcting.type}</b></div><span className="audit-arrow">→</span><div><small>Corrected record</small><b>{correcting.status === 'voided' ? 'Voided' : correcting.type}</b></div><div><small>Reason</small><b>{correcting.correctionReason}</b></div><div><small>Corrected by</small><b>{users.find((u) => u.id === correcting.correctedBy)?.name ?? '—'}</b></div><div><small>Corrected at</small><b>{correcting.correctedAt ? new Date(correcting.correctedAt).toLocaleString() : '—'}</b></div></div>}
    </Modal>}
  </div>
}
