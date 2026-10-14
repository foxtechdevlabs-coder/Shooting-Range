import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Keyboard, ScanLine, Search, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react'
import { Button, PageHeading, StatusPill } from '@/components/ui'
import { api } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type { Participant, Transaction } from '@/types'

type ScanResult = { participant?: Participant; transaction?: Transaction; error?: string; duplicate?: boolean }
export function ScanPage() {
  const { participants, transactions, users, settings, currentUser, refresh, notify } = useAppStore()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [manual, setManual] = useState('')
  const [soundOn, setSoundOn] = useState(settings.scanSound)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastScan = useRef<{ value: string; time: number }>({ value: '', time: 0 })
  const gunsOut = participants.filter((p) => p.status === 'out').length
  const beep = (success: boolean) => {
    if (!soundOn) return
    try {
      const audio = new AudioContext()
      const oscillator = audio.createOscillator(), gain = audio.createGain()
      oscillator.connect(gain); gain.connect(audio.destination)
      oscillator.frequency.value = success ? 740 : 220
      gain.gain.value = 0.08
      oscillator.start()
      oscillator.stop(audio.currentTime + (success ? 0.12 : 0.28))
      oscillator.onended = () => void audio.close()
    } catch (error) { console.error('Scan sound could not be played.', error) }
  }
  const process = (value: string) => {
    const normalized = value.trim()
    if (!normalized || busy) return
    const now = Date.now()
    if (normalized.toLowerCase() === lastScan.current.value.toLowerCase() && now - lastScan.current.time < settings.duplicateWindowSeconds * 1000) {
      setResult({ duplicate: true, error: 'Duplicate scan ignored. Please wait before scanning this code again.' })
      setCode('')
      return
    }
    lastScan.current = { value: normalized, time: now }
    setBusy(true)
    const scanned = api.scanParticipant(normalized, currentUser?.id ?? '')
    setResult(scanned)
    if (scanned.error) notify(scanned.error)
    beep(!!scanned.participant)
    refresh()
    setCode('')
    setBusy(false)
    inputRef.current?.focus()
  }
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const keepFocus = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('input,button,select,a')) inputRef.current?.focus()
    }
    window.addEventListener('pointerdown', keepFocus)
    return () => window.removeEventListener('pointerdown', keepFocus)
  }, [])
  const latest = transactions.slice(0, 20)
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Range staff'
  return <div className="page scan-page">
    <PageHeading eyebrow="LIVE RANGE OPERATIONS" title="Scan station" description="Scan a participant’s barcode to check their firearm in or out." actions={<button className={`sound-toggle ${soundOn ? 'sound-enabled' : ''}`} onClick={() => setSoundOn(!soundOn)}>{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}{soundOn ? 'Sound on' : 'Sound off'}</button>} />
    <div className="scan-counters"><div><span className="counter-icon counter-amber"><ArrowUpRight size={18} /></span><div><small>Guns checked out</small><b>{gunsOut}</b></div><span className="counter-caption">ON THE RANGE</span></div><div><span className="counter-icon counter-green"><ArrowDownLeft size={18} /></span><div><small>Guns checked in</small><b>{participants.length - gunsOut}</b></div><span className="counter-caption">IN THE ARMORY</span></div><div><span className="scan-live-dot" /><div><small>Station status</small><b className="online-label">Ready to scan</b></div><span className="counter-caption">LIVE</span></div></div>
    <div className="scan-layout"><section className="panel scanner-panel"><div className="scan-kicker"><span className="scan-pulse"><ScanLine size={17} /></span><span>BARCODE SCANNER</span><i><span /> READY</i></div><h2>Scan participant pass</h2><p className="scanner-instructions">Position the barcode inside the scanner. It will be checked in or out automatically.</p><form onSubmit={(e) => { e.preventDefault(); process(code) }}><label className="scan-input-wrap"><ScanLine size={20} /><input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Waiting for barcode..." aria-label="Scan barcode" autoComplete="off" autoFocus /><kbd>ENTER</kbd></label></form><div className="scan-divider"><span>OR ENTER MANUALLY</span></div><form className="manual-entry" onSubmit={(e) => { e.preventDefault(); process(manual); setManual('') }}><div className="search-box"><Search size={16} /><input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Bib number or gun number" aria-label="Manual lookup" /></div><Button variant="secondary" type="submit">Look up</Button></form>
      {result?.participant && <div className={`scan-result result-${result.transaction?.type === 'check-in' ? 'in' : 'out'}`} role="status"><span className="result-status-icon"><Check size={25} /></span><div className="result-content"><div className="result-status">{result.transaction?.type === 'check-in' ? 'FIREARM CHECKED IN' : 'FIREARM CHECKED OUT'}</div><h3>{result.participant.name}</h3><p><span>BIB {result.participant.bibNumber}</span><span>{result.participant.noc}</span><span>{result.participant.category}</span></p><div className="result-foot"><span>Gun <b>{result.participant.gunNumber}</b></span><StatusPill status={result.participant.status} /><span>{new Date(result.transaction!.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div></div><button onClick={() => { setResult(null); inputRef.current?.focus() }} aria-label="Dismiss scan result"><X size={16} /></button></div>}
      {result?.error && <div className={`scan-error ${result.duplicate ? '' : 'scan-unknown'}`} role="alert"><span>{result.duplicate ? <Clock3 size={19} /> : <X size={19} />}</span><div><b>{result.duplicate ? 'Duplicate scan' : 'Participant not found'}</b><p>{result.error}</p></div><button onClick={() => { setResult(null); inputRef.current?.focus() }} aria-label="Dismiss message"><X size={15} /></button></div>}
      {!result && <div className="scanner-hint"><Keyboard size={16} /><span>USB barcode scanners work like a keyboard. Scan and press Enter.</span></div>}
    </section>
    <section className="panel live-feed"><div className="panel-heading"><div><h2>Live activity</h2><p>Latest firearm movements</p></div><span className="live-indicator"><i />LIVE</span></div><div className="feed-list">{latest.map((transaction) => { const p = participants.find((person) => person.id === transaction.participantId); return <div className="feed-item" key={transaction.id}><span className={`feed-icon ${transaction.type === 'check-in' ? 'feed-in' : 'feed-out'}`}>{transaction.type === 'check-in' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><div><b>{p?.name ?? 'Participant removed'}</b><span>{transaction.type === 'check-in' ? 'Checked in' : 'Checked out'} · {p?.gunNumber ?? '—'}</span><small>{userName(transaction.performedBy)}</small></div><time>{new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div> })}{latest.length === 0 && <div className="feed-empty"><ShieldCheck size={25} /><b>All clear</b><span>Transactions will appear here as participants scan in and out.</span></div>}</div><footer className="feed-footer"><span><i /> Station active</span><span>{latest.length} recent events</span></footer></section></div>
  </div>
}
