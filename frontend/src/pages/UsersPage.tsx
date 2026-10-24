import { useState } from 'react'
import { KeyRound, Plus, Shield, UserRoundPen, UsersRound } from 'lucide-react'
import { Button, Field, Modal, PageHeading } from '@/components/ui'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import { ALL_PERMISSIONS, PERMISSION_LABELS, type Permission, type Role, type User } from '@/types'
import { useRangeData } from '@/hooks/useRangeData'

type UserDraft = Omit<User, 'id'> & { id?: string }
const presets: Record<string, Permission[]> = {
  Admin: ALL_PERMISSIONS,
  Staff: ['participants.view', 'participants.create', 'participants.edit', 'import.use', 'barcodes.print', 'scan.use', 'transactions.view', 'reports.view', 'reports.export'],
  'Scan-only': ['scan.use', 'transactions.view'],
}
export function UsersPage() {
  const { users, loading } = useRangeData()
  const { refresh, notify } = useAppStore()
  const [draft, setDraft] = useState<UserDraft | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const emptyDraft = (): UserDraft => ({ name: '', username: '', password: '', role: 'staff', permissions: presets.Staff, active: true })
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft || !draft.name.trim() || !draft.username.trim()) return
    try { await api.saveUser({ ...draft, name: draft.name.trim(), username: draft.username.trim() }); await refresh(); notify(draft.id ? 'User updated' : 'User created'); setDraft(null) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save user') }
  }
  const updatePermission = (permission: Permission, checked: boolean) => setDraft((old) => old && ({ ...old, permissions: checked ? [...old.permissions, permission] : old.permissions.filter((p) => p !== permission) }))
  const savePassword = async () => {
    if (!resetting || newPassword.trim().length < 8) return
    try {
      await api.resetPassword(resetting.id, newPassword)
      await refresh()
      notify('Password reset')
      setResetting(null)
      setNewPassword('')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not reset password.') }
  }
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading users"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading users…</span></div>
  return <div className="page">
    <PageHeading eyebrow="ACCESS CONTROL" title="Users & permissions" description="Manage who can access your range operations." actions={<Button onClick={() => setDraft(emptyDraft())}><Plus size={16} /> Add user</Button>} />
    <section className="panel table-panel"><div className="panel-heading users-panel-heading"><div><h2>Team members</h2><p>{users.length} accounts · Permissions are enforced across the app</p></div><span className="users-count"><UsersRound size={16} />{users.filter((u) => u.active).length} active</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Permissions</th><th>Last sign in</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="participant-name"><span className="table-avatar">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><b>{user.name}</b></div></td><td className="mono">{user.username}</td><td><span className={`role-pill role-${user.role}`}>{user.role === 'admin' ? <Shield size={13} /> : <UsersRound size={13} />}{user.role}</span></td><td>{user.role === 'admin' ? <span className="permission-total">All permissions</span> : <span className="permission-total">{user.permissions.length} assigned</span>}</td><td>{user.lastLogin ? new Date(user.lastLogin).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</td><td><span className={`user-state ${user.active ? 'user-active' : 'user-disabled'}`}><i />{user.active ? 'Active' : 'Inactive'}</span></td><td><div className="row-actions"><button aria-label={`Edit ${user.name}`} title="Edit user" onClick={() => setDraft({ ...user })}><UserRoundPen size={15} /></button><button aria-label={`Reset ${user.name} password`} title="Reset password" onClick={() => setResetting(user)}><KeyRound size={15} /></button></div></td></tr>)}</tbody></table></div><div className="users-footnote"><Shield size={15} /> Admin accounts have all permissions. Staff accounts only have the permissions assigned to them.</div></section>
    {draft && <Modal title={draft.id ? 'Edit user' : 'Add user'} onClose={() => setDraft(null)} wide drawer footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" form="user-form">{draft.id ? 'Save changes' : 'Create user'}</Button></>}><form id="user-form" className="user-form" onSubmit={save}><div className="form-grid"><Field label="Full name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required placeholder="e.g. Casey Morgan" /></Field><Field label="Username"><input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} required placeholder="e.g. casey" /></Field>{!draft.id && <Field label="Initial password" hint="At least 8 characters."><input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} minLength={8} required /></Field>}<Field label="Role"><select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role, permissions: e.target.value === 'admin' ? ALL_PERMISSIONS : presets.Staff })}><option value="admin">Admin</option><option value="staff">Staff</option></select></Field><label className="toggle-field"><span><b>Account active</b><small>Inactive users cannot sign in.</small></span><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></label></div><div className="permissions-block"><div className="permissions-title"><div><h3>Permissions</h3><p>Choose what this user can access.</p></div><div className="preset-buttons">{Object.entries(presets).map(([label, values]) => <button type="button" key={label} onClick={() => setDraft({ ...draft, role: label === 'Admin' ? 'admin' : 'staff', permissions: values })}>{label}</button>)}</div></div><div className="permission-grid">{ALL_PERMISSIONS.map((permission) => <label key={permission} className="permission-check"><input type="checkbox" checked={draft.permissions.includes(permission)} onChange={(e) => updatePermission(permission, e.target.checked)} /><span><b>{PERMISSION_LABELS[permission]}</b><small>{permission}</small></span></label>)}</div></div></form></Modal>}
    {resetting && <Modal title={`Reset password for ${resetting.name}`} onClose={() => { setResetting(null); setNewPassword('') }} footer={<><Button variant="secondary" onClick={() => setResetting(null)}>Cancel</Button><Button disabled={newPassword.length < 8} onClick={savePassword}>Reset password</Button></>}><div className="password-reset-note"><KeyRound size={19} /><p>Set a new password for <b>{resetting.username}</b>. The user will need this password the next time they sign in.</p></div><Field label="New password" hint="Use at least 8 characters."><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus minLength={8} /></Field></Modal>}
  </div>
}
