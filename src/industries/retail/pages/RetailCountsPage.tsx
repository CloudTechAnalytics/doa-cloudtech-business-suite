import { Download, Plus, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { qty } from '@/shared/utilities/format'
import { parseCsv, toCsv } from '../csv'
import { loadCategories, loadCounts, loadProducts, postCount, recordCount, startCount } from '../services/martApi'
import type { CountView } from '../services/martApi'

/** Physical stock counts. Anyone who may adjust stock can count; a manager must approve before the differences change stock. */
export function RetailCountsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const counts = useAsync(() => loadCounts(businessId), [businessId])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const categories = useAsync(() => loadCategories(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'retail'), [businessId])
  const { can } = usePermissions(businessId)
  const [starting, setStarting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const adjust = can('inventory.adjust')
  const open = counts.data?.find((c) => c.id === openId) ?? null

  return (
    <>
      <PageHeader title="Stock counts" description="Count what is on the shelf. Differences only change stock after a manager approves the count, and each one is kept as an adjustment."
        actions={adjust ? <Button onClick={() => setStarting(true)}><Plus className="size-4" aria-hidden /> Start a count</Button> : undefined} />
      {(counts.error || products.error) && <ErrorState message={(counts.error ?? products.error)!} />}
      {counts.loading ? <Spinner /> : !counts.data?.length ? <Card><EmptyState title="No counts yet" description="Start a count for the whole shop or one category." /></Card> : (
        <Card className="p-0">
          <ul className="divide-y divide-ink/10">
            {counts.data.map((c) => {
              const counted = c.items.filter((i) => i.counted !== null).length
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="font-medium">{c.createdAt.slice(0, 10)} <span className="font-normal text-ink/60">· {c.items.length} products, {counted} counted · {catalog.data?.locations.find((l) => l.id === c.locationId)?.name ?? ''}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={c.status === 'posted' ? 'success' : 'warning'}>{c.status === 'posted' ? 'Posted' : 'Open'}</Badge><Button variant="secondary" onClick={() => setOpenId(c.id)}>{c.status === 'open' ? 'Continue' : 'View'}</Button></span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      {starting && <StartDialog businessId={businessId} locations={catalog.data?.locations ?? []} categories={categories.data ?? []} onClose={() => setStarting(false)} onSaved={async () => { setStarting(false); await counts.refresh() }} />}
      {open && <CountDialog businessId={businessId} count={open} names={new Map((products.data ?? []).map((p) => [p.id, p.name]))} units={new Map((products.data ?? []).map((p) => [p.id, p.unit]))} approve={can('retail.manage')} onClose={() => setOpenId(null)} onChanged={async () => { await Promise.all([counts.refresh(), products.refresh()]) }} />}
    </>
  )
}

function StartDialog({ businessId, locations, categories, onClose, onSaved }: { businessId: string; locations: { id: string; name: string }[]; categories: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '')
    await runner.run((k) => startCount(businessId, s('location'), s('category') || null, k), 'Count started.')
  }
  return (
    <Dialog title="Start a stock count" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <SelectField label="Where" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
        <SelectField label="What" name="category" defaultValue=""><option value="">Every product</option>{categories.map((c) => <option key={c.id} value={c.id}>Only {c.name}</option>)}</SelectField>
        <Notice>The system quantity is saved when you start, so sales made while you count are not mistaken for shortages.</Notice>
        {runner.error && <ErrorState title="Not started" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Start</Button></div>
      </form>
    </Dialog>
  )
}

function CountDialog({ businessId, count, names, units, approve, onClose, onChanged }: { businessId: string; count: CountView; names: Map<string, string>; units: Map<string, string>; approve: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const file = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)
  const locked = count.status === 'posted'
  const value = (p: string, counted: number | null) => draft[p] ?? (counted === null ? '' : String(counted))
  const diff = (i: CountView['items'][number]) => { const v = value(i.productId, i.counted); return v === '' ? null : Math.round((Number(v) - i.expected) * 10000) / 10000 }
  const pending = count.items.filter((i) => draft[i.productId] !== undefined && draft[i.productId] !== '' && Number(draft[i.productId]) !== i.counted)

  async function save() {
    for (const i of pending) {
      const err = await recordCount(businessId, count.id, i.productId, Number(draft[i.productId]))
      if (err) throw new Error(`${names.get(i.productId) ?? 'Product'}: ${err}`)
    }
    setDraft({})
  }
  function exportCsv() {
    const body = toCsv([['sku_or_name', 'product', 'expected', 'counted'], ...count.items.map((i) => [names.get(i.productId) ?? '', names.get(i.productId) ?? '', i.expected, value(i.productId, i.counted)])])
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'stock-count.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  async function importCsv(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const grid = parseCsv(await f.text()); const head = (grid[0] ?? []).map((h) => h.trim().toLowerCase())
    const nameCol = head.indexOf('product'); const countedCol = head.indexOf('counted')
    if (nameCol < 0 || countedCol < 0) return setNote('The file needs "product" and "counted" columns. Export the count first to get the right layout.')
    const next = { ...draft }; let used = 0; const unknown: string[] = []
    for (const r of grid.slice(1)) {
      const raw = (r[countedCol] ?? '').trim(); if (raw === '') continue
      const item = count.items.find((i) => (names.get(i.productId) ?? '').toLowerCase() === (r[nameCol] ?? '').trim().toLowerCase())
      if (!item || !(Number(raw) >= 0)) { unknown.push(r[nameCol] ?? '?'); continue }
      next[item.productId] = raw; used++
    }
    setDraft(next)
    setNote(`${used} count${used === 1 ? '' : 's'} loaded${unknown.length ? `; ${unknown.length} row${unknown.length === 1 ? '' : 's'} skipped (${unknown.slice(0, 5).join(', ')})` : ''}. Press Save counts to keep them.`)
  }

  const varianceItems = count.items.filter((i) => { const d = diff(i); return d !== null && d !== 0 })
  return (
    <Dialog title={locked ? 'Stock count (posted)' : 'Stock count'} onClose={onClose} wide>
      <div className="space-y-3">
        {!locked && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={exportCsv}><Download className="size-4" aria-hidden /> Export CSV</Button><input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} aria-label="Choose a count CSV file" /><Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import CSV</Button></div>}
        {note && <Notice>{note}</Notice>}
        <div className="max-h-96 overflow-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-2">Product</th><th className="p-2 text-right">System</th><th className="w-32 p-2 text-right">Counted</th><th className="p-2 text-right">Difference</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {count.items.map((i) => { const d = diff(i); return (
                <tr key={i.productId}>
                  <td className="p-2">{names.get(i.productId) ?? 'Product'}</td>
                  <td className="tabular p-2 text-right">{qty(i.expected)} {units.get(i.productId)}</td>
                  <td className="p-2 text-right">{locked ? <span className="tabular">{i.counted === null ? '–' : qty(i.counted)}</span> : <input aria-label={`Counted ${names.get(i.productId)}`} type="number" min="0" step="any" value={value(i.productId, i.counted)} onChange={(e) => setDraft({ ...draft, [i.productId]: e.target.value })} className="tabular w-28 rounded-md border border-line px-2 py-1 text-right" />}</td>
                  <td className={`tabular p-2 text-right ${d === null ? 'text-ink/40' : d < 0 ? 'text-danger' : d > 0 ? 'text-success' : ''}`}>{d === null ? '–' : d > 0 ? `+${qty(d)}` : qty(d)}</td>
                </tr>) })}
            </tbody>
          </table>
        </div>
        {!locked && <p className="text-sm text-ink/70">{varianceItems.length} product{varianceItems.length === 1 ? '' : 's'} differ from the system. Products you leave empty are not counted and stay as they are.</p>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!locked && <Button variant="secondary" loading={runner.busy} disabled={!pending.length} onClick={() => void runner.run(async () => { await save(); return null }, 'Counts saved.')}>Save counts</Button>}
          {!locked && approve && <Button loading={runner.busy} disabled={pending.length > 0} onClick={() => void runner.run((k) => postCount(businessId, count.id, k), 'Count approved and posted.')}>Approve &amp; post</Button>}
        </div>
        {!locked && !approve && <p className="text-right text-xs text-ink/60">A manager must approve this count before stock changes.</p>}
        {!locked && approve && pending.length > 0 && <p className="text-right text-xs text-ink/60">Save your counts first.</p>}
      </div>
    </Dialog>
  )
}
