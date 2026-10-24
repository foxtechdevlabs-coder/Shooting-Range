import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { flexRender } from '@tanstack/react-table/flex-render'
import { getCoreRowModel, getSortedRowModel, legacyCreateColumnHelper, useLegacyTable } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/table-core'
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Plus, Printer, Search, Trash2, Upload, UserRoundPen } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Modal, PageHeading, StatusPill } from '@/components/ui'
import { Can } from '@/features/permissions/Can'
import { api } from '@/services'
import type { ApiError } from '@/lib/api'
import { useRangeData } from '@/hooks/useRangeData'
import { useAppStore } from '@/store/useAppStore'
import { CATEGORIES, DEPARTMENTS, type Participant } from '@/types'

const schema = z.object({
  bibNumber: z.string().trim().min(1, 'Bib number is required.'),
  noc: z.string().trim().min(2, 'Enter a NOC code.').max(3, 'Use a 2–3 letter NOC code.'),
  name: z.string().trim().min(2, 'Name must contain at least 2 characters.'),
  department: z.string().min(1, 'Choose a department.'),
  gunNumber: z.string().trim().min(1, 'Gun number is required.'),
  contactNumber: z.string().trim().min(5, 'Enter a valid contact number.'),
  category: z.string().min(1, 'Choose a category.'),
})
type FormValues = z.infer<typeof schema>

function LabelBadge({ participant }: { participant: Participant }) {
  if (participant.labelStale) {
    return (
      <span className="status-pill" style={{ background: 'var(--amber-3, #fef3c7)', color: 'var(--amber-11, #92400e)', border: '1px solid var(--amber-7, #fde68a)' }} title="Gun number changed since last label was printed">
        <i style={{ background: '#d97706' }} /> Needs reprint
      </span>
    )
  }
  if (participant.labelPrinted) {
    return (
      <span className="status-pill status-in">
        <i /> Printed
      </span>
    )
  }
  return (
    <span className="status-pill" style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
      <i style={{ background: '#9ca3af' }} /> Not printed
    </span>
  )
}

const column = legacyCreateColumnHelper<Participant>()
const columns: import('@tanstack/react-table/legacy').LegacyColumnDef<Participant, any>[] = [
  column.accessor('bibNumber', { header: 'Bib no.', cell: (info) => <span className="mono bib-cell">{info.getValue()}</span> }),
  column.accessor('noc', { header: 'NOC', cell: (info) => <span className="noc-cell">{info.getValue()}</span> }),
  column.accessor('name', { header: 'Participant', cell: (info) => <div className="participant-name"><span className="table-avatar">{info.getValue().split(' ').map((part: string) => part[0]).slice(0, 2).join('')}</span><b>{info.getValue()}</b></div> }),
  column.accessor('department', { header: 'Department' }),
  column.accessor('gunNumber', { header: 'Gun no.', cell: (info) => <span className="mono">{info.getValue()}</span> }),
  column.display({ id: 'labelStatus', header: 'Label', cell: (info) => <LabelBadge participant={info.row.original} /> }),
  column.accessor('contactNumber', { header: 'Contact' }),
  column.accessor('category', { header: 'Category' }),
  column.accessor('status', { header: 'Status', cell: (info) => <StatusPill status={info.getValue()} /> }),
]

