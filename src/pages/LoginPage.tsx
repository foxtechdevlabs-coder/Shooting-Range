import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Fingerprint, LockKeyhole, MoveRight, ShieldCheck } from 'lucide-react'
import { api } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const login = useAppStore((s) => s.login)
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const user = api.authenticate(username, password)
    if (!user) { setError('The username or password you entered is incorrect.'); return }
    login(user)
    api.addActivity(user.id, 'Signed in', 'Session', `${user.name} signed in`)
    navigate('/')
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
          <button className="button button-primary login-submit" type="submit">Sign in <MoveRight size={17} /></button>
        </form>
        <div className="demo-accounts"><div><span className="demo-lock"><LockKeyhole size={15} /></span><strong>Demo access</strong></div><p><b>Admin</b> &nbsp; admin / admin123</p><p><b>Staff</b> &nbsp;&nbsp;&nbsp; staff / staff123</p></div>
      </section>
      <div className="login-footer"><span><i />LOCAL & SECURE</span><span>Range operations, made clear.</span></div>
    </div>
  </main>
}
