import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, ErrorState, SelectField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { downloadCsv } from '@/shared/utilities/csvExport'
import * as api from '@/modules/inventory/inventoryApi'
import type { InventoryData, ProductImportResult, ProductImportRow } from '@/modules/inventory/inventoryApi'
import { MAX_IMPORT, PRODUCT_TEMPLATE, toProductRows } from './stockLogic'

/**
 * Bring a product list in from a spreadsheet (save it as CSV first): see what DOA understood before anything is saved, choose where opening stock goes, then import.
 * Products already in DOA (same SKU, barcode or, with neither, the same name) are skipped, and the result says exactly what happened.
 */
export function ImportProductsDialog({ data, businessId, onClose, onDone }: { data: InventoryData; businessId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState<ProductImportRow[]>([]); const [ignored, setIgnored] = useState<string[]>([]); const [hasStock, setHasStock] = useState(false); const [fileName, setFileName] = useState('')
  const [location, setLocation] = useState(data.locations[0]?.id ?? '')
  const [problem, setProblem] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [result, setResult] = useState<ProductImportResult | null>(null)
  const key = useRef(crypto.randomUUID())

  async function choose(file: File | undefined) {
    setProblem(null); setResult(null); setRows([]); setIgnored([])
    if (!file) return
    if (!/\.(csv|txt)$/i.test(file.name)) return setProblem('Choose a CSV file. In Excel or Google Sheets, use File, Save as or Download, CSV.')
    setFileName(file.name)
    const parsed = toProductRows(await file.text())
    if (parsed.missingName) return setProblem('The first row needs a heading called Name (or Product, Item or Product name). Download the template to see the layout.')
    if (!parsed.rows.length) return setProblem('The file has headings but no rows.')
    if (parsed.rows.length > MAX_IMPORT) return setProblem(`This file has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT} at a time: split it into smaller files.`)
    setRows(parsed.rows); setIgnored(parsed.ignored); setHasStock(parsed.hasStock); key.current = crypto.randomUUID()
  }

  async function run() {
    setBusy(true); setProblem(null)
    const r = await api.importProducts(businessId, hasStock ? location : (location || null), rows, key.current)
    setBusy(false)
    if (r.error) return setProblem(r.error)
    setResult(r.result!); await onDone()
  }

  return (
    <Dialog title="Import products" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {!result && (
          <>
            <p className="text-ink/70">Upload a CSV file with one product per row. Only Name is required. Put <b>Service</b> under Type for things you sell that have no stock. An Opening stock quantity is received into the location you choose, at the Cost on that row.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 font-semibold hover:bg-surface"><Upload className="size-4" aria-hidden /> Choose CSV file<input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} /></label>
              <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold underline" onClick={() => downloadCsv('doa-products-template.csv', PRODUCT_TEMPLATE)}><Download className="size-4" aria-hidden /> Download the template</button>
              {fileName && <span className="text-xs text-ink/60">{fileName}</span>}
            </div>
            {problem && <ErrorState title="Cannot import" message={problem} />}
            {rows.length > 0 && (
              <div className="space-y-2">
                <p><b>{rows.length}</b> {rows.length === 1 ? 'row' : 'rows'} ready. First few:</p>
                <div className="overflow-x-auto rounded border border-line"><table data-keep-table className="w-full text-left text-xs"><thead className="bg-surface"><tr><th className="p-2">Name</th><th className="p-2">SKU</th><th className="p-2">Type</th><th className="p-2">Price</th><th className="p-2">Opening stock</th></tr></thead>
                  <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line"><td className="p-2">{r.name}</td><td className="p-2">{r.sku}</td><td className="p-2">{r.type || 'Product'}</td><td className="p-2">{r.price}</td><td className="p-2">{r.quantity}</td></tr>)}</tbody></table></div>
                {ignored.length > 0 && <p className="text-xs text-ink/60">Columns not used: {ignored.join(', ')}.</p>}
                {hasStock && data.locations.length > 0 && (
                  <div className="max-w-xs"><SelectField label="Put the opening stock in" value={location} onChange={(e) => setLocation(e.target.value)}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField></div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!rows.length} onClick={() => void run()}>{rows.length ? `Import ${rows.length}` : 'Import'}</Button></div>
          </>
        )}
        {result && (
          <>
            <p role="status" className="rounded-lg border border-success/30 bg-success-soft p-3 text-success"><b>{result.created}</b> {result.created === 1 ? 'product' : 'products'} imported{result.stocked > 0 && <> ({result.stocked} with opening stock)</>}.{result.duplicates.length > 0 && <> {result.duplicates.length} already in DOA, skipped.</>}{result.invalid.length > 0 && <> {result.invalid.length} could not be read.</>}</p>
            {result.invalid.length > 0 && <ul className="list-disc pl-5 text-xs text-ink/70">{result.invalid.slice(0, 10).map((x) => <li key={x.row}>Row {x.row + 1} of the file: {x.reason}</li>)}{result.invalid.length > 10 && <li>…and {result.invalid.length - 10} more</li>}</ul>}
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </Dialog>
  )
}
