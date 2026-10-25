import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowUpRightFromSquare, Clock3, Crosshair, Users, WalletCards } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { PageHeading } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'

const colors = ['#224c78', '#4276a5', '#7499bc', '#a9bfd3', '#d0dce7']

export function DashboardPage() {
  const [now] = useState(() => new Date())
  const { notify } = useAppStore()
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.dashboardSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void api.dashboardSummary().then((result) => {
      if (active) { setSummary(result); setError('') }
    }).catch((cause) => {
      if (active) {
        const message = cause instanceof Error ? cause.message : 'Could not load dashboard data.'
        setError(message)
        notify(message)
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [notify])
  const hourly = useMemo(() => Array.from({ length: 8 }, (_, index) => {
    const hourValue = index + 8
    const hour = new Date(now)
    hour.setHours(hourValue, 0, 0, 0)
    const hourLabel = new Intl.DateTimeFormat('en', { hour: 'numeric' }).format(hour)
    const counts = summary?.hourly.find((entry) => entry.hour === hourValue)
    return { hour: hourLabel, checkIn: counts?.checkIn ?? 0, checkOut: counts?.checkOut ?? 0 }
  }), [summary, now])
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading dashboard"><div className="skeleton skeleton-heading" /><div className="skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton skeleton-card" key={item} />)}</div><div className="skeleton skeleton-panel" /><span>Loading dashboard data…</span></div>
  if (error || !summary) return <div className="page"><PageHeading eyebrow="OVERVIEW" title="Good morning" description="Here’s what’s happening at your range today." /><div className="panel empty-state" role="alert">{error || 'Dashboard data is unavailable.'}</div></div>
  const { in: inCount, out: outCount, todayTransactions: todayCount } = summary
  const categoryData = summary.categories
  const cards = [
    { label: 'Total participants', value: summary.total, note: 'Registered for this event', icon: Users, tint: 'blue' },
    { label: 'Guns checked out', value: outCount, note: 'Currently on the range', icon: ArrowUpRight, tint: 'amber' },
    { label: 'Guns checked in', value: inCount, note: 'Safely in the armory', icon: ArrowDownLeft, tint: 'green' },
    { label: "Today's transactions", value: todayCount, note: 'Check-ins and check-outs', icon: Activity, tint: 'slate' },
  ]
  return <div className="page dashboard-page">
    <PageHeading eyebrow="OVERVIEW" title="Good morning" description="Here’s what’s happening at your range today." actions={<span className="date-label"><Clock3 size={15} />{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>} />
    <div className="kpi-grid">{cards.map(({ label, value, note, icon: Icon, tint }) => <article className="kpi-card" key={label}><div className="kpi-top"><span>{label}</span><span className={`kpi-icon ${tint}`}><Icon size={18} /></span></div><strong>{value}</strong><small>{note}</small><div className={`kpi-line ${tint}`} /></article>)}</div>
    <div className="dashboard-charts">
      <section className="panel chart-panel"><div className="panel-heading"><div><h2>Range activity</h2><p>Check-ins and check-outs by hour</p></div><div className="chart-legend"><span><i className="legend-in" />Checked in</span><span><i className="legend-out" />Checked out</span></div></div>
        <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourly} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}><defs><linearGradient id="inFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#396b98" stopOpacity={0.16} /><stop offset="100%" stopColor="#396b98" stopOpacity={0} /></linearGradient><linearGradient id="outFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c99142" stopOpacity={0.13} /><stop offset="100%" stopColor="#c99142" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0f3" strokeDasharray="4 5" /><XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8a95a3' }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8a95a3' }} /><Tooltip contentStyle={{ border: '1px solid #e8ebef', borderRadius: 9, fontSize: 12, boxShadow: '0 8px 24px #14263b12' }} /><Area type="monotone" dataKey="checkIn" name="Checked in" stroke="#396b98" strokeWidth={2.5} fill="url(#inFill)" /><Area type="monotone" dataKey="checkOut" name="Checked out" stroke="#c99142" strokeWidth={2.5} fill="url(#outFill)" /></AreaChart></ResponsiveContainer></div>
      </section>
      <section className="panel category-panel"><div className="panel-heading"><div><h2>Participants by category</h2><p>Distribution across divisions</p></div></div><div className="category-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={78} paddingAngle={3} stroke="none">{categoryData.map((entry, i) => <Cell key={entry.name} fill={colors[i % colors.length]} />)}</Pie><Tooltip /><text x="50%" y="46%" textAnchor="middle" className="donut-total">{summary.total}</text><text x="50%" y="58%" textAnchor="middle" className="donut-caption">ATHLETES</text></PieChart></ResponsiveContainer></div><div className="category-legend">{categoryData.map((entry, i) => <div key={entry.name}><span><i style={{ backgroundColor: colors[i % colors.length] }} />{entry.name}</span><b>{entry.value}</b></div>)}</div></section>
    </div>
    <div className="dashboard-bottom">
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Latest actions across your range</p></div><Link className="text-link" to="/reports/activity">View activity <ArrowUpRightFromSquare size={14} /></Link></div><div className="activity-list">{summary.recent.map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon ${item.action.toLowerCase().includes('out') ? 'activity-amber' : 'activity-blue'}`}><Activity size={15} /></span><div className="activity-details"><b>{item.action}</b><span>{item.details}</span></div><div className="activity-time"><b>{item.user_name ?? 'Range staff'}</b><span>{formatTime(item.created_at)}</span></div></div>)}</div></section>
      <section className="quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common range tasks</p></div></div><div className="quick-actions"><Link to="/scan"><span className="quick-icon quick-blue"><Crosshair size={18} /></span><div><b>Open scan station</b><small>Check a firearm in or out</small></div><ArrowUpRight size={16} /></Link><Link to="/participants"><span className="quick-icon quick-gray"><Users size={18} /></span><div><b>View participants</b><small>Manage registered athletes</small></div><ArrowUpRight size={16} /></Link><Link to="/transactions"><span className="quick-icon quick-gold"><WalletCards size={18} /></span><div><b>Review transactions</b><small>Browse recent movements</small></div><ArrowUpRight size={16} /></Link></div></section>
    </div>
  </div>
}
