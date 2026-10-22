import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { isDemoMode } from '@/shared/utilities/env'
import { Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import * as api from '@/modules/inventory/inventoryApi'
import type { InventoryData, MovementRow, Product } from '@/modules/inventory/inventoryApi'
import { stockStatus } from '@/modules/inventory/ledger'
import type { StockStatus } from '@/modules/inventory/ledger'

const TABS = ['Stock', 'Products', 'Locations', 'Movements', 'Receive', 'Adjust / issue', 'Transfer'] as const
type Tab = (typeof TABS)[number]

const naira = (n: number | null) => (n === null ? '–' : `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`)
const fmt = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 4 })

function useInventory(businessId: string, industry: Parameters<typeof api.useDemoData>[1]) {
  const demo = api.useDemoData(businessId, industry, isDemoMode)
  const [live, setLive] = useState<InventoryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (isDemoMode) return
    try { setLive(await api.loadInventory(businessId)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [businessId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  return { data: isDemoMode ? demo : live, error, refresh }
}

/** One idempotency key per form attempt: retries and double-clicks reuse it; success renews it. */
function useIdempotencyKey() {
  const ref = useRef(crypto.randomUUID())
  return { current: () => ref.current, renew: () => { ref.current = crypto.randomUUID() } }
}

export function InventoryPage() {
  const { active } = useBusiness()
  const [params] = useSearchParams()
  const requested = params.get('tab')
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t === requested) ?? 'Stock')
  const [perms, setPerms] = useState<string[] | null>(null)
  const businessId = active?.id ?? ''
  const { data, error, refresh } = useInventory(businessId, active?.industry ?? 'retail')

  useEffect(() => {
    if (!businessId) return
    let live = true
    void api.myPermissions(businessId).then((p) => live && setPerms(p))
    return () => { live = false }
  }, [businessId])

  if (!active) return null
  const canWrite = perms?.includes('inventory.adjust') ?? false

  return (
    <>
      <PageHeader title="Inventory" description="Products, stock levels and the full movement history. Stock is derived from an append-only ledger." />
      {error && <ErrorState message={error} />}
      <div role="tablist" aria-label="Inventory sections" className="mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button
            key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}
          >{t}</button>
        ))}
      </div>
      {!data ? <Spinner /> : (
        <>
          {!canWrite && perms && ['Receive', 'Adjust / issue', 'Transfer'].includes(tab) && (
            <Notice>Your role can view inventory but not change it.</Notice>
          )}
          {tab === 'Stock' && <StockTab data={data} />}
          {tab === 'Products' && <ProductsTab data={data} businessId={businessId} canWrite={canWrite} onChanged={refresh} />}
          {tab === 'Locations' && <LocationsTab businessId={businessId} industry={active.industry} canWrite={canWrite} onChanged={refresh} />}
          {tab === 'Movements' && <MovementsTab data={data} businessId={businessId} canWrite={canWrite} onChanged={refresh} />}
          {tab === 'Receive' && canWrite && <ReceiveForm data={data} businessId={businessId} onDone={refresh} />}
          {tab === 'Adjust / issue' && canWrite && <AdjustForm data={data} businessId={businessId} onDone={refresh} />}
          {tab === 'Transfer' && canWrite && <TransferForm data={data} businessId={businessId} onDone={refresh} />}
        </>
      )}
    </>
  )
}

// ----------------------------------------------------------------- stock
const STATUS_STYLE: Record<StockStatus, string> = {
  out: 'bg-danger-soft text-danger',
  low: 'bg-warning-soft text-warning',
  ok: 'bg-success-soft text-success',
}
const STATUS_LABEL: Record<StockStatus, string> = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' }

