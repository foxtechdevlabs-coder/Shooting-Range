import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Bell, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, LayoutDashboard, LogOut, Menu, Moon, QrCode, ScanLine, Settings, ShieldCheck, Sun, Users, UserRound, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { api } from '@/services'
import { isServerUnavailable } from '@/lib/api'
import type { Permission } from '@/types'
const LoginPage = lazy(() => import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ParticipantsPage = lazy(() => import('@/pages/ParticipantsPage').then((module) => ({ default: module.ParticipantsPage })))
const ImportPage = lazy(() => import('@/pages/ImportPage').then((module) => ({ default: module.ImportPage })))
const BarcodesPage = lazy(() => import('@/pages/BarcodesPage').then((module) => ({ default: module.BarcodesPage })))
const ScanPage = lazy(() => import('@/pages/ScanPage').then((module) => ({ default: module.ScanPage })))
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage').then((module) => ({ default: module.TransactionsPage })))
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const UsersPage = lazy(() => import('@/pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const ChangePasswordPage = lazy(() => import('@/pages/ChangePasswordPage').then((module) => ({ default: module.ChangePasswordPage })))

function RequireAuth() {
  const { currentUser, authLoading } = useAppStore()
  if (authLoading) return <div className="loading-screen" role="status"><div /><span>Restoring your session…</span></div>
  return currentUser ? <Outlet /> : <Navigate to="/login" replace />
}

function RequirePermission({ permission }: { permission: Permission }) {
  return useAppStore((s) => s.can(permission)) ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Participants', path: '/participants', icon: Users, permission: 'participants.view' as const },
  { label: 'Import data', path: '/participants/import', icon: FileSpreadsheet, permission: 'import.use' as const },
  { label: 'Barcodes', path: '/barcodes', icon: QrCode, permission: 'barcodes.print' as const },
  { label: 'Scan station', path: '/scan', icon: ScanLine, permission: 'scan.use' as const },
  { label: 'Transactions', path: '/transactions', icon: ClipboardList, permission: 'transactions.view' as const },
  { label: 'Reports', path: '/reports', icon: BarChart3, permission: 'reports.view' as const },
  { label: 'Users', path: '/users', icon: UserRound, permission: 'users.manage' as const },
  { label: 'Settings', path: '/settings', icon: Settings, permission: 'settings.manage' as const },
]

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null)
  const { currentUser, dark, setDark, logout, toast, serverError } = useAppStore()
  const mobileOpen = mobileOpenPath === location.pathname
  const activeItem = navItems.find((item) => item.path === location.pathname)
  const title = activeItem?.label ?? (location.pathname.includes('/reports/') ? 'Reports' : 'Dashboard')
  const links = navItems.filter((item) => !item.permission || (currentUser?.role === 'admin' || currentUser?.permissions.includes(item.permission)))
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpenPath(null)} />}
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-open' : ''}`}>
        <Link to="/dashboard" className="brand">
          <span className="brand-mark"><ShieldCheck size={21} /></span>
          {!collapsed && <span className="brand-copy"><strong>Range<span>Ops</span></strong><small>MANAGEMENT SYSTEM</small></span>}
          <button className="sidebar-collapse" aria-label="Collapse sidebar" onClick={(e) => { e.preventDefault(); setCollapsed(!collapsed) }}><ChevronLeft size={17} /></button>
        </Link>
        <div className="nav-caption">{!collapsed && 'WORKSPACE'}</div>
        <nav className="side-nav" aria-label="Main navigation">
          {links.map(({ label, path, icon: Icon }) => (
            <Link key={path} to={path} onClick={() => setMobileOpenPath(null)} title={collapsed ? label : undefined} className={`nav-link ${location.pathname === path || (path === '/reports' && location.pathname.startsWith('/reports/')) ? 'nav-active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} />{!collapsed && <span>{label}</span>}
            </Link>
          ))}
        </nav>
        {!collapsed && <div className="sidebar-bottom"><div className="event-mini"><span className="event-dot" /><div><b>Event is active</b><small>Range operations online</small></div></div><div className="sidebar-version">RangeOps <span>v1.0.0</span></div></div>}
        <button className="sidebar-expand" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </aside>
      <div className="workspace">
        {serverError && <div className="server-error" role="alert">{serverError}</div>}
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpenPath(location.pathname)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <span className="top-divider" />
            <button className="profile-button" onClick={() => navigate('/settings')} title="Account and settings">
              <span className="avatar">{currentUser?.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
              <span className="profile-copy"><b>{currentUser?.name}</b><small>{currentUser?.role === 'admin' ? 'Administrator' : 'Staff member'}</small></span>
            </button>
            <button className="icon-button logout-button" onClick={() => { logout(); navigate('/login') }} aria-label="Sign out"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
      {toast && <div className="toast-message" role="status"><span className="toast-check">✓</span>{toast}<button onClick={() => useAppStore.setState({ toast: '' })} aria-label="Dismiss"><X size={15} /></button></div>}
    </div>
  )
}

function AppRoutes() {
  const { login, currentUser } = useAppStore()
  useEffect(() => {
    let active = true
    void api.me().then((user) => {
      if (active) login(user)
    }).catch((error) => {
      if (active) useAppStore.setState({
        authLoading: false,
        serverError: isServerUnavailable(error) ? error.message : '',
      })
    })
    return () => { active = false }
  }, [login])
  return <BrowserRouter><Suspense fallback={<div className="loading-screen" role="status" aria-label="Loading page"><div /><span>Loading workspace…</span></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      {currentUser?.mustChangePassword && <Route path="*" element={<Navigate to="/change-password" replace />} />}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route element={<RequirePermission permission="participants.view" />}>
          <Route path="/participants" element={<ParticipantsPage />} />
        </Route>
        <Route element={<RequirePermission permission="import.use" />}><Route path="/participants/import" element={<ImportPage />} /></Route>
        <Route element={<RequirePermission permission="barcodes.print" />}><Route path="/barcodes" element={<BarcodesPage />} /></Route>
        <Route element={<RequirePermission permission="scan.use" />}><Route path="/scan" element={<ScanPage />} /></Route>
        <Route element={<RequirePermission permission="transactions.view" />}><Route path="/transactions" element={<TransactionsPage />} /></Route>
        <Route element={<RequirePermission permission="reports.view" />}><Route path="/reports" element={<ReportsPage />} /><Route path="/reports/:report" element={<ReportsPage />} /></Route>
        <Route element={<RequirePermission permission="users.manage" />}><Route path="/users" element={<UsersPage />} /></Route>
        <Route element={<RequirePermission permission="settings.manage" />}><Route path="/settings" element={<SettingsPage />} /></Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></BrowserRouter>
}

export default function App() {
  const serverError = useAppStore((state) => state.serverError)
  return <>{serverError && !useAppStore.getState().currentUser && <div className="server-error" role="alert">{serverError}</div>}<AppRoutes /></>
}
