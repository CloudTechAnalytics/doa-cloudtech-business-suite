import { Download, PackagePlus, ChevronRight, Plus, Upload, X } from 'lucide-react'
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
import * as inv from '@/modules/inventory/inventoryApi'
import { PictureField, PictureViewer, ProductThumb } from '@/modules/inventory/ProductPicture'
import { UndoMovementDialog } from '@/modules/inventory/UndoMovementDialog'
import { loadThumbs, setProductImage } from '@/modules/inventory/productPictures'
import type { ProductPicture } from '@/modules/inventory/productPictures'
import { isDemoMode } from '@/shared/utilities/env'
import { ScanButton, codeFrom } from '@/shared/components/BarcodeScanner'
import { ImportProductsDialog } from '../components/CsvImport'
import { downloadProductTemplate } from '../importDownloads'
import type { MartLotRow, MartProductInput, MartProductRow } from '../services/martApi'
import { toCsv } from '../csv'
import { openRow } from '@/shared/utilities/rows'
import { DeleteButton } from '@/shared/components/delete-button'

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
  const thumbs = useAsync(() => loadThumbs(businessId), [businessId])
  const [viewing, setViewing] = useState<MartProductRow | null>(null)
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
  const archivedCount = (products.data ?? []).filter((p) => !p.active).length
  const refresh = async () => { await Promise.all([products.refresh(), lots.refresh(), catalog.refresh(), thumbs.refresh()]) }

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
          {manage && <><input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} aria-label="Choose a CSV file to import" /><Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import CSV</Button><Button variant="ghost" onClick={downloadProductTemplate}><Download className="size-4" aria-hidden /> Template</Button></>}
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
      {archivedCount > 0 && status !== 'archived' && <p className="mb-2 text-xs text-ink/60">{archivedCount} archived product{archivedCount === 1 ? '' : 's'} {archivedCount === 1 ? 'is' : 'are'} hidden. <button type="button" className="font-semibold underline" onClick={() => setStatus('archived')}>Show archived</button></p>}
      {status === 'archived' && <p className="mb-2 text-xs text-ink/60">Archived products cannot be sold. Open one and press Restore to bring it back. <button type="button" className="font-semibold underline" onClick={() => setStatus('')}>Back to active products</button></p>}
      {products.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title={products.data?.length ? 'No products match' : 'No products yet'} description={products.data?.length ? 'Try a different search or filter.' : 'Add your products one by one, or import a CSV file.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">In stock</th><th className="p-3 text-right">Value</th>{manage && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((p) => (
                <tr data-row-link onClick={openRow} key={p.id} className={p.active ? '' : 'text-ink/50'}>
                  <td className="p-3 font-medium"><div className="flex items-center gap-3"><ProductThumb name={p.name} thumb={thumbs.data?.[p.id]} size="sm" onClick={() => setViewing(p)} /><div className="min-w-0">{p.name}{p.out && p.active && <> <Badge tone="danger">Out</Badge></>}{p.low && <> <Badge tone="warning">Low</Badge></>}{p.trackExpiry && <> <Badge tone="info">Expiry</Badge></>}
                    <div className="text-xs font-normal text-ink/60">{[p.sku, p.barcode, p.brand].filter(Boolean).join(' · ') || 'No code'}{p.packs.length > 0 && ` · ${p.packs.map((k) => `${k.name} = ${qty(k.units)}`).join(', ')}`}</div></div></div></td>
                  <td className="p-3">{p.categoryName ?? '–'}</td>
                  <td className="tabular p-3 text-right">{naira(p.price)}{p.wholesale !== null && <div className="text-xs text-ink/60">Wholesale {naira(p.wholesale)}</div>}</td>
                  <td className="tabular p-3 text-right">{p.avgCost !== null ? naira(p.avgCost) : p.costPrice !== null ? naira(p.costPrice) : '–'}</td>
                  <td className="tabular p-3 text-right">{qty(p.onHand)} {p.unit}{p.reorder ? <div className="text-xs text-ink/60">Reorder at {qty(p.reorder)}</div> : null}</td>
                  <td className="tabular p-3 text-right">{naira(p.stockValue)}</td>
                  {manage && <td className="p-3 text-right"><button type="button" aria-label={`Open ${p.name}`} onClick={() => setEditing(p)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {viewing && <PictureViewer productId={viewing.id} name={viewing.name} onClose={() => setViewing(null)} />}
      {editing && <ProductDialog thumb={editing === 'new' ? null : thumbs.data?.[editing.id] ?? null} businessId={businessId} product={editing === 'new' ? null : editing} categories={categories.data ?? []} suppliers={suppliers.data ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {receiving !== null && <ReceiveDialog businessId={businessId} products={(products.data ?? []).filter((p) => p.active)} locations={catalog.data?.locations ?? []} preset={receiving === 'any' ? null : receiving} onClose={() => setReceiving(null)} onSaved={async () => { setReceiving(null); await refresh() }} />}
      {importing !== null && <ImportProductsDialog businessId={businessId} text={importing} existing={products.data ?? []} categories={categories.data ?? []} onClose={() => setImporting(null)} onDone={async () => { setImporting(null); await refresh() }} />}
      {receiving === null && pending.length > 0 && importing === null && editing === null && <PendingLots lots={pending} onChanged={refresh} />}
      {stockIn && editing === null && receiving === null && <RecentDeliveries businessId={businessId} products={products.data ?? []} onChanged={refresh} />}
    </>
  )
}

/** The last few stock deliveries, each with a way to undo it, so a receipt entered by mistake can be taken back without searching the full history. */
function RecentDeliveries({ businessId, products, onChanged }: { businessId: string; products: MartProductRow[]; onChanged: () => Promise<void> }) {
  const demo = inv.useDemoData(businessId, 'retail', isDemoMode)
  const live = useAsync(() => (isDemoMode ? Promise.resolve(null) : inv.loadInventory(businessId)), [businessId])
  const [undoing, setUndoing] = useState<{ id: string; summary: string } | null>(null)
  const moves = ((isDemoMode ? demo?.movements : live.data?.movements) ?? []).filter((m) => m.type === 'receipt' && m.delta > 0 && !m.reversed && !m.reversalOf).slice(0, 6)
  if (moves.length === 0) return null
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? 'Product'
  return (
    <Card className="mt-4">
      <h2 className="mb-1 text-sm font-semibold">Recent deliveries</h2>
      <p className="mb-2 text-xs text-ink/60">Entered stock by mistake? Undo it here. The entry stays in the history marked as reversed.</p>
      <ul className="divide-y divide-ink/10 text-sm">
        {moves.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><b>{name(m.productId)}</b> +{qty(m.delta)}<span className="block text-xs text-ink/60">{new Date(m.at).toLocaleString()}{m.reason ? ` · ${m.reason}` : ''}</span></span>
            <Button variant="ghost" onClick={() => setUndoing({ id: m.id, summary: `${name(m.productId)}: +${qty(m.delta)}` })}>Undo</Button>
          </li>
        ))}
      </ul>
      {undoing && <UndoMovementDialog businessId={businessId} movementId={undoing.id} summary={undoing.summary} onClose={() => setUndoing(null)} onDone={async () => { setUndoing(null); await Promise.all([live.refresh(), onChanged()]) }} />}
    </Card>
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

function ProductDialog({ businessId, product, thumb, categories, suppliers, onClose, onSaved }: { businessId: string; product: MartProductRow | null; thumb: string | null; categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [packs, setPacks] = useState<{ name: string; units: string; price: string }[]>(product ? product.packs.map((k) => ({ name: k.name, units: String(k.units), price: k.price === null || k.price === undefined ? '' : String(k.price) })) : [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [picture, setPicture] = useState<ProductPicture | null | undefined>(undefined)
  const [priceNow, setPriceNow] = useState(product ? String(product.price) : '')
  const [nameNow, setNameNow] = useState(product?.name ?? '')
  const [barcode, setBarcode] = useState(product?.barcode ?? '')
  const [confirmArchive, setConfirmArchive] = useState<null | (() => void)>(null)
  function toggleArchive() {
    if (!product) return
    if (product.active) return setConfirmArchive(() => () => void archiveNow())
    void archiveNow()
  }
  async function archiveNow() {
    if (!product) return
    const err = await inv.setProductStatus(businessId, product.id, product.active ? 'archived' : 'active')
    if (err) return setErrors({ name: err })
    await onSaved()
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('name').length < 2) next.name = 'Enter at least 2 characters.'
    if (s('price') === '' || !(Number(s('price')) >= 0)) next.price = 'Enter the price (0 or more).'
    if (s('cost') !== '' && !(Number(s('cost')) >= 0)) next.cost = 'Enter zero or more.'
    if (packs.some((k) => !k.name.trim() || !(Number(k.units) > 0))) next.packs = 'Every pack needs a name and a number of units above zero.'
    else if (packs.some((k) => k.price.trim() !== '' && !(Number(k.price) >= 0))) next.packs = 'A pack price must be zero or more, or left empty.'
    else if (packs.some((k) => k.price.trim() !== '' && Number(k.price) > Math.round(Number(k.units) * Number(s('price')) * 100) / 100)) next.packs = 'A pack cannot cost more than its units sold one by one. Leave the price empty to use that sum.'
    setErrors(next)
    if (Object.keys(next).length) return
    const input: MartProductInput = {
      id: product?.id ?? null, name: s('name'), sku: s('sku'), barcode: s('barcode'), categoryId: s('category') || null, brand: s('brand'), unit: product?.unit ?? s('unit'), cost: s('cost') === '' ? null : Number(s('cost')),
      price: Math.round(Number(s('price')) * 100) / 100, wholesale: s('wholesale') === '' ? null : Math.round(Number(s('wholesale')) * 100) / 100, reorder: s('reorder') === '' ? null : Number(s('reorder')),
      supplierId: s('supplier') || null, trackExpiry: f.get('expiry') === 'on', active: product ? f.get('active') === 'on' : true, packs: packs.map((k) => ({ name: k.name.trim(), units: Number(k.units), price: k.price.trim() === '' ? null : Math.round(Number(k.price) * 100) / 100 })),
    }
    const save = () => runner.run(async (k) => {
      const err = await saveProduct(businessId, input, k)
      if (err || picture === undefined) return err
      const id = product?.id ?? (await loadProducts(businessId)).find((p) => p.name.trim().toLowerCase() === input.name.trim().toLowerCase())?.id
      return id ? setProductImage(businessId, id, picture) : 'The product was saved, but its picture could not be attached. Open it and add the picture again.'
    }, 'Saved.')
    // Unticking Active archives the product: ask first.
    if (product && product.active && f.get('active') !== 'on') return setConfirmArchive(() => () => void save())
    await save()
  }
  return (
    <DetailPage title={product ? `Edit ${product.name}` : 'Add a product'} onClose={onClose} view={!!product} modal={!product} actions={product ? <div className="flex gap-2"><Button variant="secondary" onClick={() => toggleArchive()}>{product.active ? 'Archive' : 'Restore'}</Button><DeleteButton onArchive={() => inv.setProductStatus(businessId, product.id, 'archived')} businessId={businessId} kind="product" id={product.id} label={product.name} noun="product" onDeleted={onSaved} /></div> : undefined} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <PictureField name={nameNow} current={thumb} picture={picture} onChange={setPicture} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><TextField label="Name" name="name" defaultValue={product?.name} onChange={(e) => setNameNow(e.target.value)} error={errors.name} autoFocus maxLength={200} /></div>
          <SelectField label="Category" name="category" defaultValue={product?.categoryId ?? ''}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="SKU (optional)" name="sku" defaultValue={product?.sku ?? ''} />
          <div><TextField label="Barcode or QR code (optional)" name="barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} hint="Scan the code printed on the product itself, and the till finds it when that item is scanned. A USB or Bluetooth scanner types into this box." /><div className="mt-1"><ScanButton label="Scan with camera" title="Scan the product's own code" onScan={(c) => setBarcode(codeFrom(c)[0])} /></div></div>
          <TextField label="Brand (optional)" name="brand" defaultValue={product?.brand ?? ''} />
          <TextField label="Selling price" name="price" type="number" min="0" step="0.01" defaultValue={product?.price ?? ''} onChange={(e) => setPriceNow(e.target.value)} error={errors.price} hint="For one unit. A pack sells for this price times its units, unless you give the pack its own price below." />
          <TextField label="Cost price" name="cost" type="number" min="0" step="0.01" defaultValue={product?.costPrice ?? ''} error={errors.cost} hint="Per unit; receiving stock sets the real average." />
          <TextField label="Wholesale price (optional, for your reference)" name="wholesale" type="number" min="0" step="0.01" defaultValue={product?.wholesale ?? ''} />
          {product ? <TextField label="Sold and stocked in" value={product.unit} disabled readOnly hint="Fixed once created." /> : (
            <SelectField label="Sold and stocked in" name="unit" defaultValue="each">{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          )}
          <TextField label="Reorder when stock reaches" name="reorder" type="number" min="0" step="any" defaultValue={product?.reorder ?? ''} />
          {suppliers.length > 0 && <SelectField label="Preferred supplier" name="supplier" defaultValue={product?.supplierId ?? ''}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>}
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Packs <span className="font-normal text-ink/60">(how many of the unit above are in a pack, carton or case)</span></p>
          {packs.map((k, i) => (
            <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_130px_150px_auto]">
              <TextField label={i === 0 ? 'Pack name' : ' '} value={k.name} placeholder="e.g. carton" onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <TextField label={i === 0 ? 'Units in it' : ' '} type="number" min="0" step="any" value={k.units} onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} />
              <TextField label={i === 0 ? 'Pack price (optional)' : ' '} type="number" min="0" step="0.01" value={k.price} placeholder={k.units && priceNow !== '' ? String(Math.round(Number(k.units) * Number(priceNow) * 100) / 100) : ''} onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <button type="button" aria-label="Remove pack" onClick={() => setPacks(packs.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger"><X className="size-4" aria-hidden /></button>
            </div>
          ))}
          {errors.packs && <p className="text-xs text-danger">{errors.packs}</p>}
          <Button type="button" variant="ghost" onClick={() => setPacks([...packs, { name: '', units: '', price: '' }])}><Plus className="size-4" aria-hidden /> Add pack</Button>
          {packs.filter((k) => k.name.trim() && Number(k.units) > 0 && Number(priceNow) >= 0 && priceNow !== '').map((k, i) => { const full = Math.round(Number(priceNow) * Number(k.units) * 100) / 100; const own = k.price.trim() === '' ? null : Number(k.price); return <p key={i} className="text-xs text-ink/70">A {k.name.trim()} of {qty(Number(k.units))} sells for <b>{naira(own ?? full)}</b>{own !== null && own < full ? <> (<b>{naira(full - own)}</b> less than {qty(Number(k.units))} × {naira(Number(priceNow))})</> : <> ({qty(Number(k.units))} × {naira(Number(priceNow))})</>}, and takes {qty(Number(k.units))} off the stock.</p> })}
          <p className="text-xs text-ink/60">Example: a pack of 6 is 6, and a carton of 12 packs is 72. Stock is always kept in the unit above, and a pack sells for the pack price you type, or for its units times the selling price when you leave it empty.</p>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="expiry" defaultChecked={product?.trackExpiry} /> Track batch and expiry date <span className="text-ink/60">(stock is then sold oldest expiry first)</span></label>
        {product && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={product.active} /> Active <span className="text-ink/60">(archived products cannot be sold)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        {confirmArchive && (
          <Dialog title={`Archive ${product?.name ?? 'this product'}?`} onClose={() => setConfirmArchive(null)}>
            <div className="space-y-3 text-sm">
              <p>It will disappear from the till and the product lists, and it cannot be sold while archived.</p>
              <p className="text-ink/70">Its sales, stock and history stay in your records. You can bring it back any time: Products, Show, Archived, open it and press Restore.</p>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmArchive(null)}>Cancel</Button><Button type="button" onClick={() => { const go = confirmArchive; setConfirmArchive(null); go() }}>Yes, archive it</Button></div>
            </div>
          </Dialog>
        )}
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

