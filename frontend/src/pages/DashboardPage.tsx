import { useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowUpRightFromSquare, Clock3, Crosshair, Users, WalletCards } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { PageHeading } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { formatTime } from '@/lib/format'

const hourly = [
  { hour: '8 AM', checkIn: 8, checkOut: 3 }, { hour: '9 AM', checkIn: 17, checkOut: 7 },
  { hour: '10 AM', checkIn: 25, checkOut: 12 }, { hour: '11 AM', checkIn: 20, checkOut: 16 },
  { hour: '12 PM', checkIn: 30, checkOut: 14 }, { hour: '1 PM', checkIn: 18, checkOut: 21 },
  { hour: '2 PM', checkIn: 26, checkOut: 13 }, { hour: '3 PM', checkIn: 21, checkOut: 18 },
]
const colors = ['#224c78', '#4276a5', '#7499bc', '#a9bfd3', '#d0dce7']

export function DashboardPage() {
  const [now] = useState(() => new Date())
  const { participants, transactions, activity, users } = useAppStore()
  const inCount = participants.filter((p) => p.status === 'in').length
  const outCount = participants.length - inCount
  const today = now.toDateString()
  const todayCount = transactions.filter((t) => new Date(t.timestamp).toDateString() === today).length
  const categoryData = participants.reduce<{ name: string; value: number }[]>((result, item) => {
    const category = result.find((row) => row.name === item.category)
    if (category) category.value++
    else result.push({ name: item.category, value: 1 })
    return result
  }, [])
  const cards = [
    { label: 'Total participants', value: participants.length, note: 'Registered for this event', icon: Users, tint: 'blue' },
    { label: 'Guns checked out', value: outCount, note: 'Currently on the range', icon: ArrowUpRight, tint: 'amber' },
    { label: 'Guns checked in', value: inCount, note: 'Safely in the armory', icon: ArrowDownLeft, tint: 'green' },
    { label: "Today's transactions", value: todayCount, note: 'Check-ins and check-outs', icon: Activity, tint: 'slate' },
  ]
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Range staff'
  return <div className="page dashboard-page">
    <PageHeading eyebrow="OVERVIEW" title="Good morning" description="Here’s what’s happening at your range today." actions={<span className="date-label"><Clock3 size={15} />{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>} />
    <div className="kpi-grid">{cards.map(({ label, value, note, icon: Icon, tint }) => <article className="kpi-card" key={label}><div className="kpi-top"><span>{label}</span><span className={`kpi-icon ${tint}`}><Icon size={18} /></span></div><strong>{value}</strong><small>{note}</small><div className={`kpi-line ${tint}`} /></article>)}</div>
    <div className="dashboard-charts">
      <section className="panel chart-panel"><div className="panel-heading"><div><h2>Range activity</h2><p>Check-ins and check-outs by hour</p></div><div className="chart-legend"><span><i className="legend-in" />Checked in</span><span><i className="legend-out" />Checked out</span></div></div>
        <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourly} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}><defs><linearGradient id="inFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#396b98" stopOpacity={0.16} /><stop offset="100%" stopColor="#396b98" stopOpacity={0} /></linearGradient><linearGradient id="outFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c99142" stopOpacity={0.13} /><stop offset="100%" stopColor="#c99142" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0f3" strokeDasharray="4 5" /><XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8a95a3' }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8a95a3' }} /><Tooltip contentStyle={{ border: '1px solid #e8ebef', borderRadius: 9, fontSize: 12, boxShadow: '0 8px 24px #14263b12' }} /><Area type="monotone" dataKey="checkIn" name="Checked in" stroke="#396b98" strokeWidth={2.5} fill="url(#inFill)" /><Area type="monotone" dataKey="checkOut" name="Checked out" stroke="#c99142" strokeWidth={2.5} fill="url(#outFill)" /></AreaChart></ResponsiveContainer></div>
      </section>
      <section className="panel category-panel"><div className="panel-heading"><div><h2>Participants by category</h2><p>Distribution across divisions</p></div></div><div className="category-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={78} paddingAngle={3} stroke="none">{categoryData.map((entry, i) => <Cell key={entry.name} fill={colors[i % colors.length]} />)}</Pie><Tooltip /><text x="50%" y="46%" textAnchor="middle" className="donut-total">{participants.length}</text><text x="50%" y="58%" textAnchor="middle" className="donut-caption">ATHLETES</text></PieChart></ResponsiveContainer></div><div className="category-legend">{categoryData.map((entry, i) => <div key={entry.name}><span><i style={{ backgroundColor: colors[i % colors.length] }} />{entry.name}</span><b>{entry.value}</b></div>)}</div></section>
    </div>
    <div className="dashboard-bottom">
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Latest actions across your range</p></div><Link className="text-link" to="/reports/activity">View activity <ArrowUpRightFromSquare size={14} /></Link></div><div className="activity-list">{activity.slice(0, 5).map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon ${item.action.toLowerCase().includes('out') ? 'activity-amber' : 'activity-blue'}`}><Activity size={15} /></span><div className="activity-details"><b>{item.action}</b><span>{item.details}</span></div><div className="activity-time"><b>{userName(item.userId)}</b><span>{formatTime(item.timestamp)}</span></div></div>)}</div></section>
      <section className="quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common range tasks</p></div></div><div className="quick-actions"><Link to="/scan"><span className="quick-icon quick-blue"><Crosshair size={18} /></span><div><b>Open scan station</b><small>Check a firearm in or out</small></div><ArrowUpRight size={16} /></Link><Link to="/participants"><span className="quick-icon quick-gray"><Users size={18} /></span><div><b>View participants</b><small>Manage registered athletes</small></div><ArrowUpRight size={16} /></Link><Link to="/transactions"><span className="quick-icon quick-gold"><WalletCards size={18} /></span><div><b>Review transactions</b><small>Browse recent movements</small></div><ArrowUpRight size={16} /></Link></div></section>
    </div>
  </div>
}
