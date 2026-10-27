import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { IMPORT_TEMPLATE, downloadCsv, parseCsv, toImportRows } from './csv'
import { importContacts } from './dealsApi'
import type { ImportResult, ImportRow } from './dealsApi'

const MAX = 500

/**
 * Bring a spreadsheet in: choose a CSV file (export from Excel or Google Sheets), see what DOA understood before anything is saved, then import. Columns are matched by
 * their headings (Phone, Mobile and Phone Number all work), contacts already in DOA (same email or phone) are skipped, and the result says exactly what happened.
 */
export function ImportDialog({ businessId, kind, onClose, onDone }: { businessId: string; kind: 'customers' | 'leads'; onClose: () => void; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[]>([]); const [ignored, setIgnored] = useState<string[]>([]); const [fileName, setFileName] = useState('')
  const [problem, setProblem] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [result, setResult] = useState<ImportResult | null>(null)
  const noun = kind === 'customers' ? 'customers' : 'leads'

  async function choose(file: File | undefined) {
    setProblem(null); setResult(null); setRows([]); setIgnored([])
    if (!file) return
    if (!/\.(csv|txt)$/i.test(file.name)) return setProblem('Choose a CSV file. In Excel or Google Sheets, use File, Save as or Download, CSV.')
    setFileName(file.name)
    const parsed = toImportRows(parseCsv(await file.text()))
    if (parsed.missingName) return setProblem('The first row needs a heading called Name (or Full name, Customer or Contact). Download the template to see the layout.')
    if (!parsed.rows.length) return setProblem('The file has headings but no rows.')
    if (parsed.rows.length > MAX) return setProblem(`This file has ${parsed.rows.length} rows. Import up to ${MAX} at a time: split it into smaller files.`)
    setRows(parsed.rows); setIgnored(parsed.ignored)
  }

  async function run() {
    setBusy(true); setProblem(null)
    const r = await importContacts(businessId, kind, rows)
    setBusy(false)
    if (r.error) return setProblem(r.error)
    setResult(r.result!); await onDone()
  }

  return (
    <Dialog title={`Import ${noun}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {!result && (
          <>
            <p className="text-ink/70">Upload a CSV file with one {kind === 'customers' ? 'customer' : 'lead'} per row. Only Name is required. Anyone already in DOA with the same email or phone is skipped, not duplicated.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 font-semibold hover:bg-surface"><Upload className="size-4" aria-hidden /> Choose CSV file<input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} /></label>
              <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold underline" onClick={() => downloadCsv('doa-import-template.csv', IMPORT_TEMPLATE)}><Download className="size-4" aria-hidden /> Download the template</button>
              {fileName && <span className="text-xs text-ink/60">{fileName}</span>}
            </div>
            {problem && <ErrorState title="Cannot import" message={problem} />}
            {rows.length > 0 && (
              <div className="space-y-2">
                <p><b>{rows.length}</b> {rows.length === 1 ? 'row' : 'rows'} ready. First few:</p>
                <div className="overflow-x-auto rounded border border-line"><table data-keep-table className="w-full text-left text-xs"><thead className="bg-surface"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Email</th><th className="p-2">Company</th></tr></thead>
                  <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line"><td className="p-2">{r.name}</td><td className="p-2">{r.phone}</td><td className="p-2">{r.email}</td><td className="p-2">{r.company}</td></tr>)}</tbody></table></div>
                {ignored.length > 0 && <p className="text-xs text-ink/60">Columns not used: {ignored.join(', ')}.</p>}
              </div>
            )}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!rows.length} onClick={() => void run()}>{rows.length ? `Import ${rows.length}` : 'Import'}</Button></div>
          </>
        )}
        {result && (
          <>
            <p role="status" className="rounded-lg border border-success/30 bg-success-soft p-3 text-success"><b>{result.created}</b> {noun} imported.{result.duplicates.length > 0 && <> {result.duplicates.length} already in DOA (same email or phone), skipped.</>}{result.invalid.length > 0 && <> {result.invalid.length} could not be read.</>}</p>
            {result.invalid.length > 0 && <ul className="list-disc pl-5 text-xs text-ink/70">{result.invalid.slice(0, 10).map((x) => <li key={x.row}>Row {x.row + 1} of the file: {x.reason}</li>)}{result.invalid.length > 10 && <li>…and {result.invalid.length - 10} more</li>}</ul>}
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </Dialog>
  )
}

/** A button that downloads the records as a CSV file you can open in Excel. */
export function ExportButton({ label, filename, load }: { label: string; filename: string; load: () => Promise<(string | number | null | undefined)[][]> }) {
  const [busy, setBusy] = useState(false)
  return <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); try { downloadCsv(filename, await load()) } finally { setBusy(false) } }}><Download className="size-4" aria-hidden /> {label}</Button>
}
