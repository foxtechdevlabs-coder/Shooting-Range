import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, MoveRight, ShieldCheck, UserRoundPlus } from 'lucide-react'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'

/**
 * First-run setup: shown when the installation has no users yet.
 * Creates the first Admin through POST /api/setup/first-admin
 * (loopback-only, rate limited, password minimum 10 characters).
 */
export function SetupPage({ version }: { version?: string }) {
  const navigate = useNavigate()
  const login = useAppStore((s) => s.login)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setFieldErrors({})
    if (password.length < 10) { setFieldErrors({ password: 'Password must be at least 10 characters.' }); return }
    if (password !== confirmPassword) { setFieldErrors({ confirm_password: 'Passwords do not match.' }); return }
    setBusy(true)
    try {
      await api.createFirstAdmin({
        full_name: fullName.trim(),
        username: username.trim(),
        password,
        confirm_password: confirmPassword,
      })
      // Sign in with the account that was just created.
      const user = await api.login(username.trim(), password)
      login(user)
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      const apiError = cause as { message?: string; fields?: Record<string, string>; status?: number }
      if (apiError.fields && Object.keys(apiError.fields).length > 0) {
        setFieldErrors(apiError.fields)
      } else if (apiError.status === 409) {
        setError('Setup was already completed on this installation. Please sign in instead.')
      } else {
        setError(apiError.message ?? 'Could not create the administrator account.')
      }
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page">
    <div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" />
    <div className="login-wrap">
      <div className="login-brand"><span className="brand-mark"><ShieldCheck size={24} /></span><div><strong>Range<span>Ops</span></strong><small>SHOOTING RANGE MANAGEMENT</small></div></div>
      <section className="login-card">
        <div className="login-intro">
          <div className="login-icon"><UserRoundPlus size={22} /></div>
          <h1>Set up this installation</h1>
          <p>Create the first administrator account. This is only shown once.</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label className="form-field"><span>Full name</span><div className="input-icon"><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Alex Morgan" autoComplete="name" autoFocus required /></div>
            {fieldErrors.full_name && <small className="field-error">{fieldErrors.full_name}</small>}
          </label>
          <label className="form-field"><span>Username</span><div className="input-icon"><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin" autoComplete="username" required /></div>
            {fieldErrors.username && <small className="field-error">{fieldErrors.username}</small>}
          </label>
          <label className="form-field"><span>Password</span><div className="input-icon"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}
          </label>
          <label className="form-field"><span>Repeat password</span><div className="input-icon"><input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Enter the password again" autoComplete="new-password" required /></div>
            {fieldErrors.confirm_password && <small className="field-error">{fieldErrors.confirm_password}</small>}
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create administrator'} <MoveRight size={17} /></button>
        </form>
        <small className="settings-fineprint">This account has full administrator rights. Keep the password somewhere safe — it cannot be recovered.</small>
      </section>
      <div className="login-footer"><span><i />OFFLINE INSTALLATION</span><span>Range operations, made clear.{version ? ` · v${version}` : ''}</span></div>
    </div>
  </main>
}