function StockTab({ data }: { data: InventoryData }) {
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<'' | StockStatus>('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.products
      .filter((p) => p.status === 'active')
      .filter((p) => !term || [p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(term)))
      .map((p) => {
        const bals = data.balances.filter((b) => b.productId === p.id && (!location || b.locationId === location))
        const qty = bals.reduce((s, b) => s + b.qty, 0)
        const value = bals.reduce((s, b) => s + b.qty * (b.avgCost ?? 0), 0)
        return { p, qty, avg: qty > 0 ? value / qty : null, value, st: stockStatus(qty, p.reorderLevel) }
      })
      .filter((r) => !status || r.st === status)
  }, [data, search, location, status])

  const total = rows.reduce((s, r) => s + Math.max(r.value, 0), 0)

  return (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or barcode" />
        <SelectField label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </SelectField>
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | StockStatus)}>
          <option value="">All</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="ok">In stock</option>
        </SelectField>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No products match" description={data.products.length ? 'Try clearing the filters.' : 'Add your first product on the Products tab.'} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70">
              <tr><th className="p-3">Product</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Avg cost</th><th className="p-3 text-right">Value</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map(({ p, qty, avg, value, st }) => (
                <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer hover:bg-surface">
                  <td className="p-3"><b>{p.name}</b><div className="text-xs text-ink/60">{p.sku ?? 'No SKU'}</div></td>
                  <td className="p-3 text-right tabular-nums">{fmt(qty)} {p.unit}</td>
                  <td className="p-3 text-right tabular-nums">{naira(avg)}</td>
                  <td className="p-3 text-right tabular-nums">{naira(value)}</td>
                  <td className="p-3"><span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', STATUS_STYLE[st])}>{STATUS_LABEL[st]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-ink/10 p-3 text-right text-xs text-ink/60">Inventory value (weighted-average cost): <b>{naira(total)}</b></p>
        </Card>
      )}
      {open && <ProductDetail data={data} id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// -------------------------------------------------------------- products
function ProductsTab({ data, businessId, canWrite, onChanged }: { data: InventoryData; businessId: string; canWrite: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const form = e.currentTarget
    const optional = (k: string) => (String(f.get(k) ?? '').trim() === '' ? null : Number(f.get(k)))
    const next: Record<string, string> = {}
    if (!String(f.get('name')).trim()) next.name = 'Enter the product name.'
    const price = Number(f.get('price') || 0)
    if (!(price >= 0)) next.price = 'Price cannot be negative.'
    for (const k of ['cost', 'reorder']) { const v = optional(k); if (v !== null && !(v >= 0)) next[k] = 'Must be zero or more.' }
    setFieldErrors(next)
    if (Object.keys(next).length) return
    const err = await api.createProduct(businessId, {
      name: String(f.get('name')), sku: String(f.get('sku') ?? ''), barcode: String(f.get('barcode') ?? ''), unit: String(f.get('unit')),
      sellingPrice: price, defaultCost: optional('cost'), reorderLevel: optional('reorder'),
    })
    setError(err)
    if (!err) { form.reset(); await onChanged() }
  }

  async function toggle(p: Product) {
    setError(await api.setProductStatus(businessId, p.id, p.status === 'active' ? 'archived' : 'active'))
    await onChanged()
  }

  return (
    <>
      {error && <ErrorState message={error} />}
      {canWrite && (
        <Card className="mb-4">
          <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
            <TextField label="Name" name="name" error={fieldErrors.name} />
            <TextField label="SKU (optional)" name="sku" />
            <TextField label="Barcode (optional)" name="barcode" />
            <SelectField label="Unit" name="unit" defaultValue="each">{data.units.map((u) => <option key={u} value={u}>{u}</option>)}</SelectField>
            <TextField label="Selling price (₦)" name="price" type="number" step="0.01" min="0" error={fieldErrors.price} />
            <TextField label="Default cost (₦)" name="cost" type="number" step="0.01" min="0" error={fieldErrors.cost} />
            <TextField label="Reorder level" name="reorder" type="number" step="any" min="0" error={fieldErrors.reorder} hint="Low-stock alert at or below this quantity." />
            <div className="flex items-end"><Button type="submit">Add product</Button></div>
          </form>
        </Card>
      )}
      {data.products.length === 0 ? <EmptyState title="No products yet" description="Products you add appear here." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3">Barcode</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Reorder at</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {data.products.map((p) => (
                <tr key={p.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setOpen(p.id) }} className={clsx('cursor-pointer hover:bg-surface', p.status === 'archived' && 'opacity-50')}>
                  <td className="p-3"><b>{p.name}</b><div className="text-xs text-ink/60">{p.sku ?? 'No SKU'} · {p.unit}</div></td>
                  <td className="p-3">{p.barcode ?? '–'}</td>
                  <td className="p-3 text-right tabular-nums">{naira(p.sellingPrice)}</td>
                  <td className="p-3 text-right tabular-nums">{p.reorderLevel ?? '–'}</td>
                  <td className="p-3 text-right">{canWrite && <Button variant="ghost" onClick={() => void toggle(p)}>{p.status === 'active' ? 'Archive' : 'Restore'}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <ProductDetail data={data} id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** A product's own page: its details, where its stock is, and the ledger entries behind that stock. */
function ProductDetail({ data, id, onClose }: { data: InventoryData; id: string; onClose: () => void }) {
  const p = data.products.find((x) => x.id === id)
  if (!p) return null
  const bals = data.balances.filter((b) => b.productId === id)
  const qty = bals.reduce((a, b) => a + b.qty, 0)
  const value = bals.reduce((a, b) => a + b.qty * (b.avgCost ?? 0), 0)
  const moves = data.movements.filter((m) => m.productId === id).slice(0, 25)
  const where = (lid: string) => data.locations.find((l) => l.id === lid)?.name ?? 'Location'
  const st = stockStatus(qty, p.reorderLevel)
  return (
    <DetailPage title={p.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {([['On hand', `${fmt(qty)} ${p.unit}`], ['Stock value', naira(value)], ['Selling price', naira(p.sellingPrice)], ['Default cost', naira(p.defaultCost)]] as const).map(([t, v]) => (
            <div key={t} className="rounded-lg border border-line bg-white p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{t}</p><p className="tabular mt-1 text-lg font-semibold">{v}</p></div>
          ))}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-ink/60">SKU</dt><dd>{p.sku ?? '–'}</dd></div>
          <div><dt className="text-xs text-ink/60">Barcode</dt><dd>{p.barcode ?? '–'}</dd></div>
          <div><dt className="text-xs text-ink/60">Reorder level</dt><dd>{p.reorderLevel ?? '–'}</dd></div>
          <div><dt className="text-xs text-ink/60">Stock status</dt><dd><span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', STATUS_STYLE[st])}>{STATUS_LABEL[st]}</span></dd></div>
          <div><dt className="text-xs text-ink/60">Record</dt><dd>{p.status === 'active' ? 'Active' : 'Archived'}</dd></div>
        </dl>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Stock by location</h3>
          {bals.length === 0 ? <p className="text-sm text-ink/60">No stock recorded yet.</p> : (
            <table className="w-full text-sm"><thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Location</th><th className="py-1 text-right">On hand</th><th className="py-1 text-right">Average cost</th><th className="py-1 text-right">Value</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{bals.map((b) => <tr key={b.locationId}><td className="py-1.5">{where(b.locationId)}</td><td className="tabular py-1.5 text-right">{fmt(b.qty)} {p.unit}</td><td className="tabular py-1.5 text-right">{naira(b.avgCost)}</td><td className="tabular py-1.5 text-right">{naira(b.qty * (b.avgCost ?? 0))}</td></tr>)}</tbody></table>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Recent stock movements</h3>
          {moves.length === 0 ? <p className="text-sm text-ink/60">Nothing recorded yet.</p> : (
            <ul className="divide-y divide-ink/10 text-sm">{moves.map((m) => <li key={m.id} className="flex flex-wrap items-baseline gap-2 py-1.5"><span className="font-medium">{TYPE_LABEL[m.type] ?? m.type}</span><span className="tabular">{m.delta > 0 ? '+' : ''}{fmt(m.delta)} {p.unit}</span><span className="text-ink/60">{where(m.locationId)}{m.reason ? ` · ${m.reason}` : ''}{m.reversed ? ' · reversed' : ''}</span><span className="ml-auto text-xs text-ink/50">{new Date(m.at).toLocaleString('en-NG')}</span></li>)}</ul>
          )}
        </div>
      </div>
    </DetailPage>
  )
}

// ------------------------------------------------------------- locations
/** The places stock is kept (a store, a shelf, a cold room). Add one, rename it, or archive it when it is no longer used. */
function LocationsTab({ businessId, industry, canWrite, onChanged }: { businessId: string; industry: Parameters<typeof api.listLocations>[1]; canWrite: boolean; onChanged: () => Promise<void> }) {
  const places = useAsync(() => api.listLocations(businessId, industry), [businessId, industry])
  const [editing, setEditing] = useState<api.LocationRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => { await Promise.all([places.refresh(), onChanged()]) }
  async function setStatus(l: api.LocationRow, status: 'active' | 'archived') { setError(await api.setLocationStatus(businessId, l.id, status)); await refresh() }
  const typeName = (t: string) => api.LOCATION_TYPES.find(([v]) => v === t)?.[1] ?? t
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/70">The places your stock is kept. A new business starts with one (Main store). Add more if you keep stock in different places, and archive one you no longer use: it must be empty first, and its history stays.</p>
        {canWrite && <Button onClick={() => setEditing('new')}>Add location</Button>}
      </div>
      {(error || places.error) && <ErrorState message={error ?? places.error!} />}
      {places.loading ? <Spinner /> : (
        <Card className="p-0">
          <ul className="divide-y divide-ink/10 text-sm">
            {(places.data ?? []).map((l) => (
              <li key={l.id} className={clsx('flex flex-wrap items-center gap-3 p-3', !l.active && 'text-ink/50')}>
                <span className="font-medium">{l.name}</span>
                <span className="text-xs text-ink/60">{typeName(l.type)}{!l.active ? ' · archived' : l.stocked > 0 ? ` · ${l.stocked} product${l.stocked === 1 ? '' : 's'} in stock` : ' · empty'}</span>
                {canWrite && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" onClick={() => setEditing(l)}>Rename</Button>
                    {l.active ? <Button variant="ghost" onClick={() => void setStatus(l, 'archived')}>Archive</Button> : <Button variant="ghost" onClick={() => void setStatus(l, 'active')}>Restore</Button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <LocationDialog businessId={businessId} location={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
    </>
  )
}

function LocationDialog({ businessId, location, onClose, onSaved }: { businessId: string; location: api.LocationRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const err = await api.saveLocation(businessId, { id: location?.id ?? null, name: String(f.get('name') ?? ''), type: String(f.get('type') ?? 'store') })
    if (err) return setError(err)
    await onSaved()
  }
  return (
    <Dialog title={location ? 'Rename location' : 'Add a location'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={location?.name} autoFocus maxLength={80} placeholder="e.g. Shelf 2, Cold room" />
        <SelectField label="What kind of place is it?" name="type" defaultValue={location?.type ?? 'store'}>{api.LOCATION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        {error && <ErrorState title="Not saved" message={error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">Save</Button></div>
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------- movements
const TYPE_LABEL: Record<string, string> = {
  receipt: 'Receipt', sale: 'Sale', return_in: 'Customer return', return_out: 'Supplier return', transfer_in: 'Transfer in',
  transfer_out: 'Transfer out', adjustment: 'Adjustment', count_adjustment: 'Count adjustment', issue: 'Issue', reversal: 'Reversal',
  production_consumption: 'Production use', production_output: 'Production output',
}

function MovementsTab({ data, businessId, canWrite, onChanged }: { data: InventoryData; businessId: string; canWrite: boolean; onChanged: () => Promise<void> }) {
  const [type, setType] = useState('')
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()
  const name = (id: string) => data.products.find((p) => p.id === id)?.name ?? 'Unknown'
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? ''
  const rows = data.movements.filter((m) => !type || m.type === type)

  async function undo(m: MovementRow) {
    const reason = window.prompt('Reason for reversing this movement?')
    if (!reason) return
    const err = await api.reverse(businessId, m.id, reason, key.current())
    setError(err)
    if (!err) { key.renew(); await onChanged() }
  }

  return (
    <>
      {error && <ErrorState message={error} />}
      <div className="mb-3 max-w-xs">
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All movements</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
      </div>
      {rows.length === 0 ? <EmptyState title="No movements" description="Receipts, sales, transfers and adjustments are listed here." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">When</th><th className="p-3">Product</th><th className="p-3">Type</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit cost</th><th className="p-3">Note</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="p-3 whitespace-nowrap">{new Date(m.at).toLocaleString()}</td>
                  <td className="p-3">{name(m.productId)}<div className="text-xs text-ink/60">{loc(m.locationId)}</div></td>
                  <td className="p-3">{TYPE_LABEL[m.type] ?? m.type}{m.reversed && <span className="ml-1 text-xs text-ink/50">(reversed)</span>}</td>
                  <td className={clsx('p-3 text-right tabular-nums', m.delta < 0 ? 'text-danger' : 'text-success')}>{m.delta > 0 ? '+' : ''}{fmt(m.delta)}</td>
                  <td className="p-3 text-right tabular-nums">{naira(m.unitCost)}</td>
                  <td className="p-3 text-ink/70">{m.reason ?? ''}</td>
                  <td className="p-3 text-right">
                    {canWrite && !m.reversed && !['reversal', 'transfer_in', 'transfer_out'].includes(m.type) && (
                      <Button variant="ghost" onClick={() => void undo(m)}>Reverse</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

// ----------------------------------------------------------------- forms
function useFormRunner(onDone: () => Promise<void>) {
  const key = useIdempotencyKey()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: (k: string) => Promise<string | null>, form: HTMLFormElement, success: string) {
    setBusy(true); setOk(null)
    const err = await action(key.current())
    setBusy(false); setError(err)
    if (!err) { key.renew(); form.reset(); setOk(success); await onDone() }
  }
  return { error, ok, busy, run }
}

function FormShell({ title, state, children, onSubmit, submitLabel }: { title: string; state: ReturnType<typeof useFormRunner>; children: ReactNode; onSubmit: (e: FormEvent<HTMLFormElement>) => void; submitLabel: string }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <form onSubmit={onSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
        {children}
        <div className="space-y-3 sm:col-span-2">
          {state.error && <ErrorState title="Not posted" message={state.error} />}
          {state.ok && <Notice>{state.ok}</Notice>}
          <Button type="submit" loading={state.busy}>{submitLabel}</Button>
        </div>
      </form>
    </Card>
  )
}

const activeProducts = (d: InventoryData) => d.products.filter((p) => p.status === 'active')
const ProductSelect = ({ data, error }: { data: InventoryData; error?: string }) => (
  <SelectField label="Product" name="product" defaultValue="" error={error}>
    <option value="" disabled>Select…</option>
    {activeProducts(data).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
  </SelectField>
)
const LocationSelect = ({ data, name, label }: { data: InventoryData; name: string; label: string }) => (
  <SelectField label={label} name={name}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
)

function useValidated() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const check = (f: FormData, rules: Record<string, (v: string) => string | null>) => {
    const next: Record<string, string> = {}
    for (const [k, rule] of Object.entries(rules)) { const m = rule(String(f.get(k) ?? '')); if (m) next[k] = m }
    setErrors(next)
    return Object.keys(next).length === 0
  }
  return { errors, check }
}
const positive = (v: string) => (Number(v) > 0 ? null : 'Enter a quantity greater than zero.')
const chosen = (v: string) => (v ? null : 'Select a product.')

function ReceiveForm({ data, businessId, onDone }: { data: InventoryData; businessId: string; onDone: () => Promise<void> }) {
  const state = useFormRunner(onDone)
  const { errors, check } = useValidated()
  return (
    <FormShell title="Receive stock" state={state} submitLabel="Post receipt" onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget; const f = new FormData(form)
      if (!check(f, { product: chosen, qty: positive, cost: (v) => (v === '' || Number(v) >= 0 ? null : 'Cost cannot be negative.') })) return
      void state.run((k) => api.receive(businessId, String(f.get('location')), [{ productId: String(f.get('product')), quantity: Number(f.get('qty')), unitCost: f.get('cost') === '' ? null : Number(f.get('cost')) }], String(f.get('ref') ?? ''), k), form, 'Stock received.')
    }}>
      <LocationSelect data={data} name="location" label="Location" />
      <ProductSelect data={data} error={errors.product} />
      <TextField label="Quantity" name="qty" type="number" step="any" min="0" error={errors.qty} />
      <TextField label="Unit cost (₦)" name="cost" type="number" step="0.01" min="0" error={errors.cost} hint="Blank uses the current average or default cost." />
      <TextField label="Reference (optional)" name="ref" placeholder="Supplier invoice / delivery note" />
    </FormShell>
  )
}

function AdjustForm({ data, businessId, onDone }: { data: InventoryData; businessId: string; onDone: () => Promise<void> }) {
  const state = useFormRunner(onDone)
  const { errors, check } = useValidated()
  return (
    <FormShell title="Adjust or issue stock" state={state} submitLabel="Post" onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget; const f = new FormData(form)
      if (!check(f, { product: chosen, change: (v) => (Number(v) !== 0 && v !== '' ? null : 'Enter a non-zero change (use negative to remove).'), reason: (v) => (v.trim().length >= 3 ? null : 'A reason is required.') })) return
      void state.run((k) => api.adjust(businessId, String(f.get('location')), String(f.get('product')), Number(f.get('change')), String(f.get('reason')), k), form, 'Adjustment posted.')
    }}>
      <LocationSelect data={data} name="location" label="Location" />
      <ProductSelect data={data} error={errors.product} />
      <TextField label="Quantity change" name="change" type="number" step="any" error={errors.change} hint="Positive adds stock, negative removes it." />
      <TextField label="Reason" name="reason" error={errors.reason} placeholder="e.g. damaged, spillage, found stock" />
    </FormShell>
  )
}

function TransferForm({ data, businessId, onDone }: { data: InventoryData; businessId: string; onDone: () => Promise<void> }) {
  const state = useFormRunner(onDone)
  const { errors, check } = useValidated()
  if (data.locations.length < 2) return <EmptyState title="Add a second location" description="Transfers move stock between two locations." />
  return (
    <FormShell title="Transfer stock" state={state} submitLabel="Post transfer" onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget; const f = new FormData(form)
      if (!check(f, { product: chosen, qty: positive, to: (v) => (v !== String(f.get('from')) ? null : 'Choose a different destination.') })) return
      void state.run((k) => api.transfer(businessId, String(f.get('from')), String(f.get('to')), [{ productId: String(f.get('product')), quantity: Number(f.get('qty')) }], k), form, 'Transfer posted.')
    }}>
      <LocationSelect data={data} name="from" label="From" />
      <SelectField label="To" name="to" defaultValue={data.locations[1]?.id} error={errors.to}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
      <ProductSelect data={data} error={errors.product} />
      <TextField label="Quantity" name="qty" type="number" step="any" min="0" error={errors.qty} />
    </FormShell>
  )
}
