import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FolderOpen, HardDriveDownload, Info, RotateCcw, Save, Settings2, Upload } from 'lucide-react'
import { Button, Field, Modal, PageHeading } from '@/components/ui'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'
import type { AppSettings } from '@/types'
import { useRangeData } from '@/hooks/useRangeData'
import { exportLogs, isDesktop, selectFolder, showItemInFolder } from '@/services/desktop'

type BackupStatus = Awaited<ReturnType<typeof api.backupStatus>>

export function SettingsPage() {
  const { settings, participantTotal, loading } = useRangeData()
  const { refresh, notify, setDark, dark } = useAppStore()
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDemo, setConfirmDemo] = useState(false)
  const [working, setWorking] = useState(false)
  const [appInfo, setAppInfo] = useState<Awaited<ReturnType<typeof api.appInfo>> | null>(null)
  const [exportingLogs, setExportingLogs] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setForm({ ...settings }), [settings])
  useEffect(() => {
    let active = true
    void api.appInfo().then((info) => { if (active) setAppInfo(info) })
      .catch(() => { /* About card is optional */ })
    return () => { active = false }
  }, [])
  useEffect(() => {
    void api.backupStatus().then((status) => {
      setBackupStatus(status)
      setForm((current) => current.backupFolder ? current : { ...current, backupFolder: status.backupFolder })
    }).catch((error) => notify(error instanceof Error ? error.message : 'Could not load backup status.'))
  }, [notify])

  const chooseBackupFolder = async () => {
    const folder = await selectFolder({ title: 'Choose the automatic backup folder', defaultPath: form.backupFolder ?? undefined })
    if (!folder) return
    setForm((current) => ({ ...current, backupFolder: folder }))
    notify('Backup folder selected. Save settings to apply it.')
  }
  const exportSupportLogs = async () => {
    if (!isDesktop()) { notify('Support log export is available in the desktop app only.'); return }
    setExportingLogs(true)
    try {
      const result = await exportLogs()
      if (result.cancelled) return
      notify(result.ok ? `Support logs exported to ${result.destination}` : (result.error ?? 'Could not export support logs.'))
    } finally { setExportingLogs(false) }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const saved = await api.saveSettings(form)
      setForm(saved)
      refresh()
      notify('Settings saved')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save settings.') }
  }
  const refreshBackupStatus = async () => {
    const status = await api.backupStatus()
    setBackupStatus(status)
  }
  const createBackup = async () => {
    setWorking(true)
    try {
      const result = await api.createBackup()
      await refreshBackupStatus()
      notify(`Backup saved: ${result.filename}`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create backup.') }
    finally { setWorking(false) }
  }
  const downloadBackup = async () => {
    try { await api.downloadBackup(); notify('Backup downloaded.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not download backup.') }
  }
  const restore = async () => {
    if (!restoreFile || restoreConfirmation !== 'RESTORE') return
    setWorking(true)
    try {
      const result = await api.restoreBackup(restoreFile, restoreConfirmation)
      notify(`Backup restored. Pre-restore backup: ${result.preRestoreBackup}`)
      setRestoreFile(null)
      setRestoreConfirmation('')
      if (fileRef.current) fileRef.current.value = ''
      window.location.assign('/login')
    } catch (error) { notify(error instanceof Error ? error.message : 'Backup could not be restored.') }
    finally { setWorking(false) }
  }
  const exportAll = async () => {
    try { await api.exportAll(); notify('All data exported.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not export data.') }
  }
  const reset = async () => {
    setWorking(true)
    try {
      await api.resetDemo()
      setConfirmReset(false)
      notify('Demo data has been reset. Sign in again to continue.')
      window.location.assign('/login')
    } catch (error) { setConfirmReset(false); notify(error instanceof Error ? error.message : 'Could not reset demo data.') }
    finally { setWorking(false) }
  }
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading settings"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading settings…</span></div>
  const manualBackupDue = !backupStatus?.lastManualBackupAt || (backupStatus.hoursSinceManualBackup ?? 25) >= 24
  return <div className="page">
    <PageHeading eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Configure your event, scan station, and server-managed data." />
    {manualBackupDue && <div className="server-error" role="status">A manual database backup has not been made in the last 24 hours.</div>}
    <div className="settings-layout"><form className="settings-main" onSubmit={save}><section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Settings2 size={18} /></span><div><h2>Event details</h2><p>Identity and details used across your range.</p></div></div><Field label="Event name" hint="Displayed in reports and printouts."><input value={form.eventName} onChange={(event) => setForm({ ...form, eventName: event.target.value })} required /></Field><Field label="Event logo text" hint="Short monogram used on barcode labels."><input value={form.logoText} onChange={(event) => setForm({ ...form, logoText: event.target.value.toUpperCase().slice(0, 5) })} maxLength={5} /></Field></section>
      <section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Settings2 size={18} /></span><div><h2>Scan station</h2><p>Adjust barcode behavior on the range.</p></div></div><Field label="Duplicate scan window"><select value={form.duplicateWindowSeconds} onChange={(event) => setForm({ ...form, duplicateWindowSeconds: Number(event.target.value) })}><option value={1}>1 second</option><option value={2}>2 seconds</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></Field><label className="toggle-row"><span><b>Audio feedback</b><small>Play a short cue after each scan.</small></span><input type="checkbox" checked={form.scanSound} onChange={(event) => setForm({ ...form, scanSound: event.target.checked })} /></label><label className="toggle-row"><span><b>Dark mode</b><small>Switch to a darker workspace theme.</small></span><input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} /></label></section>
      <section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><RotateCcw size={18} /></span><div><h2>Barcode labels</h2><p>Set the default format for printable passes.</p></div></div><Field label="Default label size"><select value={form.labelSize} onChange={(event) => setForm({ ...form, labelSize: event.target.value as AppSettings['labelSize'] })}><option value="small">Small · 50 × 30 mm</option><option value="medium">Medium · 70 × 40 mm</option><option value="large">Large · 90 × 50 mm</option></select></Field></section>
      <Button type="submit"><Save size={16} /> Save settings</Button></form>
      <aside className="settings-aside"><section className="panel settings-card"><div className="settings-card-title"><span className="settings-card-icon"><Download size={18} /></span><div><h2>Workspace data</h2><p>Database backups and exports are managed by the server.</p></div></div><div className="data-stat"><span>Registered participants</span><b>{participantTotal}</b></div><div className="data-stat"><span>Last manual backup</span><b>{backupStatus?.lastManualBackupAt ? new Date(backupStatus.lastManualBackupAt).toLocaleString() : 'Never'}</b></div><div className="data-stat"><span>Last automatic backup</span><b>{backupStatus?.lastAutomaticBackupAt ? new Date(backupStatus.lastAutomaticBackupAt).toLocaleString() : 'Not yet created'}</b></div><Field label="Automatic backup folder" hint={isDesktop() ? 'Pick a folder (for example on a pen drive) or type an absolute path.' : 'An absolute, existing server folder path.'}><div className="input-with-button"><input value={form.backupFolder ?? backupStatus?.backupFolder ?? ''} onChange={(event) => setForm({ ...form, backupFolder: event.target.value })} />{isDesktop() && <Button variant="outline" type="button" onClick={() => void chooseBackupFolder()}><FolderOpen size={15} /> Choose…</Button>}</div></Field><div className="data-actions"><Button variant="outline" onClick={() => void createBackup()} disabled={working}><Save size={15} /> Backup now</Button>{isDesktop() && <Button variant="outline" onClick={() => void showItemInFolder(appInfo?.dataDir ?? '')} disabled={!appInfo?.dataDir}><FolderOpen size={15} /> Open data folder</Button>}<Button variant="outline" onClick={() => void downloadBackup()}><Download size={15} /> Download backup</Button><Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Restore from file</Button><Button variant="secondary" onClick={() => void exportAll()}><Download size={15} /> Export all data</Button><input ref={fileRef} type="file" hidden accept=".db,application/x-sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setRestoreFile(file); setRestoreConfirmation('') } }} /></div><small className="settings-fineprint">Automatic daily and shutdown backups are kept for 14 days. Restore validates the database and creates a pre-restore backup.</small></section>
      {backupStatus?.allowDemoReset && <section className="panel settings-card reset-card"><div className="settings-card-title"><span className="settings-card-icon reset-icon"><AlertTriangle size={18} /></span><div><h2>Demo data</h2><p>Optional sample data for training.</p></div></div><p>Load the demonstration dataset (sample participants and transactions) into this installation. Packaged installs start empty unless you choose this.</p><Button variant="danger" onClick={() => setConfirmDemo(true)}><Database size={15} /> Load demo data</Button></section>}

      <section className="panel settings-card about-card"><div className="settings-card-title"><span className="settings-card-icon"><Info size={18} /></span><div><h2>About</h2><p>Version and storage locations on this computer.</p></div></div><div className="data-stat"><span>Application version</span><b>{appInfo?.version ?? '—'}</b></div><div className="data-stat"><span>Print driver</span><b>{appInfo?.printDriver === 'windows' ? `Windows spooler${appInfo?.printerName ? ` · ${appInfo.printerName}` : ''}` : 'File (labels folder)'}</b></div><Field label="Data folder" hint="The database, backups, label files and logs live here. It is never touched by upgrades or uninstall."><div className="input-with-button"><input readOnly value={appInfo?.dataDir ?? 'Loading…'} /><Button variant="outline" type="button" disabled={!appInfo?.dataDir || !isDesktop()} onClick={() => void showItemInFolder(appInfo?.dataDir ?? '')}><FolderOpen size={15} /> Open</Button></div></Field>{isDesktop() && <div className="data-actions"><Button variant="outline" onClick={() => void exportSupportLogs()} disabled={exportingLogs}><HardDriveDownload size={15} /> {exportingLogs ? 'Exporting…' : 'Export support logs'}</Button></div>}<small className="settings-fineprint">If you need help, export the support logs to a pen drive and send them with your description of the problem. Logs never contain passwords.</small></section><div className="local-note"><span className="secure-dot" />Application data is stored in the server database.</div></aside></div>
    {restoreFile && <Modal title="Restore database backup?" onClose={() => { setRestoreFile(null); setRestoreConfirmation('') }} footer={<><Button variant="secondary" onClick={() => { setRestoreFile(null); setRestoreConfirmation('') }}>Cancel</Button><Button variant="danger" disabled={restoreConfirmation !== 'RESTORE' || working} onClick={() => void restore()}><Upload size={15} /> Restore database</Button></>}><p className="confirm-copy">Restoring <b>{restoreFile.name}</b> replaces the current database. A pre-restore backup will be created first.</p><Field label='Type "RESTORE" to confirm'><input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} autoComplete="off" /></Field></Modal>}
    {confirmDemo && <Modal title="Load demo data?" onClose={() => setConfirmDemo(false)} footer={<><Button variant="secondary" onClick={() => setConfirmDemo(false)}>Cancel</Button><Button variant="danger" disabled={working} onClick={() => { setConfirmDemo(false); setConfirmReset(true) }}><Database size={15} /> Continue</Button></>}><p className="confirm-copy">This replaces all current participants, transactions, corrections and settings with the sample dataset. Intended for training and demonstrations only. Your current database is backed up first if a backup folder is configured.</p></Modal>}
    {confirmReset && <Modal title="Load demo data and replace everything?" onClose={() => setConfirmReset(false)} footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" disabled={working} onClick={() => void reset()}><AlertTriangle size={15} /> Replace with demo data</Button></>}><p className="confirm-copy">All participants, users, transactions, corrections, and settings will be replaced with the seeded demo dataset. You will be signed out.</p></Modal>}
  </div>
}
