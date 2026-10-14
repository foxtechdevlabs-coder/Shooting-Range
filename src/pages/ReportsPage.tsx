import { useMemo, useState } from 'react'
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Download, Printer, Search } from 'lucide-react'
import { Button, PageHeading, StatusPill } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { formatDateTime } from '@/lib/format'

const tabs = [
  { label: 'Participant records', id: 'participants' },
  { label: 'Gun status', id: 'guns' },
  { label: 'Transactions', id: 'transactions' },
  { label: 'User activity', id: 'activity' },
]
export function ReportsPage() {
  const [now] = useState(() => new Date())
  const { report = 'participants' } = useParams()
  const navigate = useNavigate()
  const { participants, transactions, users, activity, can, settings } = useAppStore()
  const [search, setSearch] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const currentTab = tabs.some((tab) => tab.id === report) ? report : 'participants'
  const rows = useMemo(() => {
    const q = search.toLowerCase()
    if (currentTab === 'participants') return participants.filter((p) => (!q || `${p.name} ${p.bibNumber} ${p.gunNumber} ${p.department}`.toLowerCase().includes(q)) && (!filterValue || p.category === filterValue))
    if (currentTab === 'guns') return participants.filter((p) => (!q || `${p.name} ${p.bibNumber} ${p.gunNumber} ${p.department}`.toLowerCase().includes(q)) && (!filterValue || p.status === filterValue))
    if (currentTab === 'transactions') return transactions.filter((t) => { const p = participants.find((item) => item.id === t.participantId); return (!q || `${p?.name} ${p?.bibNumber} ${p?.gunNumber} ${t.type}`.toLowerCase().includes(q)) && (!filterValue || t.type === filterValue) })
    return activity.filter((a) => (!q || `${a.action} ${a.entity} ${a.details} ${users.find((u) => u.id === a.userId)?.name}`.toLowerCase().includes(q)) && (!filterValue || a.userId === filterValue))
  }, [currentTab, participants, transactions, activity, users, search, filterValue])
  if (currentTab === 'activity' && !can('users.manage')) return <Navigate to="/dashboard" replace />
  const filterLabel = currentTab === 'participants' ? 'Category' : currentTab === 'guns' ? 'Gun status' : currentTab === 'transactions' ? 'Movement' : 'User'
  const exportRows = () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Report')
    XLSX.writeFile(book, `range-${currentTab}-report.xlsx`)
  }
  const print = () => { document.title = `${settings.eventName} — ${tabs.find((t) => t.id === currentTab)?.label}`; window.print() }
  const userName = (id: string) => users.find((user) => user.id === id)?.name ?? 'Range staff'
  const dateLabel = now.toLocaleDateString(undefined, { dateStyle: 'long' })
  return <div className="page">
    <div className="report-print-header"><div className="report-print-brand"><b>{settings.logoText}</b><span>{settings.eventName}</span></div><div><b>{tabs.find((t) => t.id === currentTab)?.label}</b><span>Generated {dateLabel} by {useAppStore.getState().currentUser?.name}</span></div></div>
    <PageHeading eyebrow="INSIGHTS & RECORDS" title="Reports" description="Event records and operational summaries, ready when you are." actions={<><Button variant="outline" onClick={print}><Printer size={16} /> Print</Button>{can('reports.export') && <Button onClick={exportRows}><Download size={16} /> Export Excel</Button>}</>} />
    <section className="panel report-panel"><div className="report-tabs" role="tablist">{tabs.map((tab) => <NavLink role="tab" aria-selected={currentTab === tab.id} className={currentTab === tab.id ? 'report-tab report-tab-active' : 'report-tab'} key={tab.id} to={tab.id === 'participants' ? '/reports' : `/reports/${tab.id}`} onClick={(event) => { if (tab.id === 'activity' && !can('users.manage')) { event.preventDefault(); navigate('/dashboard') } }}>{tab.label}{tab.id === 'activity' && !can('users.manage') && <span className="admin-only">ADMIN</span>}</NavLink>)}</div>
      <div className="report-toolbar"><div className="report-summary"><b>{rows.length}</b> {currentTab === 'transactions' ? 'transactions' : currentTab === 'activity' ? 'activity records' : 'participants'}<span>· Updated just now</span></div><div className="report-filter-tools"><select className="filter-select" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} aria-label={`Filter by ${filterLabel.toLowerCase()}`}><option value="">All {filterLabel.toLowerCase()}s</option>{currentTab === 'participants' && <>{[...new Set(participants.map((p) => p.category))].map((value) => <option key={value}>{value}</option>)}</>}{currentTab === 'guns' && <><option value="in">Checked in</option><option value="out">Checked out</option></>}{currentTab === 'transactions' && <><option value="check-in">Check-in</option><option value="check-out">Check-out</option></>}{currentTab === 'activity' && users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><div className="search-box"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this report..." aria-label="Search report rows" /></div></div></div>
      <div className="table-scroll"><table className="data-table"><thead>{currentTab === 'participants' && <tr><th>Bib no.</th><th>NOC</th><th>Name</th><th>Department</th><th>Gun no.</th><th>Contact</th><th>Category</th><th>Status</th></tr>}{currentTab === 'guns' && <tr><th>Gun no.</th><th>Assigned participant</th><th>Bib no.</th><th>Department</th><th>Category</th><th>Gun status</th></tr>}{currentTab === 'transactions' && <tr><th>Timestamp</th><th>Participant</th><th>Bib no.</th><th>Gun no.</th><th>Movement</th><th>Performed by</th><th>Status</th></tr>}{currentTab === 'activity' && <tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr>}</thead><tbody>
        {currentTab === 'participants' && (rows as typeof participants).map((p) => <tr key={p.id}><td className="mono">{p.bibNumber}</td><td>{p.noc}</td><td><b>{p.name}</b></td><td>{p.department}</td><td className="mono">{p.gunNumber}</td><td>{p.contactNumber}</td><td>{p.category}</td><td><StatusPill status={p.status} /></td></tr>)}
        {currentTab === 'guns' && (rows as typeof participants).map((p) => <tr key={p.id}><td className="mono">{p.gunNumber}</td><td><b>{p.name}</b></td><td>{p.bibNumber}</td><td>{p.department}</td><td>{p.category}</td><td><StatusPill status={p.status} /></td></tr>)}
        {currentTab === 'transactions' && (rows as typeof transactions).map((t) => { const p = participants.find((person) => person.id === t.participantId); return <tr key={t.id}><td>{formatDateTime(t.timestamp)}</td><td>{p?.name ?? 'Participant removed'}</td><td>{p?.bibNumber ?? '—'}</td><td>{p?.gunNumber ?? '—'}</td><td>{t.type}</td><td>{userName(t.performedBy)}</td><td><span className={`audit-badge audit-${t.status}`}>{t.status}</span></td></tr> })}
        {currentTab === 'activity' && (rows as typeof activity).map((a) => <tr key={a.id}><td>{formatDateTime(a.timestamp)}</td><td>{userName(a.userId)}</td><td><b>{a.action}</b></td><td>{a.entity}</td><td>{a.details}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={8}><div className="empty-state"><b>No matching records</b><span>Adjust your search and try again.</span></div></td></tr>}
      </tbody></table></div><div className="table-footer"><span>Showing <b>{rows.length}</b> records in this report</span><span className="report-generated">Generated {dateLabel}</span></div>
    </section>
  </div>
}
