import { Download, PackagePlus, ChevronRight, Plus, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { listPurchases, listSuppliers, loadCatalog, purchaseDetail } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { parseCsv, toCsv } from '../../retail/csv'
import { loadCategories } from '../../retail/services/martApi'
import { CLASSIFICATIONS, CLASS_LABEL, DOSAGE_FORMS, loadBatches, loadMedicines, receiveGoods, saveMedicine } from '../services/pharmacyApi'
import type { Classification, MedicineInput, MedicineRow, ReceiveItem } from '../services/pharmacyApi'
import { openRow } from '@/shared/utilities/rows'
import { DeleteButton } from '@/shared/components/delete-button'

const UNITS = [['each', 'Each (tablet, capsule, piece)'], ['dozen', 'Dozen'], ['kg', 'Kilogram'], ['g', 'Gram'], ['l', 'Litre'], ['ml', 'Millilitre']] as const
const CLASS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = { otc: 'neutral', prescription_only: 'warning', controlled: 'danger', device: 'info', general: 'neutral' }

/** The medicine catalogue: classification, strength and form, pack conversions, barcodes, receiving with batch and expiry, and CSV import. */
export function PharmacyMedicinesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const medicines = useAsync(() => loadMedicines(businessId), [businessId])
  const categories = useAsync(() => loadCategories(businessId), [businessId])
  const batches = useAsync(() => loadBatches(businessId), [businessId])
  const suppliers = useAsync(() => listSuppliers(businessId).catch(() => []), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'pharmacy'), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<MedicineRow | 'new' | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [search, setSearch] = useState(''); const [category, setCategory] = useState(''); const [cls, setCls] = useState(''); const [show, setShow] = useState('')
  const file = useRef<HTMLInputElement>(null)
  if (!active) return null
  const manage = can('pharmacy.manage'); const stockIn = can('inventory.adjust')
  const q = search.trim().toLowerCase()
  const list = (medicines.data ?? []).filter((m) => (show === 'archived' ? !m.active : m.active) && (!category || m.categoryId === category) && (!cls || m.classification === cls)
    && (!q || [m.name, m.genericName, m.brand, m.sku, m.barcode, m.strength].some((v) => v?.toLowerCase().includes(q))) && (show !== 'low' || m.low || m.out) && (show !== 'expiry' || m.expired > 0 || m.undated > 0 || m.quarantined > 0))
  const undated = (batches.data ?? []).filter((b) => b.expiresOn === null && b.status === 'active').length
  const refresh = async () => { await Promise.all([medicines.refresh(), batches.refresh(), catalog.refresh()]) }

  function exportCsv() {
    const body = toCsv([['name', 'generic_name', 'strength', 'dosage_form', 'classification', 'category', 'manufacturer', 'barcode', 'unit', 'cost', 'price', 'reorder', 'saleable', 'quarantined', 'expired'],
      ...(medicines.data ?? []).map((m) => [m.name, m.genericName ?? '', m.strength ?? '', m.dosageForm, m.classification, m.categoryName ?? '', m.manufacturer ?? '', m.barcode ?? '', m.unit, m.costPrice ?? '', m.price, m.reorder ?? '', m.saleable, m.quarantined, m.expired])])
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'medicines.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  async function pick(e: ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) setImporting(await f.text()); e.target.value = '' }

  return (
    <>
      <PageHeader title="Medicines" description="Every medicine and pharmacy product you sell. Prescription-only and controlled medicines can only leave stock through an approved prescription. Stock changes only by receiving, selling, dispensing, counting or writing off, never by editing a number."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!medicines.data?.length}><Download className="size-4" aria-hidden /> Export CSV</Button>
          {manage && <><input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} aria-label="Choose a CSV file to import" /><Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import CSV</Button></>}
          {stockIn && <Button variant="secondary" onClick={() => setReceiving(true)}><PackagePlus className="size-4" aria-hidden /> Receive goods</Button>}
          {manage && <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add medicine</Button>}
        </div>} />
      {(medicines.error || batches.error) && <ErrorState message={(medicines.error ?? batches.error)!} />}
      {undated > 0 && <Notice>{undated} received batch{undated === 1 ? ' has' : 'es have'} no batch number or expiry date and cannot be sold yet. Complete {undated === 1 ? 'it' : 'them'} under Batches &amp; Expiry.</Notice>}
      <div className="my-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, generic, brand, barcode or strength" /></div>
        <div className="w-44"><SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        <div className="w-48"><SelectField label="Classification" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All</option>{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</SelectField></div>
        <div className="w-48"><SelectField label="Show" value={show} onChange={(e) => setShow(e.target.value)}><option value="">Active</option><option value="low">Low or out of stock</option><option value="expiry">Expired, quarantined or undated</option><option value="archived">Archived</option></SelectField></div>
      </div>
      {medicines.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title={medicines.data?.length ? 'No medicines match' : 'No medicines yet'} description={medicines.data?.length ? 'Try a different search or filter.' : 'Add medicines one by one, or import a CSV file. Importing never creates stock: record opening stock by receiving goods with their batch and expiry.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Medicine</th><th className="p-3">Category</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Saleable</th><th className="p-3 text-right">Not saleable</th><th className="p-3 text-right">Value</th>{manage && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((m) => {
                const blocked = m.quarantined + m.expired + m.undated
                return (
                  <tr data-row-link onClick={openRow} key={m.id} className={m.active ? '' : 'text-ink/50'}>
                    <td className="p-3 font-medium">{m.name} <Badge tone={CLASS_TONE[m.classification]}>{CLASS_LABEL[m.classification]}</Badge>{m.out && m.active && <> <Badge tone="danger">Out</Badge></>}{m.low && <> <Badge tone="warning">Low</Badge></>}
                      <div className="text-xs font-normal text-ink/60">{[m.genericName, m.strength, m.dosageForm !== 'other' ? m.dosageForm : null, m.manufacturer].filter(Boolean).join(' · ') || 'No details'}{m.packs.length > 0 && ` · ${m.packs.map((k) => `${k.name} = ${qty(k.units)}`).join(', ')}`}</div></td>
                    <td className="p-3">{m.categoryName ?? '–'}</td>
                    <td className="tabular p-3 text-right">{naira(m.price)}</td>
                    <td className="tabular p-3 text-right">{qty(m.saleable)} {m.unit}{m.reorder ? <div className="text-xs text-ink/60">Reorder at {qty(m.reorder)}</div> : null}</td>
                    <td className="tabular p-3 text-right">{blocked > 0 ? <span className="text-warning">{qty(blocked)}<div className="text-xs text-ink/60">{[m.expired && `${qty(m.expired)} expired`, m.quarantined && `${qty(m.quarantined)} quarantined`, m.undated && `${qty(m.undated)} undated`].filter(Boolean).join(', ')}</div></span> : '–'}</td>
                    <td className="tabular p-3 text-right">{naira(m.stockValue)}</td>
                    {manage && <td className="p-3 text-right"><button type="button" aria-label={`Open ${m.name}`} onClick={() => setEditing(m)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <MedicineDialog businessId={businessId} medicine={editing === 'new' ? null : editing} categories={categories.data ?? []} suppliers={suppliers.data ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {receiving && <ReceiveDialog businessId={businessId} medicines={(medicines.data ?? []).filter((m) => m.active)} locations={catalog.data?.locations ?? []} suppliers={suppliers.data ?? []} onClose={() => setReceiving(false)} onSaved={async () => { setReceiving(false); await refresh() }} />}
      {importing !== null && <ImportDialog businessId={businessId} text={importing} existing={medicines.data ?? []} categories={categories.data ?? []} onClose={() => setImporting(null)} onDone={async () => { setImporting(null); await refresh() }} />}
    </>
  )
}

function MedicineDialog({ businessId, medicine, categories, suppliers, onClose, onSaved }: { businessId: string; medicine: MedicineRow | null; categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [packs, setPacks] = useState<{ name: string; units: string }[]>(medicine ? medicine.packs.map((k) => ({ name: k.name, units: String(k.units) })) : [])
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
    const input: MedicineInput = {
      id: medicine?.id ?? null, name: s('name'), sku: s('sku'), barcode: s('barcode'), categoryId: s('category') || null, unit: medicine?.unit ?? s('unit'), cost: s('cost') === '' ? null : Number(s('cost')), price: Math.round(Number(s('price')) * 100) / 100,
      reorder: s('reorder') === '' ? null : Number(s('reorder')), supplierId: s('supplier') || null, active: medicine ? f.get('active') === 'on' : true, packs: packs.map((k) => ({ name: k.name.trim(), units: Number(k.units) })),
      genericName: s('generic'), brand: s('brand'), activeIngredient: s('ingredient'), strength: s('strength'), dosageForm: s('form'), manufacturer: s('manufacturer'), registrationNo: s('registration'), classification: s('classification') as Classification, storage: s('storage'), maxStock: s('max') === '' ? null : Number(s('max')),
    }
    await runner.run((k) => saveMedicine(businessId, input, k), 'Saved.')
  }
  return (
    <DetailPage title={medicine ? `Edit ${medicine.name}` : 'Add a medicine'} onClose={onClose} view={!!medicine} modal={!medicine} actions={medicine ? <DeleteButton businessId={businessId} kind="product" id={medicine.id} label={medicine.name} noun="medicine" onDeleted={onSaved} /> : undefined} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><TextField label="Name" name="name" defaultValue={medicine?.name} error={errors.name} autoFocus maxLength={200} /></div>
          <SelectField label="Classification" name="classification" defaultValue={medicine?.classification ?? 'otc'}>{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</SelectField>
          <TextField label="Generic name" name="generic" defaultValue={medicine?.genericName ?? ''} />
          <TextField label="Brand" name="brand" defaultValue={medicine?.brand ?? ''} />
          <TextField label="Active ingredient" name="ingredient" defaultValue={medicine?.activeIngredient ?? ''} />
          <TextField label="Strength" name="strength" defaultValue={medicine?.strength ?? ''} placeholder="e.g. 500mg" />
          <SelectField label="Dosage form" name="form" defaultValue={medicine?.dosageForm ?? 'tablet'}>{DOSAGE_FORMS.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</SelectField>
          <TextField label="Manufacturer" name="manufacturer" defaultValue={medicine?.manufacturer ?? ''} />
          <TextField label="Registration number (e.g. NAFDAC)" name="registration" defaultValue={medicine?.registrationNo ?? ''} />
          <SelectField label="Category" name="category" defaultValue={medicine?.categoryId ?? ''}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="Barcode" name="barcode" defaultValue={medicine?.barcode ?? ''} hint="A scanner types this into the till." />
          <TextField label="SKU / internal code" name="sku" defaultValue={medicine?.sku ?? ''} />
          <TextField label="Selling price" name="price" type="number" min="0" step="0.01" defaultValue={medicine?.price ?? ''} error={errors.price} />
          <TextField label="Purchase cost" name="cost" type="number" min="0" step="0.01" defaultValue={medicine?.costPrice ?? ''} error={errors.cost} hint="Per single unit; receiving sets the real average." />
          {medicine ? <TextField label="Dispensing unit" value={medicine.unit} disabled readOnly hint="Fixed once created." /> : (
            <SelectField label="Dispensing unit" name="unit" defaultValue="each">{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          )}
          <TextField label="Reorder when stock reaches" name="reorder" type="number" min="0" step="any" defaultValue={medicine?.reorder ?? ''} />
          <TextField label="Maximum stock (optional)" name="max" type="number" min="0" step="any" defaultValue={medicine?.maxStock ?? ''} />
          {suppliers.length > 0 && <SelectField label="Preferred supplier" name="supplier" defaultValue={medicine?.supplierId ?? ''}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>}
          <div className="sm:col-span-3"><TextField label="Storage instructions" name="storage" defaultValue={medicine?.storage ?? ''} placeholder="e.g. Store below 25°C, keep dry" /></div>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Pack conversions <span className="font-normal text-ink/60">(how many single units are in a strip, pack, carton or box)</span></p>
          {packs.map((k, i) => (
            <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_160px_auto]">
              <TextField label={i === 0 ? 'Name' : ' '} value={k.name} placeholder="e.g. strip" onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <TextField label={i === 0 ? 'Single units in it' : ' '} type="number" min="0" step="any" value={k.units} onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} />
              <button type="button" aria-label="Remove pack" onClick={() => setPacks(packs.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger"><X className="size-4" aria-hidden /></button>
            </div>
          ))}
          {errors.packs && <p className="text-xs text-danger">{errors.packs}</p>}
          <Button type="button" variant="ghost" onClick={() => setPacks([...packs, { name: '', units: '' }])}><Plus className="size-4" aria-hidden /> Add pack</Button>
          <p className="text-xs text-ink/60">Example: a strip of 10 tablets is 10; a pack of 10 strips is 100. Stock is always kept in single units and sales record the unit they were made in.</p>
        </div>
        {medicine && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={medicine.active} /> Active <span className="text-ink/60">(archived medicines cannot be sold)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{medicine ? 'Save' : 'Add medicine'}</Button></div>
      </form>
    </DetailPage>
  )
}

interface Line { productId: string; pack: string; received: string; rejected: string; reason: string; cost: string; batch: string; expiry: string; manufactured: string }
const blank = (): Line => ({ productId: '', pack: '', received: '', rejected: '', reason: '', cost: '', batch: '', expiry: '', manufactured: '' })

function ReceiveDialog({ businessId, medicines, locations, suppliers, onClose, onSaved }: { businessId: string; medicines: MedicineRow[]; locations: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const purchases = useAsync(() => listPurchases(businessId).catch(() => []), [businessId])
  const [lines, setLines] = useState<Line[]>([blank()])
  const [purchaseId, setPurchaseId] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const open = (purchases.data ?? []).filter((p) => p.status === 'ordered' || p.status === 'partially_received')
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  async function choosePurchase(id: string) {
    setPurchaseId(id)
    if (!id) return setLines([blank()])
    const d = await purchaseDetail(businessId, id)
    setLines(d.items.filter((i) => i.ordered > i.received).map((i) => ({ ...blank(), productId: i.productId, received: String(Math.round((i.ordered - i.received) * 10000) / 10000), cost: String(i.unitCost) })))
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    for (const [i, l] of lines.entries()) {
      const n = i + 1
      if (!l.productId) return setProblem(`Line ${n}: choose the medicine.`)
      if (!(Number(l.received) > 0)) return setProblem(`Line ${n}: enter the quantity received.`)
      if (Number(l.rejected || 0) > 0 && l.reason.trim().length < 3) return setProblem(`Line ${n}: say why goods were rejected.`)
      if (!l.batch.trim()) return setProblem(`Line ${n}: enter the batch number.`)
      if (!l.expiry) return setProblem(`Line ${n}: enter the expiry date.`)
    }
    setProblem(null)
    const items: ReceiveItem[] = lines.map((l) => ({ productId: l.productId, pack: l.pack || null, received: Number(l.received), rejected: Number(l.rejected || 0), reason: l.reason, unitCost: l.cost === '' ? null : Number(l.cost), batch: l.batch, expiry: l.expiry, manufactured: l.manufactured || null }))
    await runner.run((k) => receiveGoods(businessId, { locationId: s('location'), purchaseId: purchaseId || null, supplierId: s('supplier') || null, invoice: s('invoice'), items }, k), 'Goods received.')
  }
  return (
    <DetailPage modal title="Receive goods" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <SelectField label="Against purchase order" value={purchaseId} onChange={(e) => void choosePurchase(e.target.value)}><option value="">No purchase order</option>{open.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}</SelectField>
          {!purchaseId && suppliers.length > 0 && <SelectField label="Supplier" name="supplier" defaultValue=""><option value="">Select…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>}
          <TextField label="Supplier invoice" name="invoice" />
          <SelectField label="Into" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => {
            const m = medicines.find((x) => x.id === l.productId)
            return (
              <div key={i} className="rounded-md border border-line p-3">
                <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_90px_90px_110px]">
                  <SelectField label="Medicine" value={l.productId} onChange={(e) => set(i, { productId: e.target.value, pack: '' })}><option value="">Select…</option>{medicines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>
                  <SelectField label="Received in" value={l.pack} onChange={(e) => set(i, { pack: e.target.value })}><option value="">{m ? `${m.unit} (single units)` : 'Single units'}</option>{(m?.packs ?? []).map((k) => <option key={k.name} value={k.name}>{k.name} ({qty(k.units)})</option>)}</SelectField>
                  <TextField label="Received" type="number" min="0" step="any" value={l.received} onChange={(e) => set(i, { received: e.target.value })} />
                  <TextField label="Rejected" type="number" min="0" step="any" value={l.rejected} onChange={(e) => set(i, { rejected: e.target.value })} />
                  <TextField label="Cost each" type="number" min="0" step="0.01" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
                </div>
                <div className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_150px_150px_1.2fr_auto]">
                  <TextField label="Batch number" value={l.batch} onChange={(e) => set(i, { batch: e.target.value })} />
                  <TextField label="Expiry date" type="date" value={l.expiry} onChange={(e) => set(i, { expiry: e.target.value })} />
                  <TextField label="Manufactured (optional)" type="date" value={l.manufactured} onChange={(e) => set(i, { manufactured: e.target.value })} />
                  <TextField label="Reason for rejected goods" value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} disabled={!(Number(l.rejected) > 0)} />
                  <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger disabled:opacity-30"><X className="size-4" aria-hidden /></button>
                </div>
              </div>
            )
          })}
          <Button type="button" variant="ghost" onClick={() => setLines([...lines, blank()])}><Plus className="size-4" aria-hidden /> Add line</Button>
        </div>
        <Notice>Only the accepted quantity (received less rejected) enters stock, in the batch you name. Expired goods cannot be accepted. With a purchase order, only the accepted quantity is counted against the order.</Notice>
        {(problem || runner.error) && <ErrorState title="Not received" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Receive</Button></div>
      </form>
    </DetailPage>
  )
}

function ImportDialog({ businessId, text, existing, categories, onClose, onDone }: { businessId: string; text: string; existing: MedicineRow[]; categories: { id: string; name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const grid = parseCsv(text)
  const head = (grid[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name)
  const names = new Set(existing.map((p) => p.name.trim().toLowerCase())); const barcodes = new Set(existing.map((p) => p.barcode).filter(Boolean))
  const seen = new Set<string>()
  const rows = grid.slice(1).filter((r) => r.some((c) => c.trim())).map((r, i) => {
    const g = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '')
    const problems: string[] = []
    const name = g('name')
    if (name.length < 2) problems.push('name is missing')
    if (g('price') === '' || !(Number(g('price')) >= 0)) problems.push('price must be a number')
    if (g('cost') !== '' && !(Number(g('cost')) >= 0)) problems.push('cost must be a number')
    if (name && (names.has(name.toLowerCase()) || seen.has(name.toLowerCase()))) problems.push('a medicine with this name already exists')
    if (g('barcode') && barcodes.has(g('barcode'))) problems.push('barcode already used')
    const cls = (g('classification') || 'otc').toLowerCase().replace(/[ -]/g, '_')
    if (!(CLASSIFICATIONS as readonly string[]).includes(cls)) problems.push(`classification "${g('classification')}" is not valid`)
    const form = (g('dosage_form') || 'other').toLowerCase()
    if (!(DOSAGE_FORMS as readonly string[]).includes(form)) problems.push(`dosage form "${g('dosage_form')}" is not valid`)
    const cat = g('category') ? categories.find((c) => c.name.toLowerCase() === g('category').toLowerCase()) : undefined
    if (g('category') && !cat) problems.push(`category "${g('category')}" does not exist`)
    if (name) seen.add(name.toLowerCase())
    return { line: i + 2, name, g, cls, form, cat, problems }
  })
  const missing = ['name', 'price'].filter((h) => col(h) < 0)
  const good = rows.filter((r) => r.problems.length === 0)
  const [progress, setProgress] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  async function commit() {
    setBusy(true); setError(null)
    let done = 0
    for (const r of good) {
      const unit = ['each', 'dozen', 'kg', 'g', 'l', 'ml'].includes(r.g('unit')) ? r.g('unit') : 'each'
      const err = await saveMedicine(businessId, { id: null, name: r.name, sku: r.g('sku'), barcode: r.g('barcode'), categoryId: r.cat?.id ?? null, unit, cost: r.g('cost') === '' ? null : Number(r.g('cost')), price: Math.round(Number(r.g('price')) * 100) / 100, reorder: r.g('reorder') === '' ? null : Number(r.g('reorder')),
        supplierId: null, active: true, packs: [], genericName: r.g('generic_name'), brand: r.g('brand'), activeIngredient: '', strength: r.g('strength'), dosageForm: r.form, manufacturer: r.g('manufacturer'), registrationNo: '', classification: r.cls as Classification, storage: '', maxStock: null }, crypto.randomUUID())
      if (err) { setError(`Stopped at line ${r.line} (${r.name}): ${err}. ${done} medicine${done === 1 ? '' : 's'} before it were added.`); setBusy(false); await onDone(); return }
      done++; setProgress(`${done} of ${good.length} added`)
    }
    setBusy(false); await onDone()
  }
  return (
    <Dialog title="Import medicines" onClose={onClose} wide>
      {missing.length > 0 ? <ErrorState title="This file cannot be imported" message={`The first row must name its columns. Missing: ${missing.join(', ')}. Expected: name, price, and optionally generic_name, strength, dosage_form, classification, category, manufacturer, brand, barcode, sku, unit, cost, reorder.`} /> : (
        <>
          <p className="mb-3 text-sm text-ink/80">Preview: <b>{good.length}</b> medicine{good.length === 1 ? '' : 's'} ready to add, <b>{rows.length - good.length}</b> with problems that will be skipped. Nothing is saved until you confirm. No stock is created: receive goods afterwards with their batch and expiry.</p>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-2">Line</th><th className="p-2">Name</th><th className="p-2">Class</th><th className="p-2 text-right">Price</th><th className="p-2">Result</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{rows.map((r) => <tr data-row-link onClick={openRow} key={r.line}><td className="p-2">{r.line}</td><td className="p-2">{r.name || '–'}</td><td className="p-2">{CLASS_LABEL[r.cls] ?? r.cls}</td><td className="tabular p-2 text-right">{r.g('price')}</td><td className="p-2">{r.problems.length ? <span className="text-danger">{r.problems.join('; ')}</span> : <Badge tone="success">Ready</Badge>}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {error && <ErrorState title="Import stopped" message={error} />}
      {progress && !error && <p className="mt-2 text-sm text-ink/70">{progress}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button>{missing.length === 0 && <Button onClick={() => void commit()} loading={busy} disabled={!good.length}>Add {good.length} medicine{good.length === 1 ? '' : 's'}</Button>}</div>
    </Dialog>
  )
}
