import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, FileClock, Plus, Search, ShieldAlert, SquarePen } from 'lucide-react'
import { Button, Field, Modal, PageHeading } from '@/components/ui'
import { api } from '@/services'
import { formatDateTime } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { Participant, Transaction, TransactionType } from '@/types'
import { useRangeData } from '@/hooks/useRangeData'

type CorrectionAction = 'edit' | 'void' | 'add'
type CorrectionPreview = Awaited<ReturnType<typeof api.previewCorrection>>

function localDateTimeValue(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TransactionsPage() {
  const { participants, users } = useRangeData()
  const { notify, can } = useAppStore()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<'created_at' | 'participant_name' | 'gun_number' | 'type' | 'user_name'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [correcting, setCorrecting] = useState<Transaction | null>(null)
  const [action, setAction] = useState<CorrectionAction>('edit')
  const [correctType, setCorrectType] = useState<TransactionType>('check-in')
  const [correctTime, setCorrectTime] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<CorrectionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtered, setFiltered] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const hasListLoaded = useRef(false)
  const [participantSearch, setParticipantSearch] = useState('')
  const [participantOptions, setParticipantOptions] = useState<Participant[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (action !== 'add') return
    let active = true
    const timer = window.setTimeout(() => {
      void api.listParticipants({ search: participantSearch, limit: 20 }).then((result) => {
        if (!active) return
        setParticipantOptions(result.data)
        if (!participantId && result.data[0]) setParticipantId(result.data[0].id)
      }).catch((error) => {
        if (active) notify(error instanceof Error ? error.message : 'Could not search participants.')
      })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [action, participantSearch, participantId, notify])

  const load = useCallback(async () => {
    if (!hasListLoaded.current) setListLoading(true)
    try {
      const result = await api.listTransactions({
        search: debouncedSearch, type: type === 'check-in' ? 'in' : type === 'check-out' ? 'out' : undefined,
        status: status || undefined, user_id: user || undefined, from: from || undefined,
        to: to || undefined, page, limit: pageSize, sort, order: sortOrder,
      })
      setFiltered(result.data)
      setTotal(result.total)
      setListError('')
      hasListLoaded.current = true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load transactions.'
      setListError(message)
      notify(message)
    } finally { setListLoading(false) }
  }, [debouncedSearch, type, status, user, from, to, page, pageSize, sort, sortOrder, notify])

  useEffect(() => {
    void load()
    window.addEventListener('rangeops:refresh', load)
    return () => window.removeEventListener('rangeops:refresh', load)
  }, [load])

  const beginCorrection = (transaction: Transaction) => {
    setCorrecting(transaction)
    setAction('edit')
    setCorrectType(transaction.type)
    setCorrectTime(localDateTimeValue(transaction.timestamp))
    setParticipantId(transaction.participantId)
    setReason('')
    setPreview(null)
  }
  const beginAdd = () => {
    setCorrecting(null)
    setAction('add')
    setCorrectType('check-out')
    setCorrectTime(localDateTimeValue(new Date().toISOString()))
    setParticipantId('')
    setParticipantSearch('')
    setParticipantOptions([])
    setReason('')
    setPreview(null)
  }
  const closeCorrection = () => {
    setCorrecting(null)
    setPreview(null)
    setReason('')
  }
  const correctionInput = () => ({
    action,
    ...(action !== 'add' && correcting ? { transactionId: Number(correcting.id) } : {}),
    ...(action === 'add' ? { participantId: Number(participantId) } : {}),
    ...(action !== 'void' ? { newType: correctType === 'check-in' ? 'in' as const : 'out' as const } : {}),
    ...(correctTime ? { newTimestamp: new Date(correctTime).toISOString() } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  })
  const getPreview = async () => {
    setPreviewLoading(true)
    try {
      const result = await api.previewCorrection(correctionInput())
      setPreview(result)
      if (result.validationErrors.length) notify(result.validationErrors[0])
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not preview correction.') }
    finally { setPreviewLoading(false) }
  }
  const saveCorrection = async () => {
    if (!reason.trim()) { notify('A reason of at least 3 characters is required.'); return }
    setSaving(true)
    try {
      const input = correctionInput()
      await api.saveCorrection({ ...input, reason: reason.trim() })
      notify('Correction recorded in the audit trail.')
      closeCorrection()
      window.dispatchEvent(new Event('rangeops:refresh'))
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save correction.') }
    finally { setSaving(false) }
  }

  if (listLoading && !hasListLoaded.current) return <div className="page data-skeleton" role="status" aria-label="Loading transactions"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading transactions…</span></div>
  const participantFor = (transaction: Transaction) => participants.find((item) => item.id === transaction.participantId)
  const changeSort = (key: typeof sort) => {
    if (sort === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setSortOrder('asc') }
    setPage(0)
  }
  return <div className="page">
    <PageHeading eyebrow="AUDIT TRAIL" title="Transactions" description="A complete, auditable log of firearm check-ins and check-outs." actions={<>{can('transactions.correct') && <Button variant="outline" onClick={beginAdd}><Plus size={15} /> Add missed transaction</Button>}<span className="transaction-total"><FileClock size={16} />{total} records</span></>} />
    <section className="panel table-panel"><div className="table-toolbar"><div className="toolbar-left"><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Search participant or gun..." aria-label="Search transactions" /></div><select className="filter-select" value={type} onChange={(e) => { setType(e.target.value); setPage(0) }} aria-label="Filter type"><option value="">All movements</option><option value="check-in">Check-in</option><option value="check-out">Check-out</option></select><select className="filter-select" value={user} onChange={(e) => { setUser(e.target.value); setPage(0) }} aria-label="Filter staff"><option value="">All staff</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><select className="filter-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label="Filter audit status"><option value="">All records</option><option value="valid">Valid</option><option value="corrected">Corrected</option><option value="voided">Voided</option></select></div><div className="toolbar-right date-range-filters"><label><CalendarDays size={14} /><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} aria-label="From date" /></label><span>to</span><label><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} aria-label="To date" /></label></div></div>
      {listError && <div className="login-error" role="alert">Could not load transactions: {listError}</div>}
      <div className="table-scroll"><table className="data-table transaction-table"><thead><tr><th><button className="sort-header" onClick={() => changeSort('participant_name')}>Participant <span>↕</span></button></th><th><button className="sort-header" onClick={() => changeSort('type')}>Movement <span>↕</span></button></th><th><button className="sort-header" onClick={() => changeSort('gun_number')}>Gun no. <span>↕</span></button></th><th><button className="sort-header" onClick={() => changeSort('created_at')}>Date &amp; time <span>↕</span></button></th><th><button className="sort-header" onClick={() => changeSort('user_name')}>Performed by <span>↕</span></button></th><th>Record status</th><th>Audit trail</th><th /></tr></thead><tbody>{filtered.map((transaction) => { const participant = participantFor(transaction); const actor = users.find((item) => item.id === transaction.performedBy); return <tr key={transaction.id}><td><div className="transaction-person"><span className="table-avatar">{(participant?.name ?? transaction.participantName)?.split(' ').map((value) => value[0]).slice(0, 2).join('') ?? '?'}</span><div><b>{participant?.name ?? transaction.participantName ?? 'Participant removed'}</b><small>Bib {participant?.bibNumber ?? transaction.participantBib ?? '—'} · {participant?.noc ?? transaction.participantNoc ?? '—'}</small></div></div></td><td><span className={`movement ${transaction.type === 'check-in' ? 'movement-in' : 'movement-out'}`}>{transaction.type === 'check-in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{transaction.type === 'check-in' ? 'Check-in' : 'Check-out'}</span></td><td className="mono">{participant?.gunNumber ?? transaction.gunNumber ?? '—'}</td><td>{formatDateTime(transaction.timestamp)}</td><td>{actor?.name ?? transaction.performerName ?? '—'}</td><td><span className={`audit-badge audit-${transaction.status}`}>{transaction.status}</span></td><td>{transaction.status !== 'valid' ? <button className="audit-detail" onClick={() => setCorrecting(transaction)}><ShieldAlert size={14} />View audit</button> : <span className="muted-dash">—</span>}</td><td>{can('transactions.correct') && transaction.status !== 'voided' && <button className="row-icon-button" aria-label="Correct transaction" title="Correct transaction" onClick={() => beginCorrection(transaction)}><SquarePen size={15} /></button>}</td></tr> })}{filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state"><FileClock size={24} /><b>No transactions found</b><span>Try changing your filters.</span></div></td></tr>}</tbody></table></div>
      <footer className="table-footer"><span>Showing <b>{total ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, total)}</b> of <b>{total}</b> transactions</span><div className="pagination"><label>Rows <select className="filter-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0) }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button className="button button-outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}><ChevronLeft size={15} /> Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}</span><button className="button button-outline" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(page + 1)}>Next <ChevronRight size={15} /></button></div></footer>
    </section>
    {correcting && correcting.status !== 'valid' && !preview ? <Modal title="Transaction audit trail" onClose={closeCorrection} footer={<Button variant="secondary" onClick={closeCorrection}>Close</Button>}><div className="audit-trail"><div><small>Original movement</small><b>{correcting.originalType ?? correcting.type}</b></div><span className="audit-arrow">→</span><div><small>Current record</small><b>{correcting.status === 'voided' ? 'Voided' : correcting.type}</b></div><div><small>Reason</small><b>{correcting.correctionReason}</b></div><div><small>Corrected by</small><b>{users.find((item) => item.id === correcting.correctedBy)?.name ?? '—'}</b></div><div><small>Corrected at</small><b>{correcting.correctedAt ? formatDateTime(correcting.correctedAt) : '—'}</b></div></div></Modal> : (correcting || action === 'add') && <Modal title={preview ? 'Confirm correction' : action === 'add' ? 'Add missed transaction' : action === 'void' ? 'Void transaction' : 'Correct transaction'} onClose={closeCorrection} wide footer={preview ? <><Button variant="secondary" onClick={() => setPreview(null)}>Back</Button><Button variant="primary" disabled={saving || preview.validationErrors.length > 0 || reason.trim().length < 3} onClick={() => void saveCorrection()}>{saving ? 'Saving…' : 'Confirm and save'}</Button></> : <><Button variant="secondary" onClick={closeCorrection}>Cancel</Button><Button variant="primary" disabled={previewLoading || reason.trim().length < 3 || (action === 'add' && !participantId)} onClick={() => void getPreview()}>{previewLoading ? 'Checking sequence…' : 'Preview correction'}</Button></>}>
      {preview ? <div className="correction-preview"><div className="correction-notice"><ShieldAlert size={17} /><span>Review the resulting transaction sequence before saving. Corrections are permanent and audited.</span></div><div className="audit-trail"><div><small>Old values</small><b>{JSON.stringify(preview.oldValues ?? 'New transaction')}</b></div><span className="audit-arrow">→</span><div><small>New values</small><b>{JSON.stringify(preview.newValues)}</b></div><div><small>Resulting pouch status</small><b>{preview.pouchStatus}</b></div></div>{preview.validationErrors.length > 0 && <div className="login-error" role="alert">{preview.validationErrors.join(' ')}</div>}<h3>Resulting sequence</h3><ol>{preview.sequence.map((row, index) => <li key={`${row.id}-${index}`}>{row.type} · {formatDateTime(row.timestamp)} · {row.status}</li>)}</ol><p><b>Reason:</b> {reason}</p></div> : <><div className="correction-notice"><ShieldAlert size={17} /><span>Corrections never change the original audit record.</span></div>{action === 'add' ? <Field label="Participant"><input value={participantSearch} onChange={(event) => { setParticipantSearch(event.target.value); setParticipantId('') }} placeholder="Search name, bib or gun number" /><select value={participantId} onChange={(event) => setParticipantId(event.target.value)} required><option value="">Choose participant</option>{participantOptions.map((participant) => <option key={participant.id} value={participant.id}>{participant.bibNumber} · {participant.name} · {participant.gunNumber}</option>)}</select></Field> : <Field label="Correction action"><select value={action} onChange={(event) => { setAction(event.target.value as CorrectionAction); setPreview(null) }}><option value="edit">Edit movement or time</option><option value="void">Void this transaction</option></select></Field>}{action !== 'void' && <><Field label="Movement"><select value={correctType} onChange={(event) => setCorrectType(event.target.value as TransactionType)}><option value="check-out">Check-out</option><option value="check-in">Check-in</option></select></Field><Field label="Effective date and time"><input type="datetime-local" value={correctTime} onChange={(event) => setCorrectTime(event.target.value)} required /></Field></>}<Field label="Reason for correction"><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} placeholder="Explain why this record is being corrected..." required /></Field>{action === 'add' && participantOptions.find((participant) => participant.id === participantId) && <small>Gun: {participantOptions.find((participant) => participant.id === participantId)?.gunNumber}</small>}</>}
    </Modal>}
  </div>
}
