import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { Check, Printer, Search, SlidersHorizontal, UserRound } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Button, PageHeading } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { useRangeData } from '@/hooks/useRangeData'
import { CATEGORIES, type Participant } from '@/types'
import { api, printingApi } from '@/services'

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => { if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', width: 1.3, height: 40, displayValue: false, margin: 0, background: 'transparent', lineColor: '#15263a' }) }, [value])
  return <svg ref={ref} className="barcode-svg" role="img" aria-label={`Code 128 barcode ${value}`} />
}

export function BarcodesPage() {
  const { refresh, notify } = useAppStore()
  const [searchParams] = useSearchParams()
  const [selected, setSelected] = useState<string[]>(() => searchParams.get('selected')?.split(',').filter(Boolean) ?? [])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [selectionMode, setSelectionMode] = useState<'filter' | 'unprinted' | null>(null)
  const [fields, setFields] = useState(['noc', 'gunNumber', 'category'])
  const { participants, participantTotal, participantError, settings, loading } = useRangeData({
    search: debouncedSearch, category: category || undefined, limit: 100, page: 0,
  })
  const [size, setSize] = useState(settings.labelSize)
  const [labelsPerRow, setLabelsPerRow] = useState(3)
  const [labelSummary, setLabelSummary] = useState<{ total: number; printed: number; unprinted: number; stale: number } | null>(null)
  const filtered = participants
  const [selectedDetails, setSelectedDetails] = useState<Participant[]>([])
  const chosen: Participant[] = selected.map((id) => participants.find((item) => item.id === id) ?? selectedDetails.find((item) => item.id === id)).filter((item): item is Participant => !!item)
  const allSelected = selectionMode === 'filter'
  const selectionCount = selectionMode === 'filter' ? participantTotal : selectionMode === 'unprinted' ? labelSummary?.unprinted ?? 0 : chosen.length
  const rowsPerPage = size === 'large' ? 4 : size === 'medium' ? 6 : 8
  const pageSize = labelsPerRow * rowsPerPage
  const labelPages = Array.from({ length: Math.ceil(chosen.length / pageSize) }, (_, index) => chosen.slice(index * pageSize, (index + 1) * pageSize))
  const toggleField = (field: string) => setFields((old) => old.includes(field) ? old.filter((item) => item !== field) : [...old, field])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    let active = true
    if (!category) { setCategoryId(undefined); return }
    void api.categories().then((items) => {
      if (active) setCategoryId(items.find((item) => item.name === category)?.id)
    }).catch((error) => { if (active) notify(error instanceof Error ? error.message : 'Could not load categories.') })
    return () => { active = false }
  }, [category, notify])
  useEffect(() => {
    const missing = selected.filter((id) => !participants.some((item) => item.id === id) && !selectedDetails.some((item) => item.id === id))
    if (!missing.length) return
    let active = true
    void Promise.all(missing.map((id) => api.getParticipant(id))).then((items) => {
      if (active) setSelectedDetails((current) => [...current, ...items.map((item) => item.participant)])
    }).catch((error) => { if (active) notify(error instanceof Error ? error.message : 'Could not load selected participants.') })
    return () => { active = false }
  }, [selected, participants, selectedDetails, notify])
  useEffect(() => {
    let active = true
    void printingApi.getSummary().then((summary) => { if (active) setLabelSummary(summary) })
      .catch((error) => { if (active) notify(error instanceof Error ? error.message : 'Could not load label data.') })
    return () => { active = false }
  }, [selected, notify])
  const print = async () => {
    if (!selectionCount) return
    try {
      const selection = selectionMode === 'filter'
        ? { type: 'filter' as const, filter: { search: debouncedSearch || undefined, categoryId } }
        : selectionMode === 'unprinted'
          ? { type: 'unprinted' as const }
          : { type: 'ids' as const, ids: chosen.map((item) => Number(item.id)) }
      const result = await printingApi.printLabels({ selection })
      await refresh()
      notify(`${result.count} label${result.count === 1 ? '' : 's'} sent to the printer`)
      setSelectionMode(null)
      setSelected([])
      setLabelSummary(await printingApi.getSummary())
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not print labels.') }
  }
  if (loading) return <div className="page data-skeleton" role="status" aria-label="Loading barcode data"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-panel" /><span>Loading barcode data…</span></div>
  return <div className="page">
    <PageHeading eyebrow="PRINT & IDENTIFY" title="Barcode labels" description={labelSummary ? `${labelSummary.unprinted} unprinted · ${labelSummary.stale} need reprint` : 'Create scannable Code128 pouch labels for your participants.'} actions={<Button onClick={() => void print()} disabled={!selectionCount || (selectionMode === 'filter' && !!category && categoryId === undefined)}><Printer size={16} /> Print labels {selectionCount > 0 && `(${selectionCount})`}</Button>} />
    <div className="barcode-layout">
      <section className="panel selector-panel"><div className="panel-heading"><div><h2>Select participants</h2><p>{participantTotal} participants available</p></div><SlidersHorizontal size={17} /></div>{participantError && <div className="login-error" role="alert">Could not load participants: {participantError}</div>}<div className="selector-tools"><div className="search-box"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search participants..." aria-label="Search participants" /></div><select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category"><option value="">All categories</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><button className="select-all" onClick={() => { setSelectionMode(allSelected ? null : 'filter'); setSelected([]) }}>{allSelected ? 'Clear selection' : 'Select filtered'}</button><button className="select-all" onClick={() => { setSelectionMode(selectionMode === 'unprinted' ? null : 'unprinted'); setSelected([]) }}>Not yet printed</button></div><div className="participant-selector">{filtered.map((p) => <label key={p.id} className={`selector-item ${selected.includes(p.id) ? 'selector-selected' : ''}`}><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => { setSelectionMode(null); setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id)) }} /><span className="table-avatar">{p.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="selector-name"><b>{p.name}</b><small>Bib {p.bibNumber} · {p.category}</small></span>{selected.includes(p.id) && <Check size={16} />}</label>)}</div></section>
      <div className="barcode-settings"><section className="panel setting-card"><div className="panel-heading"><div><h2>Label settings</h2><p>Customize your print layout</p></div></div><label className="form-field"><span>Label size</span><select value={size} onChange={(e) => setSize(e.target.value as 'small' | 'medium' | 'large')}><option value="small">Small · 50 × 30 mm</option><option value="medium">Medium · 70 × 40 mm</option><option value="large">Large · 90 × 50 mm</option></select></label><label className="form-field label-row-select"><span>Labels per row</span><select value={labelsPerRow} onChange={(e) => setLabelsPerRow(Number(e.target.value))}><option value={2}>2 labels</option><option value={3}>3 labels</option><option value={4}>4 labels</option></select></label><div className="field-label">Show fields</div>{[['noc', 'NOC'], ['gunNumber', 'Gun number'], ['category', 'Category']].map(([field, label]) => <label className="field-checkbox" key={field}><input type="checkbox" checked={fields.includes(field)} onChange={() => toggleField(field)} />{label}</label>)}</section><section className="label-preview-wrap"><div className="preview-label"><div className="preview-label-top"><div className="label-brand"><span>{settings.logoText}</span><small>RANGE PASS</small></div><span className="label-bib">BIB {chosen[0]?.bibNumber ?? '—'}</span></div><strong>{chosen[0]?.name ?? 'Participant name'}</strong><div className="label-info">{fields.includes('noc') && <span>{chosen[0]?.noc ?? 'NOC'}</span>}{fields.includes('gunNumber') && <span>Gun {chosen[0]?.gunNumber ?? '—'}</span>}{fields.includes('category') && <span>{chosen[0]?.category ?? 'Category'}</span>}</div><Barcode value={chosen[0]?.barcodeValue ?? 'SR00000'} /></div><div className="preview-caption"><UserRound size={14} /> Live preview {chosen.length > 1 && <span>· {chosen.length} labels selected</span>}</div></section></div>
    </div>
    <div className="print-labels">{labelPages.map((labelPage, pageIndex) => <section className="print-sheet" key={pageIndex} style={{ gridTemplateColumns: `repeat(${labelsPerRow}, 1fr)` }}>{labelPage.map((p) => <article key={p.id} className={`print-label print-${size}`}><div className="print-label-top"><b>{settings.logoText} <small>RANGE PASS</small></b><span>BIB {p.bibNumber}</span></div><strong>{p.name}</strong><div>{fields.includes('noc') && <span>{p.noc}</span>}{fields.includes('gunNumber') && <span>Gun {p.gunNumber}</span>}{fields.includes('category') && <span>{p.category}</span>}</div><Barcode value={p.barcodeValue} /></article>)}</section>)}</div>
  </div>
}
