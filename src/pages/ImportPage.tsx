import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, FileUp, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeading } from '@/components/ui'
import { api } from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import { CATEGORIES, DEPARTMENTS, type Participant } from '@/types'

type ParsedRow = { row: number; values: Record<string, string>; error: string }
const required = ['bibNumber', 'noc', 'name', 'department', 'gunNumber', 'contactNumber', 'category']

export function ImportPage() {
  const navigate = useNavigate()
  const { participants, refresh, notify, currentUser } = useAppStore()
  const [step, setStep] = useState(1)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [completeCount, setCompleteCount] = useState(0)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([['bibNumber', 'noc', 'name', 'department', 'gunNumber', 'contactNumber', 'category'], ['141', 'IND', 'Example Participant', DEPARTMENTS[0], 'G-241', '+91 98765 43210', CATEGORIES[0]]])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Participants')
    XLSX.writeFile(book, 'range-participants-template.xlsx')
  }
  const parseFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) { notify('Choose an Excel .xlsx file'); return }
    if (file.size > 10 * 1024 * 1024) { notify('File is larger than the 10 MB upload limit'); return }
    try {
      setFileName(file.name)
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!firstSheet) throw new Error('The workbook does not contain a worksheet.')
      const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
      if (!source.length) { notify('No participant rows found in the first worksheet.'); return }
      const existingBib = new Set(participants.map((p) => p.bibNumber.toLowerCase()))
      const existingGun = new Set(participants.map((p) => p.gunNumber.toLowerCase()))
      const seenBib = new Set<string>()
      const seenGun = new Set<string>()
      setRows(source.map((record, index) => {
        const values = Object.fromEntries(required.map((key) => [key, String(record[key] ?? '').trim()]))
        const errors = required.filter((key) => !values[key]).map((key) => `${key} is required`)
        if (values.noc && (values.noc.length < 2 || values.noc.length > 3)) errors.push('NOC must be 2–3 characters')
        if (values.contactNumber && values.contactNumber.length < 5) errors.push('Contact number is too short')
        if (values.department && !DEPARTMENTS.includes(values.department)) errors.push('Unknown department')
        if (values.category && !CATEGORIES.includes(values.category)) errors.push('Unknown category')
        const bib = values.bibNumber.toLowerCase(), gun = values.gunNumber.toLowerCase()
        if (bib && (existingBib.has(bib) || seenBib.has(bib))) errors.push('Duplicate bib number')
        if (gun && (existingGun.has(gun) || seenGun.has(gun))) errors.push('Duplicate gun number')
        if (bib) seenBib.add(bib)
        if (gun) seenGun.add(gun)
        return { row: index + 2, values, error: errors.join('; ') }
      }))
      setStep(2)
    } catch (error) {
      console.error('Could not parse participant spreadsheet.', error)
      notify(error instanceof Error ? `Could not read spreadsheet: ${error.message}` : 'Could not read spreadsheet')
    }
  }
  const validRows = rows.filter((row) => !row.error)
  const importRows = () => {
    const records = validRows.map((row) => row.values as Omit<Participant, 'id' | 'createdAt' | 'barcodeValue' | 'status'>)
    try { api.importParticipants(records, currentUser?.id) }
    catch (error) { notify(error instanceof Error ? error.message : 'Import could not be completed'); return }
    api.addActivity(currentUser?.id ?? '', 'Imported participants', 'Participant', `${records.length} participants imported from ${fileName}`)
    setCompleteCount(records.length)
    refresh()
    setStep(3)
    notify(`${records.length} participants imported`)
  }
  const downloadErrors = () => {
    const data = rows.filter((row) => row.error).map((row) => ({ row: row.row, ...row.values, error: row.error }))
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), 'Import errors')
    XLSX.writeFile(book, 'participant-import-errors.xlsx')
  }
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); setDragging(false); void parseFile(event.dataTransfer.files[0]) }
  return <div className="page">
    <PageHeading eyebrow="PARTICIPANT DIRECTORY" title="Import participants" description="Add multiple participants at once with a spreadsheet." />
    <div className="import-stepper"><div className={`step-item ${step >= 1 ? 'step-current' : ''} ${step > 1 ? 'step-done' : ''}`}><span>{step > 1 ? <Check size={15} /> : '1'}</span><div><b>Upload file</b><small>Choose a spreadsheet</small></div></div><i className={step > 1 ? 'step-line-done' : ''} /><div className={`step-item ${step >= 2 ? 'step-current' : ''} ${step > 2 ? 'step-done' : ''}`}><span>{step > 2 ? <Check size={15} /> : '2'}</span><div><b>Review data</b><small>Validate your rows</small></div></div><i className={step > 2 ? 'step-line-done' : ''} /><div className={`step-item ${step >= 3 ? 'step-current' : ''}`}><span>{step > 2 ? <Check size={15} /> : '3'}</span><div><b>Complete</b><small>Finish import</small></div></div></div>
    {step === 1 && <section className="panel import-panel"><div className="import-section-title"><div><h2>Upload participant spreadsheet</h2><p>Start with a blank template or upload your own .xlsx file.</p></div><Button variant="outline" onClick={downloadTemplate}><Download size={16} /> Download template</Button></div><button className={`drop-zone ${dragging ? 'drop-active' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()}><span className="upload-mark"><FileUp size={22} /></span><strong>Drop your spreadsheet here</strong><span>or <b>browse files</b> from your device</span><small>Excel workbook · .xlsx or .xls · Up to 10 MB</small><input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void parseFile(e.target.files?.[0])} /></button><div className="import-hint"><AlertCircle size={17} /><p><b>Before you upload</b><br />Keep the column headers from the template. Bib and gun numbers must be unique across the event.</p></div></section>}
    {step === 2 && <section className="panel import-panel"><div className="import-section-title"><div><h2>Review your data</h2><p>Check for missing details and duplicate bib or gun numbers.</p></div><span className="file-name"><FileSpreadsheet size={17} />{fileName}</span></div><div className="import-summary"><span className="summary-valid"><Check size={15} /><b>{validRows.length}</b> valid rows</span><span className="summary-invalid"><AlertCircle size={15} /><b>{rows.length - validRows.length}</b> rows need attention</span><span className="summary-total">{rows.length} total</span></div><div className="table-scroll preview-table"><table className="data-table"><thead><tr><th>Row</th><th>Bib no.</th><th>NOC</th><th>Name</th><th>Department</th><th>Gun no.</th><th>Category</th><th>Validation</th></tr></thead><tbody>{rows.map((row) => <tr key={row.row} className={row.error ? 'row-invalid' : ''}><td>{row.row}</td><td>{row.values.bibNumber}</td><td>{row.values.noc}</td><td>{row.values.name}</td><td>{row.values.department}</td><td>{row.values.gunNumber}</td><td>{row.values.category}</td><td>{row.error ? <span className="validation-error"><X size={14} />{row.error}</span> : <span className="validation-ok"><Check size={14} />Ready</span>}</td></tr>)}</tbody></table></div><div className="import-actions"><Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</Button>{rows.some((row) => row.error) && <Button variant="outline" onClick={downloadErrors}><Download size={15} /> Download error report</Button>}<Button disabled={!validRows.length} onClick={importRows}>Import {validRows.length} valid rows <ArrowRight size={15} /></Button></div></section>}
    {step === 3 && <section className="panel import-complete"><span className="complete-check"><Check size={25} /></span><h2>Import complete</h2><p><b>{completeCount}</b> participants are now in your range register.</p><div className="import-complete-actions"><Button variant="secondary" onClick={() => { setStep(1); setRows([]); setFileName('') }}><Upload size={15} /> Import another file</Button><Button onClick={() => navigate('/participants')}>View participants <ArrowRight size={15} /></Button></div></section>}
  </div>
}
