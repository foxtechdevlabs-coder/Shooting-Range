import { useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, FileUp, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeading } from '@/components/ui'
import { api } from '@/services'
import { useAppStore } from '@/store/useAppStore'

type ParsedRow = { row: number; values: Record<string, string>; error: string }
export function ImportPage() {
  const navigate = useNavigate()
  const { refresh, notify } = useAppStore()
  const [step, setStep] = useState(1)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [completeCount, setCompleteCount] = useState(0)
  const [previewId, setPreviewId] = useState('')
  const [importMode, setImportMode] = useState<'skip' | 'update'>('skip')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const downloadTemplate = () => void api.getImportTemplate().catch((error) => notify(error instanceof Error ? error.message : 'Could not download template.'))
  const parseFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) { notify('Choose an Excel .xlsx file'); return }
    if (file.size > 10 * 1024 * 1024) { notify('File is larger than the 10 MB upload limit'); return }
    try {
      setFileName(file.name)
      const preview = await api.previewImport(file)
      setPreviewId(preview.previewId)
      const toValues = (value: { bib_number?: string; noc?: string; name?: string; department?: string | null; gun_number?: string; contact_number?: string | null; category?: string; category_name?: string | null }) => ({
        bibNumber: value.bib_number ?? '', noc: value.noc ?? '', name: value.name ?? '',
        department: value.department ?? '', gunNumber: value.gun_number ?? '',
        contactNumber: value.contact_number ?? '', category: value.category ?? value.category_name ?? '',
      })
      setRows([
        ...preview.valid.map((value, index) => ({ row: 'row' in value && typeof value.row === 'number' ? value.row : index + 2, values: toValues(value), error: '' })),
        ...preview.errors.map((item) => ({ row: item.row, values: toValues(item.values), error: item.reasons.join('; ') })),
      ].sort((a, b) => a.row - b.row))
      setStep(2)
    } catch (error) {
      console.error('Could not parse participant spreadsheet.', error)
      notify(error instanceof Error ? `Could not read spreadsheet: ${error.message}` : 'Could not read spreadsheet')
    }
  }
  const validRows = rows.filter((row) => !row.error)
  const importRows = async () => {
    try {
      const result = await api.commitImport(previewId, importMode)
      setCompleteCount(result.imported + result.updated)
      await refresh()
      setStep(3)
      notify(`${result.imported} participants imported${result.updated ? `, ${result.updated} updated` : ''}`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Import could not be completed') }
  }
  const downloadErrors = () => void api.downloadImportErrors(previewId).catch((error) => notify(error instanceof Error ? error.message : 'Could not download error report.'))
  const onDrop = (event: React.DragEvent) => { event.preventDefault(); setDragging(false); void parseFile(event.dataTransfer.files[0]) }
  return <div className="page">
    <PageHeading eyebrow="PARTICIPANT DIRECTORY" title="Import participants" description="Add multiple participants at once with a spreadsheet." />
    <div className="import-stepper"><div className={`step-item ${step >= 1 ? 'step-current' : ''} ${step > 1 ? 'step-done' : ''}`}><span>{step > 1 ? <Check size={15} /> : '1'}</span><div><b>Upload file</b><small>Choose a spreadsheet</small></div></div><i className={step > 1 ? 'step-line-done' : ''} /><div className={`step-item ${step >= 2 ? 'step-current' : ''} ${step > 2 ? 'step-done' : ''}`}><span>{step > 2 ? <Check size={15} /> : '2'}</span><div><b>Review data</b><small>Validate your rows</small></div></div><i className={step > 2 ? 'step-line-done' : ''} /><div className={`step-item ${step >= 3 ? 'step-current' : ''}`}><span>{step > 2 ? <Check size={15} /> : '3'}</span><div><b>Complete</b><small>Finish import</small></div></div></div>
    {step === 1 && <section className="panel import-panel"><div className="import-section-title"><div><h2>Upload participant spreadsheet</h2><p>Start with a blank template or upload your own .xlsx file.</p></div><Button variant="outline" onClick={downloadTemplate}><Download size={16} /> Download template</Button></div><button className={`drop-zone ${dragging ? 'drop-active' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()}><span className="upload-mark"><FileUp size={22} /></span><strong>Drop your spreadsheet here</strong><span>or <b>browse files</b> from your device</span><small>Excel workbook · .xlsx or .xls · Up to 10 MB</small><input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void parseFile(e.target.files?.[0])} /></button><div className="import-hint"><AlertCircle size={17} /><p><b>Before you upload</b><br />Keep the column headers from the template. Bib and gun numbers must be unique across the event.</p></div></section>}
    {step === 2 && <section className="panel import-panel"><div className="import-section-title"><div><h2>Review your data</h2><p>Check for missing details and duplicate bib or gun numbers.</p></div><span className="file-name"><FileSpreadsheet size={17} />{fileName}</span></div><div className="import-summary"><span className="summary-valid"><Check size={15} /><b>{validRows.length}</b> valid rows</span><span className="summary-invalid"><AlertCircle size={15} /><b>{rows.length - validRows.length}</b> rows need attention</span><span className="summary-total">{rows.length} total</span></div><div className="table-scroll preview-table"><table className="data-table"><thead><tr><th>Row</th><th>Bib no.</th><th>NOC</th><th>Name</th><th>Department</th><th>Gun no.</th><th>Category</th><th>Validation</th></tr></thead><tbody>{rows.map((row) => <tr key={row.row} className={row.error ? 'row-invalid' : ''}><td>{row.row}</td><td>{row.values.bibNumber}</td><td>{row.values.noc}</td><td>{row.values.name}</td><td>{row.values.department}</td><td>{row.values.gunNumber}</td><td>{row.values.category}</td><td>{row.error ? <span className="validation-error"><X size={14} />{row.error}</span> : <span className="validation-ok"><Check size={14} />Ready</span>}</td></tr>)}</tbody></table></div><div className="import-actions"><Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</Button>{rows.some((row) => row.error) && <Button variant="outline" onClick={downloadErrors}><Download size={15} /> Download error report</Button>}<label className="form-field"><span>When bib already exists</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as 'skip' | 'update')}><option value="skip">Skip existing</option><option value="update">Update existing</option></select></label><Button disabled={!validRows.length} onClick={importRows}>Import {validRows.length} valid rows <ArrowRight size={15} /></Button></div></section>}
    {step === 3 && <section className="panel import-complete"><span className="complete-check"><Check size={25} /></span><h2>Import complete</h2><p><b>{completeCount}</b> participants are now in your range register.</p><div className="import-complete-actions"><Button variant="secondary" onClick={() => { setStep(1); setRows([]); setFileName('') }}><Upload size={15} /> Import another file</Button><Button onClick={() => navigate('/participants')}>View participants <ArrowRight size={15} /></Button></div></section>}
  </div>
}