export function ParticipantsPage() {
  const { refresh, notify, can } = useAppStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<Participant | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const pageSize = 10
  const sortingMap: Record<string, string> = { bibNumber: 'bib_number', name: 'name', noc: 'noc', gunNumber: 'gun_number', status: 'pouch_status' }
  const selectedSort = sorting[0]
  const { participants, participantTotal, loading } = useRangeData({
    search, category: category || undefined, department: department || undefined,
    pouch_status: status || undefined, label_status: labelFilter || undefined,
    page, limit: pageSize, sort: sortingMap[selectedSort?.id ?? 'bibNumber'] ?? 'bib_number',
    order: selectedSort?.desc ? 'desc' : 'asc',
  })
  const table = useLegacyTable({ data: participants, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const visibleRows = table.getRowModel().rows
  const pageRows = visibleRows.map((row) => row.original)
  const openForm = (participant?: Participant) => { setEditing(participant ?? null); setShowForm(true) }
  const remove = async () => {
    if (!confirmDelete) return
    try {
      await api.deleteParticipants(confirmDelete)
      await refresh()
      notify(`${confirmDelete.length} participant${confirmDelete.length === 1 ? '' : 's'} deleted`)
      setSelected([])
      setConfirmDelete(null)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not delete participant.') }
  }
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading participants"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading participants…</span></div>
  return <div className="page">
    <PageHeading eyebrow="RANGE DIRECTORY" title="Participants" description="Manage registered participants and their firearm assignments." actions={<>
      {can('import.use') && <Link className="button button-secondary" to="/participants/import"><Upload size={16} /> Import</Link>}
      <Can permission="participants.create"><Button onClick={() => openForm()}><Plus size={17} /> Add participant</Button></Can>
    </>} />
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="toolbar-left"><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Search name, bib, gun no..." aria-label="Search participants" /></div><select className="filter-select" aria-label="Filter category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}><option value="">All categories</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><select className="filter-select" aria-label="Filter department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0) }}><option value="">All departments</option>{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select><select className="filter-select" aria-label="Filter status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}><option value="">All statuses</option><option value="in">Checked in</option><option value="out">Checked out</option></select><select className="filter-select" aria-label="Filter label status" value={labelFilter} onChange={(e) => { setLabelFilter(e.target.value); setPage(0) }}><option value="">All label statuses</option><option value="unprinted">Not printed</option><option value="printed">Printed</option><option value="stale">Needs reprint</option></select></div>
        <div className="toolbar-right">{selected.length > 0 && <><span className="selected-count">{selected.length} selected</span>{can('barcodes.print') && <Button variant="outline" onClick={() => navigate(`/barcodes?selected=${selected.join(',')}`)}><Printer size={15} /> Print</Button>}{can('participants.delete') && <Button variant="danger" onClick={() => setConfirmDelete(selected)}><Trash2 size={15} /> Delete</Button>}</>}{can('reports.export') && <Button variant="outline" onClick={() => { const blob = new Blob([JSON.stringify(participants, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'participants.json'; a.click(); URL.revokeObjectURL(a.href) }}><Download size={15} /> Export</Button>}</div>
      </div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th className="checkbox-col"><input type="checkbox" aria-label="Select all participants on this page" checked={pageRows.length > 0 && pageRows.every((p) => selected.includes(p.id))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...pageRows.map((p) => p.id)])] : selected.filter((id) => !pageRows.some((p) => p.id === id)))} /></th>{table.getHeaderGroups().map((group) => group.headers.map((header) => <th key={header.id}>{header.column.getCanSort() ? <button className="sort-header" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp size={12} /></button> : flexRender(header.column.columnDef.header, header.getContext())}</th>))}<th className="actions-col">Actions</th></tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.original.id}><td className="checkbox-col"><input type="checkbox" aria-label={`Select ${row.original.name}`} checked={selected.includes(row.original.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, row.original.id] : selected.filter((id) => id !== row.original.id))} /></td>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}<td><div className="row-actions">{can('participants.edit') && <button title="Edit participant" aria-label="Edit participant" onClick={() => openForm(row.original)}><UserRoundPen size={15} /></button>}        {can('barcodes.print') && <button title="Print barcode" aria-label="Print barcode" onClick={() => navigate(`/barcodes?selected=${row.original.id}`)}><Printer size={15} /></button>}{can('participants.delete') && <button title="Delete participant" aria-label="Delete participant" onClick={() => setConfirmDelete([row.original.id])}><Trash2 size={15} /></button>}</div></td></tr>)}
          {pageRows.length === 0 && <tr><td colSpan={10}><div className="empty-state"><span className="empty-icon"><UsersEmpty /></span><b>No participants found</b><span>Try adjusting your search or filters.</span></div></td></tr>}</tbody>
      </table></div>
      <footer className="table-footer"><span>Showing <b>{participantTotal ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, participantTotal)}</b> of <b>{participantTotal}</b> participants</span><div className="pagination"><button className="button button-outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}><ChevronLeft size={15} /> Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(participantTotal / pageSize))}</span><button className="button button-outline" disabled={(page + 1) * pageSize >= participantTotal} onClick={() => setPage(page + 1)}>Next <ChevronRight size={15} /></button></div></footer>
    </section>
    {showForm && <ParticipantForm participant={editing} onClose={() => setShowForm(false)} />}
    {confirmDelete && <Modal title="Delete participant?" onClose={() => setConfirmDelete(null)} footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={remove}><Trash2 size={15} /> Delete {confirmDelete.length > 1 ? `${confirmDelete.length} participants` : 'participant'}</Button></>}><p className="confirm-copy">This will permanently remove {confirmDelete.length > 1 ? 'these participants' : 'this participant'} from the local register. Transaction history will remain.</p></Modal>}
  </div>
}

