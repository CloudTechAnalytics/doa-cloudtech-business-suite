import { Download, PackagePlus, Pencil, Plus, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { listSuppliers, loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { loadCategories, loadLots, loadProducts, receiveStock, saveProduct, setLot } from '../services/martApi'
import type { MartLotRow, MartProductInput, MartProductRow } from '../services/martApi'
import { parseCsv, toCsv } from '../csv'
import { openRow } from '@/shared/utilities/rows'

const UNITS = [['each', 'Each (piece)'], ['dozen', 'Dozen'], ['kg', 'Kilogram'], ['g', 'Gram'], ['l', 'Litre'], ['ml', 'Millilitre']] as const

/** Everything the mart sells: categories, packs, barcodes, wholesale prices and expiry tracking, with receiving, import and export. */
export function RetailProductsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const categories = useAsync(() => loadCategories(businessId), [businessId])
  const lots = useAsync(() => loadLots(businessId), [businessId])
  const suppliers = useAsync(() => listSuppliers(businessId).catch(() => []), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'retail'), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<MartProductRow | 'new' | null>(null)
  const [receiving, setReceiving] = useState<MartProductRow | null | 'any'>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const file = useRef<HTMLInputElement>(null)
  if (!active) return null
  const manage = can('retail.manage'); const stockIn = can('inventory.adjust')
  const q = search.trim().toLowerCase()
  const list = (products.data ?? []).filter((p) => (status === 'archived' ? !p.active : p.active) && (!category || p.categoryId === category) && (!q || [p.name, p.sku, p.barcode, p.brand].some((v) => v?.toLowerCase().includes(q))) && (status !== 'low' || p.low || p.out))
  const pending = (lots.data ?? []).filter((l) => l.expiresOn === null)
  const refresh = async () => { await Promise.all([products.refresh(), lots.refresh(), catalog.refresh()]) }

  function exportCsv() {
    const body = toCsv([['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'cost', 'price', 'wholesale', 'reorder', 'on_hand'], ...(products.data ?? []).map((p) => [p.name, p.sku ?? '', p.barcode ?? '', p.categoryName ?? '', p.brand ?? '', p.unit, p.costPrice ?? '', p.price, p.wholesale ?? '', p.reorder ?? '', p.onHand])])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'products.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setImporting(await f.text())
    e.target.value = ''
  }

  return (
    <>
      <PageHeader title="Products" description="Everything you sell. A new price or cost applies to future sales only. Stock changes by receiving, selling, counting or recording losses, never by editing a number."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!products.data?.length}><Download className="size-4" aria-hidden /> Export CSV</Button>
          {manage && <><input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} aria-label="Choose a CSV file to import" /><Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import CSV</Button></>}
          {stockIn && <Button variant="secondary" onClick={() => setReceiving('any')}><PackagePlus className="size-4" aria-hidden /> Receive stock</Button>}
          {manage && <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add product</Button>}
        </div>} />
      {(products.error || lots.error) && <ErrorState message={(products.error ?? lots.error)!} />}
      {pending.length > 0 && <Notice>{pending.length} received batch{pending.length === 1 ? ' has' : 'es have'} no expiry date yet. Add it so expiry alerts and first-expiry-first-out work: <button type="button" className="font-semibold underline" onClick={() => setReceiving(null)}>complete batches</button>.</Notice>}
      <div className="my-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU, barcode or brand" /></div>
        <div className="w-48"><SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        <div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Active</option><option value="low">Low or out of stock</option><option value="archived">Archived</option></SelectField></div>
      </div>
      {products.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title={products.data?.length ? 'No products match' : 'No products yet'} description={products.data?.length ? 'Try a different search or filter.' : 'Add your products one by one, or import a CSV file.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">In stock</th><th className="p-3 text-right">Value</th>{manage && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((p) => (
                <tr data-row-link onClick={openRow} key={p.id} className={p.active ? '' : 'text-ink/50'}>
                  <td className="p-3 font-medium">{p.name}{p.out && p.active && <> <Badge tone="danger">Out</Badge></>}{p.low && <> <Badge tone="warning">Low</Badge></>}{p.trackExpiry && <> <Badge tone="info">Expiry</Badge></>}
                    <div className="text-xs font-normal text-ink/60">{[p.sku, p.barcode, p.brand].filter(Boolean).join(' · ') || 'No code'}{p.packs.length > 0 && ` · ${p.packs.map((k) => `${k.name} = ${qty(k.units)}`).join(', ')}`}</div></td>
                  <td className="p-3">{p.categoryName ?? '–'}</td>
                  <td className="tabular p-3 text-right">{naira(p.price)}{p.wholesale !== null && <div className="text-xs text-ink/60">Wholesale {naira(p.wholesale)}</div>}</td>
                  <td className="tabular p-3 text-right">{p.avgCost !== null ? naira(p.avgCost) : p.costPrice !== null ? naira(p.costPrice) : '–'}</td>
                  <td className="tabular p-3 text-right">{qty(p.onHand)} {p.unit}{p.reorder ? <div className="text-xs text-ink/60">Reorder at {qty(p.reorder)}</div> : null}</td>
                  <td className="tabular p-3 text-right">{naira(p.stockValue)}</td>
                  {manage && <td className="p-3 text-right"><button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><Pencil className="size-4" aria-hidden /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <ProductDialog businessId={businessId} product={editing === 'new' ? null : editing} categories={categories.data ?? []} suppliers={suppliers.data ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {receiving !== null && <ReceiveDialog businessId={businessId} products={(products.data ?? []).filter((p) => p.active)} locations={catalog.data?.locations ?? []} preset={receiving === 'any' ? null : receiving} onClose={() => setReceiving(null)} onSaved={async () => { setReceiving(null); await refresh() }} />}
      {importing !== null && <ImportDialog businessId={businessId} text={importing} existing={products.data ?? []} categories={categories.data ?? []} onClose={() => setImporting(null)} onDone={async () => { setImporting(null); await refresh() }} />}
      {receiving === null && pending.length > 0 && importing === null && editing === null && <PendingLots lots={pending} onChanged={refresh} />}
    </>
  )
}

function PendingLots({ lots, onChanged }: { lots: MartLotRow[]; onChanged: () => Promise<void> }) {
  const { active } = useBusiness()
  const runner = useFormRunner(onChanged)
  const [state, setState] = useState<Record<string, { batch: string; expiry: string }>>({})
  return (
    <Card className="mt-4">
      <h2 className="mb-2 text-sm font-semibold">Complete received batches</h2>
      <ul className="divide-y divide-ink/10 text-sm">
        {lots.map((l) => {
          const v = state[l.id] ?? { batch: l.batchNumber ?? '', expiry: '' }
          return (
            <li data-row-link onClick={openRow} key={l.id} className="grid items-end gap-2 py-2 sm:grid-cols-[1fr_140px_160px_auto]">
              <span>{l.productName}<span className="block text-xs text-ink/60">{qty(l.remaining)} left, received {l.receivedOn}</span></span>
              <TextField label="Batch" value={v.batch} onChange={(e) => setState({ ...state, [l.id]: { ...v, batch: e.target.value } })} />
              <TextField label="Expiry date" type="date" value={v.expiry} onChange={(e) => setState({ ...state, [l.id]: { ...v, expiry: e.target.value } })} />
              <Button disabled={!v.expiry} loading={runner.busy} onClick={() => void runner.run(async () => setLot(active!.id, l.id, v.batch, v.expiry), 'Saved.')}>Save</Button>
            </li>
          )
        })}
      </ul>
      {runner.error && <ErrorState title="Not saved" message={runner.error} />}
    </Card>
  )
}

function ProductDialog({ businessId, product, categories, suppliers, onClose, onSaved }: { businessId: string; product: MartProductRow | null; categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [packs, setPacks] = useState<{ name: string; units: string }[]>(product ? product.packs.map((k) => ({ name: k.name, units: String(k.units) })) : [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('name').length < 2) next.name = 'Enter at least 2 characters.'
    if (s('price') === '' || !(Number(s('price')) >= 0)) next.price = 'Enter the price (0 or more).'
    if (s('cost') !== '' && !(Number(s('cost')) >= 0)) next.cost = 'Enter zero or more.'
    if (packs.some((k) => !k.name.trim() || !(Number(k.units) > 0))) next.packs = 'Every pack needs a name and a number of units above zero.'
    setErrors(next)
    if (Object.keys(next).length) return
    const input: MartProductInput = {
      id: product?.id ?? null, name: s('name'), sku: s('sku'), barcode: s('barcode'), categoryId: s('category') || null, brand: s('brand'), unit: product?.unit ?? s('unit'), cost: s('cost') === '' ? null : Number(s('cost')),
      price: Math.round(Number(s('price')) * 100) / 100, wholesale: s('wholesale') === '' ? null : Math.round(Number(s('wholesale')) * 100) / 100, reorder: s('reorder') === '' ? null : Number(s('reorder')),
      supplierId: s('supplier') || null, trackExpiry: f.get('expiry') === 'on', active: product ? f.get('active') === 'on' : true, packs: packs.map((k) => ({ name: k.name.trim(), units: Number(k.units) })),
    }
    await runner.run((k) => saveProduct(businessId, input, k), 'Saved.')
  }
  return (
    <DetailPage title={product ? `Edit ${product.name}` : 'Add a product'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><TextField label="Name" name="name" defaultValue={product?.name} error={errors.name} autoFocus maxLength={200} /></div>
          <SelectField label="Category" name="category" defaultValue={product?.categoryId ?? ''}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="SKU (optional)" name="sku" defaultValue={product?.sku ?? ''} />
          <TextField label="Barcode (optional)" name="barcode" defaultValue={product?.barcode ?? ''} hint="A scanner types this into the till." />
          <TextField label="Brand (optional)" name="brand" defaultValue={product?.brand ?? ''} />
          <TextField label="Selling price" name="price" type="number" min="0" step="0.01" defaultValue={product?.price ?? ''} error={errors.price} />
          <TextField label="Cost price" name="cost" type="number" min="0" step="0.01" defaultValue={product?.costPrice ?? ''} error={errors.cost} hint="Per unit; receiving stock sets the real average." />
          <TextField label="Wholesale price (optional)" name="wholesale" type="number" min="0" step="0.01" defaultValue={product?.wholesale ?? ''} />
          {product ? <TextField label="Sold and stocked in" value={product.unit} disabled readOnly hint="Fixed once created." /> : (
            <SelectField label="Sold and stocked in" name="unit" defaultValue="each">{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          )}
          <TextField label="Reorder when stock reaches" name="reorder" type="number" min="0" step="any" defaultValue={product?.reorder ?? ''} />
          {suppliers.length > 0 && <SelectField label="Preferred supplier" name="supplier" defaultValue={product?.supplierId ?? ''}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>}
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Packs <span className="font-normal text-ink/60">(how many of the unit above are in a pack, carton or case)</span></p>
          {packs.map((k, i) => (
            <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_160px_auto]">
              <TextField label={i === 0 ? 'Pack name' : ' '} value={k.name} placeholder="e.g. carton" onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <TextField label={i === 0 ? 'Units in it' : ' '} type="number" min="0" step="any" value={k.units} onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} />
              <button type="button" aria-label="Remove pack" onClick={() => setPacks(packs.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger"><X className="size-4" aria-hidden /></button>
            </div>
          ))}
          {errors.packs && <p className="text-xs text-danger">{errors.packs}</p>}
          <Button type="button" variant="ghost" onClick={() => setPacks([...packs, { name: '', units: '' }])}><Plus className="size-4" aria-hidden /> Add pack</Button>
          <p className="text-xs text-ink/60">Example: a pack of 6 is 6, and a carton of 12 packs is 72. Stock is always kept in the unit above.</p>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="expiry" defaultChecked={product?.trackExpiry} /> Track batch and expiry date <span className="text-ink/60">(stock is then sold oldest expiry first)</span></label>
        {product && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={product.active} /> Active <span className="text-ink/60">(archived products cannot be sold)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{product ? 'Save' : 'Add product'}</Button></div>
      </form>
    </DetailPage>
  )
}

function ReceiveDialog({ businessId, products, locations, preset, onClose, onSaved }: { businessId: string; products: MartProductRow[]; locations: { id: string; name: string }[]; preset: MartProductRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [productId, setProductId] = useState(preset?.id ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const p = products.find((x) => x.id === productId)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (!p) return setProblem('Choose the product.')
    if (!(Number(s('qty')) > 0)) return setProblem('Enter the quantity received.')
    if (p.trackExpiry && !s('expiry')) return setProblem('Enter the expiry date.')
    setProblem(null)
    await runner.run((k) => receiveStock(businessId, { locationId: s('location'), reference: s('reference'), items: [{ productId: p.id, quantity: Number(s('qty')), pack: s('pack') || null, unitCost: s('cost') === '' ? null : Number(s('cost')), batch: s('batch'), expiry: s('expiry') || null }] }, k), 'Stock received.')
  }
  return (
    <Dialog title="Receive stock" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label="Product" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Select…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Received in" name="pack" defaultValue="" key={productId}><option value="">{p ? `${p.unit} (single units)` : 'Single units'}</option>{(p?.packs ?? []).map((k) => <option key={k.name} value={k.name}>{k.name} ({qty(k.units)} {p?.unit})</option>)}</SelectField>
          <TextField label="Quantity" name="qty" type="number" min="0" step="any" />
          <TextField label="Cost for each one received" name="cost" type="number" min="0" step="0.01" hint="Per pack when a pack is chosen." />
          <SelectField label="Into" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
          {p?.trackExpiry && <><TextField label="Batch number" name="batch" /><TextField label="Expiry date" name="expiry" type="date" /></>}
        </div>
        <TextField label="Reference (optional)" name="reference" placeholder="Delivery note or invoice number" />
        <Notice>Stock goes up by the number of single units in what you received. A purchase order never adds stock until you receive it.</Notice>
        {(problem || runner.error) && <ErrorState title="Not received" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Receive</Button></div>
      </form>
    </Dialog>
  )
}

function ImportDialog({ businessId, text, existing, categories, onClose, onDone }: { businessId: string; text: string; existing: MartProductRow[]; categories: { id: string; name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const grid = parseCsv(text)
  const head = (grid[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name)
  const rowsRaw = grid.slice(1).filter((r) => r.some((c) => c.trim()))
  const names = new Set(existing.map((p) => p.name.trim().toLowerCase())); const skus = new Set(existing.map((p) => p.sku?.toLowerCase()).filter(Boolean)); const barcodes = new Set(existing.map((p) => p.barcode).filter(Boolean))
  const seenNames = new Set<string>()
  const rows = rowsRaw.map((r, i) => {
    const g = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '')
    const problems: string[] = []
    const name = g('name'); const price = g('price'); const cost = g('cost')
    if (name.length < 2) problems.push('name is missing')
    if (price === '' || !(Number(price) >= 0)) problems.push('price must be a number')
    if (cost !== '' && !(Number(cost) >= 0)) problems.push('cost must be a number')
    if (name && (names.has(name.toLowerCase()) || seenNames.has(name.toLowerCase()))) problems.push('a product with this name already exists')
    if (g('sku') && skus.has(g('sku').toLowerCase())) problems.push('SKU already used')
    if (g('barcode') && barcodes.has(g('barcode'))) problems.push('barcode already used')
    const cat = g('category') ? categories.find((c) => c.name.toLowerCase() === g('category').toLowerCase()) : undefined
    if (g('category') && !cat) problems.push(`category "${g('category')}" does not exist`)
    if (name) seenNames.add(name.toLowerCase())
    return { line: i + 2, name, g, cat, problems }
  })
  const missing = ['name', 'price'].filter((h) => col(h) < 0)
  const good = rows.filter((r) => r.problems.length === 0)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function commit() {
    setBusy(true); setError(null)
    let done = 0
    for (const r of good) {
      const unit = ['each', 'dozen', 'kg', 'g', 'l', 'ml'].includes(r.g('unit')) ? r.g('unit') : 'each'
      const err = await saveProduct(businessId, { id: null, name: r.name, sku: r.g('sku'), barcode: r.g('barcode'), categoryId: r.cat?.id ?? null, brand: r.g('brand'), unit, cost: r.g('cost') === '' ? null : Number(r.g('cost')), price: Math.round(Number(r.g('price')) * 100) / 100, wholesale: r.g('wholesale') === '' ? null : Number(r.g('wholesale')), reorder: r.g('reorder') === '' ? null : Number(r.g('reorder')), supplierId: null, trackExpiry: false, active: true, packs: [] }, crypto.randomUUID())
      if (err) { setError(`Stopped at line ${r.line} (${r.name}): ${err}. ${done} product${done === 1 ? '' : 's'} before it were added.`); setBusy(false); await onDone(); return }
      done++; setProgress(`${done} of ${good.length} added`)
    }
    setBusy(false)
    await onDone()
  }
  return (
    <Dialog title="Import products" onClose={onClose} wide>
      {missing.length > 0 ? <ErrorState title="This file cannot be imported" message={`The first row must name its columns. Missing: ${missing.join(', ')}. Expected columns: name, price, and optionally sku, barcode, category, brand, unit, cost, wholesale, reorder.`} /> : (
        <>
          <p className="mb-3 text-sm text-ink/80">Preview: <b>{good.length}</b> product{good.length === 1 ? '' : 's'} ready to add, <b>{rows.length - good.length}</b> with problems that will be skipped. Nothing is saved until you confirm.</p>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2 text-right">Price</th><th className="p-2">Result</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{rows.map((r) => <tr data-row-link onClick={openRow} key={r.line}><td className="p-2">{r.line}</td><td className="p-2">{r.name || '–'}</td><td className="tabular p-2 text-right">{r.g('price')}</td><td className="p-2">{r.problems.length ? <span className="text-danger">{r.problems.join('; ')}</span> : <Badge tone="success">Ready</Badge>}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {error && <ErrorState title="Import stopped" message={error} />}
      {progress && !error && <p className="mt-2 text-sm text-ink/70">{progress}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button>{missing.length === 0 && <Button onClick={() => void commit()} loading={busy} disabled={!good.length}>Add {good.length} product{good.length === 1 ? '' : 's'}</Button>}</div>
    </Dialog>
  )
}
