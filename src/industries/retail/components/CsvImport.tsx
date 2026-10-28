import { Download } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ErrorState, Notice } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { loadCategories, saveCategory, saveProduct } from '../services/martApi'
import { CATEGORY_COLUMNS, PRODUCT_COLUMNS, analyseCategories, analyseProducts } from '../importLogic'
import { downloadCategoryTemplate, downloadProductTemplate } from '../importDownloads'
import type { ImportColumn } from '../importLogic'

/** What each column means, with an example, so a file can be filled in without guessing. */
function ColumnGuide({ columns }: { columns: ImportColumn[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-xs">
        <thead className="bg-surface text-left font-semibold text-ink/70"><tr><th className="p-2">Column</th><th className="p-2">What goes in it</th><th className="p-2">Example</th></tr></thead>
        <tbody className="divide-y divide-ink/10">{columns.map((c) => <tr key={c.name}><td className="p-2 font-mono font-semibold">{c.name}{c.required && <span className="ml-1 font-sans text-danger" title="Required">*</span>}</td><td className="p-2">{c.help}</td><td className="p-2 font-mono">{c.example}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function Steps({ kind, onTemplate }: { kind: 'products' | 'categories'; onTemplate: () => void }) {
  return (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink/80">
      <li><button type="button" onClick={onTemplate} className="inline-flex items-center gap-1 font-semibold underline"><Download className="size-3.5" aria-hidden /> Download the {kind} template</button> and open it in Excel or Google Sheets.</li>
      <li>Delete the two example rows, or leave them: they are ignored. Fill in one {kind === 'products' ? 'product' : 'category'} per row. Keep the first row as it is.</li>
      <li>Save it as CSV, then choose it with <b>Import CSV</b>. You see a preview first, and nothing is saved until you confirm.</li>
    </ol>
  )
}

// -------------------------------------------------------------------------- products
export function ImportProductsDialog({ businessId, text, existing, categories, onClose, onDone }: { businessId: string; text: string; existing: { name: string; sku: string | null; barcode: string | null }[]; categories: { id: string; name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [createMissing, setCreateMissing] = useState(true)
  const a = analyseProducts(text, existing, categories, createMissing)
  const good = a.rows.filter((r) => r.problems.length === 0)
  const [progress, setProgress] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)

  async function commit() {
    setBusy(true); setError(null)
    let known = categories
    if (a.newCategories.length) {
      for (const name of a.newCategories) { const err = await saveCategory(businessId, { id: null, name }); if (err && !/already exists/.test(err)) { setError(`Could not create the category "${name}": ${err}`); setBusy(false); return } }
      known = await loadCategories(businessId)
    }
    let done = 0
    for (const r of good) {
      const unit = r.g('unit').toLowerCase() || 'each'
      const cat = r.category ? known.find((c) => c.name.trim().toLowerCase() === r.category.trim().toLowerCase()) : undefined
      const num = (k: string) => (r.g(k) === '' ? null : Number(r.g(k)))
      const err = await saveProduct(businessId, { id: null, name: r.name, sku: r.g('sku'), barcode: r.g('barcode'), categoryId: cat?.id ?? null, brand: r.g('brand'), unit, cost: num('cost'), price: Math.round(Number(r.g('price')) * 100) / 100, wholesale: num('wholesale'), reorder: num('reorder'), supplierId: null, trackExpiry: false, active: true, packs: [] }, crypto.randomUUID())
      if (err) { setError(`Stopped at line ${r.line} (${r.name}): ${err}. ${done} product${done === 1 ? '' : 's'} before it were added.`); setBusy(false); await onDone(); return }
      done++; setProgress(`${done} of ${good.length} added`)
    }
    setBusy(false); await onDone()
  }

  return (
    <Dialog title="Import products" onClose={onClose} wide>
      {a.missing.length > 0 ? (
        <div className="space-y-3">
          <ErrorState title="This file cannot be imported" message={`The first row must name its columns. Missing: ${a.missing.join(', ')}. The easiest way is to start from the template.`} />
          <Steps kind="products" onTemplate={downloadProductTemplate} />
          <ColumnGuide columns={PRODUCT_COLUMNS} />
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink/80">Preview: <b>{good.length}</b> product{good.length === 1 ? '' : 's'} ready to add, <b>{a.rows.length - good.length}</b> with problems that will be skipped. Nothing is saved until you confirm.{a.skippedExamples > 0 && <> {a.skippedExamples} example row{a.skippedExamples === 1 ? ' was' : 's were'} ignored.</>}</p>
          {a.rows.some((r) => r.category && !r.knownCategory) && (
            <label className="mb-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} /><span>Create the categories that do not exist yet{a.newCategories.length > 0 && <span className="text-ink/60"> ({a.newCategories.join(', ')})</span>}. If you leave this off, products in those categories are skipped.</span></label>
          )}
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2">Category</th><th className="p-2 text-right">Price</th><th className="p-2">Result</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{a.rows.map((r) => <tr key={r.line}><td className="p-2">{r.line}</td><td className="p-2">{r.name || '–'}</td><td className="p-2">{r.category || '–'}</td><td className="tabular p-2 text-right">{r.g('price')}</td><td className="p-2">{r.problems.length ? <span className="text-danger">{r.problems.join('; ')}</span> : <Badge tone="success">Ready</Badge>}</td></tr>)}</tbody>
            </table>
          </div>
          <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">What the columns mean</summary><div className="mt-2"><ColumnGuide columns={PRODUCT_COLUMNS} /></div></details>
        </>
      )}
      {error && <div className="mt-2"><ErrorState title="Import stopped" message={error} /></div>}
      {progress && !error && <p className="mt-2 text-sm text-ink/70">{progress}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={downloadProductTemplate}><Download className="size-4" aria-hidden /> Template</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {a.missing.length === 0 && <Button onClick={() => void commit()} loading={busy} disabled={!good.length}>Add {good.length} product{good.length === 1 ? '' : 's'}</Button>}
      </div>
    </Dialog>
  )
}

// ------------------------------------------------------------------------ categories
export function ImportCategoriesDialog({ businessId, text, existing, onClose, onDone }: { businessId: string; text: string; existing: { name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const a = analyseCategories(text, existing)
  const good = a.rows.filter((r) => r.problems.length === 0)
  const [progress, setProgress] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  async function commit() {
    setBusy(true); setError(null); let done = 0
    for (const r of good) {
      const err = await saveCategory(businessId, { id: null, name: r.name })
      if (err) { setError(`Stopped at line ${r.line} (${r.name}): ${err}. ${done} categor${done === 1 ? 'y' : 'ies'} before it were added.`); setBusy(false); await onDone(); return }
      done++; setProgress(`${done} of ${good.length} added`)
    }
    setBusy(false); await onDone()
  }
  return (
    <Dialog title="Import categories" onClose={onClose}>
      {a.missing.length > 0 ? (
        <div className="space-y-3">
          <ErrorState title="This file cannot be imported" message="The first row must be the column name: name. The easiest way is to start from the template." />
          <Steps kind="categories" onTemplate={downloadCategoryTemplate} />
          <ColumnGuide columns={CATEGORY_COLUMNS} />
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink/80">Preview: <b>{good.length}</b> categor{good.length === 1 ? 'y' : 'ies'} ready to add, <b>{a.rows.length - good.length}</b> with problems that will be skipped. Nothing is saved until you confirm.{a.skippedExamples > 0 && <> {a.skippedExamples} example row{a.skippedExamples === 1 ? ' was' : 's were'} ignored.</>}</p>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2">Result</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{a.rows.map((r) => <tr key={r.line}><td className="p-2">{r.line}</td><td className="p-2">{r.name || '–'}</td><td className="p-2">{r.problems.length ? <span className="text-danger">{r.problems.join('; ')}</span> : <Badge tone="success">Ready</Badge>}</td></tr>)}</tbody>
            </table>
          </div>
          {a.rows.length === 0 && <div className="mt-3"><Notice>The file has no categories in it. Use the template and add one category per row.</Notice></div>}
        </>
      )}
      {error && <div className="mt-2"><ErrorState title="Import stopped" message={error} /></div>}
      {progress && !error && <p className="mt-2 text-sm text-ink/70">{progress}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={downloadCategoryTemplate}><Download className="size-4" aria-hidden /> Template</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {a.missing.length === 0 && <Button onClick={() => void commit()} loading={busy} disabled={!good.length}>Add {good.length} categor{good.length === 1 ? 'y' : 'ies'}</Button>}
      </div>
    </Dialog>
  )
}
