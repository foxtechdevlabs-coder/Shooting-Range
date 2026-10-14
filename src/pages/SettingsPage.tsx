import { useRef, useState } from 'react'
import { AlertTriangle, Download, RotateCcw, Save, Settings2, Upload } from 'lucide-react'
import { Button, Field, Modal, PageHeading } from '@/components/ui'
import { api } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { AppSettings, Database } from '@/types'

export function SettingsPage() {
  const { settings, refresh, notify, setDark, dark, participants } = useAppStore()
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const save = (event: React.FormEvent) => { event.preventDefault(); api.saveSettings(form, useAppStore.getState().currentUser?.id); refresh(); notify('Settings saved') }
  const backup = () => {
    const blob = new Blob([api.exportBackup()], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `rangeops-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
    notify('Backup downloaded')
  }
  const restore = async (file?: File) => {
    if (!file) return
    try { const content = JSON.parse(await file.text()) as Database; api.restoreBackup(content); refresh(); setForm(api.settings()); notify('Backup restored successfully') }
    catch (error) { notify(error instanceof Error ? error.message : 'Backup could not be restored') }
  }
  const reset = () => { api.reset(); refresh(); setForm(api.settings()); setConfirmReset(false); notify('Demo data has been reset') }
  return <div className="page">
    <PageHeading eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Configure your event, scan station, and local data." />
    <div className="settings-layout"><form className="settings-main" onSubmit={save}><section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Settings2 size={18} /></span><div><h2>Event details</h2><p>Identity and details used across your range.</p></div></div><Field label="Event name" hint="Displayed in reports and printouts."><input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} required /></Field><Field label="Event logo text" hint="Short monogram used on barcode labels."><input value={form.logoText} onChange={(e) => setForm({ ...form, logoText: e.target.value.toUpperCase().slice(0, 5) })} maxLength={5} /></Field></section>
      <section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Settings2 size={18} /></span><div><h2>Scan station</h2><p>Adjust barcode behavior on the range.</p></div></div><Field label="Duplicate scan window"><select value={form.duplicateWindowSeconds} onChange={(e) => setForm({ ...form, duplicateWindowSeconds: Number(e.target.value) })}><option value={1}>1 second</option><option value={2}>2 seconds</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></Field><label className="toggle-row"><span><b>Audio feedback</b><small>Play a short cue after each scan.</small></span><input type="checkbox" checked={form.scanSound} onChange={(e) => setForm({ ...form, scanSound: e.target.checked })} /></label><label className="toggle-row"><span><b>Dark mode</b><small>Switch to a darker workspace theme.</small></span><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /></label></section>
      <section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><RotateCcw size={18} /></span><div><h2>Barcode labels</h2><p>Set the default format for printable passes.</p></div></div><Field label="Default label size"><select value={form.labelSize} onChange={(e) => setForm({ ...form, labelSize: e.target.value as AppSettings['labelSize'] })}><option value="small">Small · 50 × 30 mm</option><option value="medium">Medium · 70 × 40 mm</option><option value="large">Large · 90 × 50 mm</option></select></Field></section><Button type="submit"><Save size={16} /> Save settings</Button></form>
      <aside className="settings-aside"><section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Download size={18} /></span><div><h2>Local data</h2><p>Your data stays on this device.</p></div></div><div className="data-stat"><span>Registered participants</span><b>{participants.length}</b></div><div className="data-actions"><Button variant="outline" onClick={backup}><Download size={15} /> Download backup</Button><Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Restore from file</Button><input ref={fileRef} type="file" hidden accept=".json,application/json" onChange={(e) => void restore(e.target.files?.[0])} /></div><small className="settings-fineprint">Backup contains participant, user, transaction, settings and audit data as JSON.</small></section><section className="panel settings-card reset-card"><div className="settings-card-title"><span className="settings-card-icon reset-icon"><AlertTriangle size={18} /></span><div><h2>Reset demo data</h2><p>Restore the original sample workspace.</p></div></div><p>This replaces all local data with the original demonstration records. This cannot be undone.</p><Button variant="danger" onClick={() => setConfirmReset(true)}>Reset demo data</Button></section><div className="local-note"><span className="secure-dot" />All information is stored locally in this browser.</div></aside></div>
    {confirmReset && <Modal title="Reset all demo data?" onClose={() => setConfirmReset(false)} footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={reset}><AlertTriangle size={15} /> Reset data</Button></>}><p className="confirm-copy">All participants, users, transactions, and settings will be replaced with the original demo dataset.</p></Modal>}
  </div>
}
