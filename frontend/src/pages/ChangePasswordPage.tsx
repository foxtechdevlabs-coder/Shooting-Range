import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const notify = useAppStore((state) => state.notify)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      useAppStore.setState((state) => ({ currentUser: state.currentUser ? { ...state.currentUser, mustChangePassword: false } : null }))
      notify('Password changed successfully.')
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="login-page"><div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" /><div className="login-wrap"><div className="login-brand"><span className="brand-mark"><ShieldCheck size={24} /></span><div><strong>Range<span>Ops</span></strong><small>SHOOTING RANGE MANAGEMENT</small></div></div><section className="login-card"><div className="login-intro"><div className="login-icon"><KeyRound size={22} /></div><h1>Change your password</h1><p>Set a new password before continuing.</p></div><form className="login-form" onSubmit={submit}><label className="form-field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="form-field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></label>{error && <div className="login-error" role="alert">{error}</div>}<button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></form></section></div></main>
}