function UsersEmpty() { return <UserRoundPen size={21} /> }

function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'status' in error && 'code' in error
}

function ParticipantForm({ participant, onClose }: { participant: Participant | null; onClose: () => void }) {
  const { participants } = useRangeData()
  const { refresh, notify } = useAppStore()
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: participant ?? { bibNumber: '', noc: 'IND', name: '', department: DEPARTMENTS[0], gunNumber: '', contactNumber: '', category: CATEGORIES[0] },
  })
  const submit = async (values: FormValues) => {
    const duplicateBib = participants.find((p) => p.bibNumber.toLowerCase() === values.bibNumber.toLowerCase() && p.id !== participant?.id)
    const duplicateGun = participants.find((p) => p.gunNumber.toLowerCase() === values.gunNumber.toLowerCase() && p.id !== participant?.id)
    if (duplicateBib) { setError('bibNumber', { message: 'This bib number is already assigned.' }); return }
    if (duplicateGun) { setError('gunNumber', { message: 'This gun number is already assigned.' }); return }
    let isGunChanged = false
    try {
      if (participant) {
        isGunChanged = values.gunNumber.trim().toLowerCase() !== participant.gunNumber.trim().toLowerCase()
        await api.updateParticipant({ ...participant, ...values })
      } else {
        await api.addParticipant(values)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save participant.'
      const fields = isApiError(error) ? error.fields : undefined
      if (fields?.bib_number || message.toLowerCase().includes('bib')) setError('bibNumber', { message: fields?.bib_number ?? message })
      else if (fields?.gun_number || message.toLowerCase().includes('gun')) setError('gunNumber', { message: fields?.gun_number ?? message })
      else notify(message)
      return
    }
    await refresh()
    if (participant) {
      if (isGunChanged) {
        notify('Participant updated · Gun number changed (Needs reprint)')
      } else {
        notify('Participant updated')
      }
    } else {
      notify('Participant added')
    }
    onClose()
  }

  return   <Modal title={participant ? 'Edit participant' : 'Add participant'} onClose={onClose} wide drawer footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="participant-form" disabled={isSubmitting}>{participant ? 'Save changes' : 'Add participant'}</Button></>}>
    <form id="participant-form" onSubmit={handleSubmit(submit)} className="form-grid">
      <Field label="Bib number" error={errors.bibNumber?.message}><input {...register('bibNumber')} placeholder="e.g. 141" /></Field>
      <Field label="NOC" error={errors.noc?.message}><input {...register('noc')} placeholder="e.g. IND" /></Field>
      <div className="field-span-two"><Field label="Full name" error={errors.name?.message}><input {...register('name')} placeholder="Participant's full name" /></Field></div>
      <Field label="Department" error={errors.department?.message}><select {...register('department')}>{DEPARTMENTS.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Gun number" error={errors.gunNumber?.message}><input {...register('gunNumber')} placeholder="e.g. G-241" /></Field>
      <Field label="Contact number" error={errors.contactNumber?.message}><input {...register('contactNumber')} placeholder="+91 98 1234 5678" /></Field>
      <Field label="Category" error={errors.category?.message}><select {...register('category')}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <div className="form-note field-span-two">A unique Code128 barcode is generated automatically from the bib number.</div>
    </form>
  </Modal>
}
