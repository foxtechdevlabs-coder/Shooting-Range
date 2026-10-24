import { useEffect, useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { Download, Printer, Search } from 'lucide-react'
import { Button, PageHeading } from '@/components/ui'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import { formatDateTime } from '@/lib/format'

const operationalTabs = [
  { label: 'Participant records', id: 'participants' },
  { label: 'Pouches out', id: 'pouches-out' },
  { label: 'Transactions', id: 'transactions' },
]
const adminTabs = [
  { label: 'Corrections log', id: 'corrections' },
  { label: 'User activity', id: 'user-activity' },
  { label: 'Imports', id: 'imports' },
]
type ReportRow = Record<string, unknown>
const columnOverrides: Record<string, string[]> = {
  participants: ['bib_number', 'noc', 'name', 'department', 'gun_number', 'contact_number', 'category', 'status'],
  'pouches-out': ['bib_number', 'noc', 'name', 'gun_number', 'category', 'time_out', 'duration_seconds'],
  transactions: ['timestamp', 'participant', 'bib_number', 'gun_number', 'type', 'user', 'status', 'correction_reason'],
  corrections: ['created_at', 'participant', 'bib_number', 'action', 'old_values', 'new_values', 'reason', 'user'],
  'user-activity': ['created_at', 'user', 'action', 'entity', 'entity_id', 'old_values', 'new_values'],
  imports: ['created_at', 'file_name', 'user', 'rows_imported', 'rows_updated', 'rows_rejected'],
}

function labelFor(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (key.includes('timestamp') || key.endsWith('_at') || key === 'time_out') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date.toISOString())
  }
  if (key === 'duration_seconds') {
    const seconds = Number(value)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    return `${hours}h ${minutes}m`
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function ReportsPage() {
  const { report = 'participants' } = useParams()
  const { currentUser, can, notify } = useAppStore()
  const isAdmin = currentUser?.role === 'admin'
  const tabs = isAdmin ? [...operationalTabs, ...adminTabs] : operationalTabs
  const currentTab = report === 'activity' ? 'user-activity' : tabs.some((tab) => tab.id === report) ? report : 'participants'
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const query = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string>, [filters])
  const queryKey = JSON.stringify(query)
  const settings = currentUser?.name ?? 'Range staff'
  const generated = useMemo(() => new Date(), [rows])

  useEffect(() => {
    if ((currentTab === 'corrections' || currentTab === 'user-activity' || currentTab === 'imports') && !isAdmin) return
    let active = true
    setLoading(true)
    void api.report(currentTab, JSON.parse(queryKey) as Record<string, string | number | undefined>).then((result) => {
      if (!active) return
      setRows(result.data.map((row) => ({ ...row })))
      setTotal(result.total)
    }).catch((error) => {
      if (active) notify(error instanceof Error ? error.message : 'Could not load report.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [currentTab, queryKey, isAdmin, notify])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(q))) : rows
  }, [rows, search])
  const headers = columnOverrides[currentTab] ?? Object.keys(visibleRows[0] ?? {})
  const exportAllowed = (currentTab === 'participants' || currentTab === 'pouches-out' || currentTab === 'transactions')
    ? can('reports.export')
    : isAdmin
  const print = () => {
    document.title = `Shooting range — ${tabs.find((tab) => tab.id === currentTab)?.label ?? currentTab}`
    window.print()
  }
  const exportReport = async () => {
    try { await api.downloadReport(currentTab, query); notify('Report downloaded.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not export report.') }
  }
  const updateFilter = (key: string, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading report"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading report…</span></div>
  return <div className="page">
    <div className="report-print-header"><div className="report-print-brand"><b>RO</b><span>Shooting Range Management</span></div><div><b>{tabs.find((tab) => tab.id === currentTab)?.label}</b><span>Generated {formatDateTime(generated.toISOString())} by {settings}</span></div></div>
    <PageHeading eyebrow="INSIGHTS & RECORDS" title="Reports" description="Event records and operational summaries, ready when you are." actions={<><Button variant="outline" onClick={print}><Printer size={16} /> Print</Button>{exportAllowed && <Button onClick={() => void exportReport()}><Download size={16} /> Export Excel</Button>}</>} />
    <section className="panel report-panel"><div className="report-tabs" role="tablist">{tabs.map((tab) => <NavLink role="tab" aria-selected={currentTab === tab.id} className={currentTab === tab.id ? 'report-tab report-tab-active' : 'report-tab'} key={tab.id} to={tab.id === 'participants' ? '/reports' : `/reports/${tab.id}`}>{tab.label}{adminTabs.some((item) => item.id === tab.id) && <span className="admin-only">ADMIN</span>}</NavLink>)}</div>
      <div className="report-toolbar"><div className="report-summary"><b>{total}</b> records<span>· Loaded from server</span></div><div className="report-filter-tools"><input className="filter-select" type="date" aria-label="From date" value={filters.from ?? ''} onChange={(event) => updateFilter('from', event.target.value)} /><input className="filter-select" type="date" aria-label="To date" value={filters.to ?? ''} onChange={(event) => updateFilter('to', event.target.value)} />{['participants', 'pouches-out'].includes(currentTab) && <><input className="filter-select" placeholder="NOC" aria-label="Filter NOC" value={filters.noc ?? ''} onChange={(event) => updateFilter('noc', event.target.value)} /><input className="filter-select" placeholder="Department" aria-label="Filter department" value={filters.department ?? ''} onChange={(event) => updateFilter('department', event.target.value)} /><input className="filter-select" placeholder="Category ID" aria-label="Filter category ID" value={filters.category_id ?? ''} onChange={(event) => updateFilter('category_id', event.target.value)} />{currentTab === 'participants' && <select className="filter-select" aria-label="Filter participant status" value={filters.status ?? ''} onChange={(event) => updateFilter('status', event.target.value)}><option value="">All statuses</option><option value="in">Checked in</option><option value="out">Checked out</option></select>}</>}{currentTab === 'transactions' && <><input className="filter-select" placeholder="Participant ID" aria-label="Filter participant ID" value={filters.participant_id ?? ''} onChange={(event) => updateFilter('participant_id', event.target.value)} /><input className="filter-select" placeholder="Gun number" aria-label="Filter gun number" value={filters.gun_number ?? ''} onChange={(event) => updateFilter('gun_number', event.target.value)} /><select className="filter-select" aria-label="Filter movement" value={filters.type ?? ''} onChange={(event) => updateFilter('type', event.target.value)}><option value="">All movements</option><option value="in">Check-in</option><option value="out">Check-out</option></select><input className="filter-select" placeholder="User ID" aria-label="Filter user ID" value={filters.user_id ?? ''} onChange={(event) => updateFilter('user_id', event.target.value)} /></>}{['corrections', 'user-activity'].includes(currentTab) && <input className="filter-select" placeholder="User ID" aria-label="Filter user ID" value={filters.user_id ?? ''} onChange={(event) => updateFilter('user_id', event.target.value)} />}{currentTab === 'user-activity' && <input className="filter-select" placeholder="Action" aria-label="Filter action" value={filters.action ?? ''} onChange={(event) => updateFilter('action', event.target.value)} />}<div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this report..." aria-label="Search report rows" /></div></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map((key) => <th key={key}>{labelFor(key)}</th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={String(row.id ?? `${currentTab}-${index}`)}>{headers.map((key) => <td key={key}>{displayValue(key, row[key])}</td>)}</tr>)}{visibleRows.length === 0 && <tr><td colSpan={Math.max(1, headers.length)}><div className="empty-state"><b>No matching records</b><span>Adjust your filters and try again.</span></div></td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{visibleRows.length}</b> of <b>{total}</b> report records</span><span className="report-generated">Generated {formatDateTime(generated.toISOString())}</span></div>
    </section>
  </div>
}
