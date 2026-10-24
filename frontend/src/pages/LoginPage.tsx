import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Fingerprint, MoveRight, ShieldCheck } from 'lucide-react'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const login = useAppStore((s) => s.login)
  const serverError = useAppStore((s) => s.serverError)
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const user = await api.login(username, password)
      login(user)
      navigate(user.mustChangePassword ? '/change-password' : '/dashboard')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="login-page">
    <div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" />
    <div className="login-wrap">
      <div className="login-brand"><span className="brand-mark"><ShieldCheck size={24} /></span><div><strong>Range<span>Ops</span></strong><small>SHOOTING RANGE MANAGEMENT</small></div></div>
      <section className="login-card">
        <div className="login-intro"><div className="login-icon"><Fingerprint size={22} /></div><h1>Welcome back</h1><p>Sign in to manage your range operations.</p></div>
        <form onSubmit={submit} className="login-form">
          <label className="form-field"><span>Username</span><div className="input-icon"><input autoComplete="username" value={username} onChange={(e) => { setUsername(e.target.value); setError('') }} placeholder="Enter your username" autoFocus required /><Fingerprint size={17} /></div></label>
          <label className="form-field"><span>Password</span><div className="input-icon"><input autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} placeholder="Enter your password" required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          {serverError && <div className="login-error" role="alert">{serverError}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <MoveRight size={17} /></button>
        </form>
      </section>
      <div className="login-footer"><span><i />SECURE SERVER SESSION</span><span>Range operations, made clear.</span></div>
    </div>
  </main>
}
