import clsx from 'clsx'
import { UsageNotice } from '@/core/subscriptions/UsageViews'
import { Download, Minus, Pause, Play, PenLine, Plus, Receipt as ReceiptIcon, Search, Trash2, X, ZoomIn } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { useIdempotencyKey } from '@/shared/hooks/useIdempotencyKey'
import { dateTime, label, naira, qty } from '@/shared/utilities/format'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { priceCart } from '@/modules/sales/pricing'
import { SalesToday } from '@/modules/sales/SalesToday'
import { changeDue, holdLabel, loadHeld, paidOf, paymentsOf, remainingOf, saveHeld } from '@/modules/sales/till'
import type { HeldSale, PayRow } from '@/modules/sales/till'
import { ReceiptDialog } from '@/modules/sales/Receipt'
import { PictureViewer, ProductThumb } from '@/modules/inventory/ProductPicture'
import { ScanButton, codeFrom } from '@/shared/components/BarcodeScanner'
import { loadThumbs } from '@/modules/inventory/productPictures'
import { createProduct } from '@/modules/inventory/inventoryApi'
import * as api from '@/modules/sales/tradeApi'
import type { CustomerDto, SaleDetail } from '@/modules/sales/tradeApi'

const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['pos', 'POS terminal'], ['card', 'Card'], ['other', 'Other']] as const
const TABS = ['New sale', 'History', 'Today'] as const
const TAB_KEYS: Record<(typeof TABS)[number], string> = { 'New sale': 'new', History: 'history', Today: 'today' }

export function SalesPage() {
  const { active } = useBusiness()
  // Which part is open is in the address (?tab=history), so the sidebar, the tabs and the back button agree.
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => TAB_KEYS[t] === params.get('tab')) ?? 'New sale'
  const setTab = (t: (typeof TABS)[number]) => setParams({ tab: TAB_KEYS[t] })
  const [receipt, setReceipt] = useState<string | null>(null)
  const businessId = active?.id ?? ''
  const industry = active?.industry ?? 'retail'
  const catalog = useAsync(() => api.loadCatalog(businessId, industry), [businessId, industry])
  const options = useAsync(() => api.tillOptions(businessId).catch(() => ({ allowed: false, productId: null as string | null })), [businessId])
  const thumbs = useAsync(() => (industry === 'retail' ? loadThumbs(businessId) : Promise.resolve({} as Record<string, string>)), [businessId, industry])
  const customers = useAsync(() => api.listCustomers(businessId).catch(() => [] as CustomerDto[]), [businessId])
  const sales = useAsync(() => api.listSales(businessId), [businessId])
  const perms = useAsync(() => api.myTradePermissions(businessId), [businessId])
  const packs = useAsync(() => api.loadPacks(businessId).catch(() => [] as api.PackDto[]), [businessId])
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false

  const reloadAll = async () => { await Promise.all([catalog.refresh(), customers.refresh(), sales.refresh()]) }

  return (
    <>
      <PageHeader title="Sales / POS" description="Ring up sales, split payments, hold a sale while the customer fetches something, print or send receipts, and close the day. Totals are confirmed by the server." />
      <UsageNotice keys={['sales_per_month']} />
      <div role="tablist" aria-label="Sales sections" className="mb-4 flex gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}</button>
        ))}
      </div>
      {catalog.error && <ErrorState message={catalog.error} />}
      {tab === 'New sale' && (catalog.data ? (
        <Pos businessId={businessId} quickItem={options.data?.allowed === true} thumbs={thumbs.data ?? {}} catalog={catalog.data} packs={packs.data ?? []} customers={customers.data ?? []} canDiscount={can('sales.discount')} canCreate={can('sales.create')}
          onSold={async (id) => { await reloadAll(); setReceipt(id) }} />
      ) : <Spinner />)}
      {tab === 'History' && <History unlistedId={options.data?.productId ?? null} businessId={businessId} customers={customers.data ?? []} can={can} onChanged={reloadAll} onReceipt={setReceipt} refreshKey={sales.data} />}
      {tab === 'Today' && <SalesToday businessId={businessId} />}
      {receipt && <ReceiptDialog businessId={businessId} saleId={receipt} onClose={() => setReceipt(null)} />}
    </>
  )
}

// ------------------------------------------------------------------------------------- POS
interface CartLine { productId: string; quantity: number; discount: number; pack: string | null; /** A line typed at the till that is not in the product list: its name and price. */ custom?: { name: string; price: number } }
const lineKey = (l: { productId: string; pack: string | null }) => `${l.productId}|${l.pack ?? ''}`

function Pos({ businessId, quickItem, thumbs, catalog, packs, customers, canDiscount, canCreate, onSold }: {
  businessId: string; quickItem: boolean; thumbs: Record<string, string>; catalog: api.InventoryData; packs: api.PackDto[]; customers: CustomerDto[]; canDiscount: boolean; canCreate: boolean; onSold: (saleId: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [bigger, setBigger] = useState<{ id: string; name: string } | null>(null)
  const [typing, setTyping] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [locationId, setLocationId] = useState(catalog.locations[0]?.id ?? '')
  const [rows, setRows] = useState<PayRow[]>([{ method: 'cash', amount: '' }])
  const [given, setGiven] = useState('')
  // Sales set aside while the customer fetches something: kept on this device only.
  const taxRate = useBusiness().active?.taxRate ?? 0
  const [held, setHeld] = useState<HeldSale[]>(() => loadHeld(businessId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()

  useEffect(() => { if (!locationId && catalog.locations[0]) setLocationId(catalog.locations[0].id) }, [catalog.locations, locationId])

  const onHand = (productId: string) => catalog.products.find((p) => p.id === productId)?.tracksStock === false ? Infinity : catalog.balances.filter((b) => b.productId === productId && b.locationId === locationId).reduce((a, b) => a + b.qty, 0)
  const products = useMemo(() => {
    const t = search.trim().toLowerCase()
    return catalog.products.filter((p) => p.status === 'active' && (!t || [p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(t))))
  }, [catalog.products, search])
  const byId = (id: string) => catalog.products.find((p) => p.id === id)!
  const info = (l: CartLine) => (l.custom ? { name: l.custom.name, unit: 'each' } : byId(l.productId))
  const packOf = (l: CartLine) => (l.pack ? packs.find((k) => k.productId === l.productId && k.name === l.pack) : undefined)
  const priceOf = (l: CartLine) => { if (l.custom) return l.custom.price; const k = packOf(l); return k ? (k.price ?? Math.round(byId(l.productId).sellingPrice * k.units * 100) / 100) : byId(l.productId).sellingPrice }

  const priced = useMemo(() => {
    try { return { ok: priceCart(cart.map((l) => ({ quantity: l.quantity, unitPrice: priceOf(l), discount: l.discount })), taxRate), err: null } }
    catch (e) { return { ok: null, err: (e as Error).message } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, catalog.products, packs, taxRate])

  const total = priced.ok?.grandTotal ?? 0
  const pays = paymentsOf(rows, total)
  const paying = paidOf(pays)
  const balance = remainingOf(total, pays)
  const cashDue = pays.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
  const change = changeDue(Number(given || 0), cashDue)
  const setRow = (i: number, patch: Partial<PayRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const keepHeld = (next: HeldSale[]) => { setHeld(next); saveHeld(businessId, next) }
  function hold() {
    if (!cart.length) return
    keepHeld([{ id: `${Date.now()}`, label: holdLabel(cart.length, new Date(), customers.find((c) => c.id === customerId)?.name), at: new Date().toISOString(), customerId, cart: cart.map(({ productId, quantity, discount, pack, custom }) => ({ productId, quantity, discount, pack, ...(custom ? { custom } : {}) })) }, ...held])
    setCart([]); setCustomerId(''); setRows([{ method: 'cash', amount: '' }]); setGiven(''); setError(null)
  }
  function resume(h: HeldSale) {
    if (cart.length) return setError('Hold or clear the current sale before resuming another.')
    setError(null); setCart(h.cart.filter((l) => l.custom || catalog.products.some((p) => p.id === l.productId))); setCustomerId(h.customerId); keepHeld(held.filter((x) => x.id !== h.id))
  }

  const addTyped = (name: string, price: number, quantity: number) => setCart((c) => [...c, { productId: `typed:${Date.now()}-${c.length}`, quantity, discount: 0, pack: null, custom: { name, price } }])
  const add = (id: string) => setCart((c) => (c.some((l) => lineKey(l) === `${id}|`) ? c.map((l) => (lineKey(l) === `${id}|` ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { productId: id, quantity: 1, discount: 0, pack: null }]))
  const setLine = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setCart((c) => c.filter((l) => lineKey(l) !== key))
  /** A barcode scanner types the code and presses Enter: add the exact match and clear the box for the next scan. */
  function scan(code?: string) {
    const raw = (code ?? search).trim()
    if (!raw) return
    const tries = codeFrom(raw).map((x) => x.toLowerCase())
    const hit = catalog.products.find((p) => p.status === 'active' && tries.some((t) => p.barcode?.toLowerCase() === t || p.sku?.toLowerCase() === t))
    if (!hit) return setError(`No product has the code ${raw}. Add it under Products: scan the same code into the product's Barcode box.`)
    if (onHand(hit.id) <= 0) return setError(`${hit.name} is out of stock.`)
    setError(null); add(hit.id); setSearch('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!cart.length) return setError('Add at least one product.')
    if (priced.err) return setError(priced.err)
    if (rows.length > 1 && !pays.length) return setError('Enter the amount for each way the customer is paying.')
    if (!(paying >= 0) || paying > total) return setError('The amount paid cannot be more than the total.')
    if (balance > 0 && !customerId) return setError('Select a customer to sell on credit, or take the full payment.')
    setBusy(true)
    const r = await api.postSale(businessId, locationId, customerId || null,
      cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: priceOf(l), discount: l.discount, pack: l.pack, ...(l.custom ? { customName: l.custom.name } : {}) })),
      pays, key.current())
    setBusy(false)
    if (r.error) return setError(r.error)
    // The cash the customer handed over is kept with the sale so the receipt can show cash given and change. The sale is already recorded, so a failure here is not shown.
    if (r.saleId && cashDue > 0 && Number(given) >= cashDue) await api.recordSaleTender(r.saleId, Math.round(Number(given) * 100) / 100, businessId).catch(() => null)
    key.renew(); setCart([]); setRows([{ method: 'cash', amount: '' }]); setGiven(''); setCustomerId('')
    await onSold(r.saleId!)
  }

  if (!canCreate) return <Notice>Your role can view sales but not record them.</Notice>

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <div className="absolute right-0 top-0 flex gap-2">{quickItem && <Button type="button" variant="secondary" onClick={() => setTyping(true)}><PenLine className="size-4" aria-hidden /> Quick item</Button>}<ScanButton onScan={(c) => scan(c)} label="Scan" title="Scan a product" /></div>
            <Search className="pointer-events-none absolute left-3 top-9 size-4 text-ink/40" aria-hidden />
            <TextField label="Find a product" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan() } }} placeholder="Name, SKU or barcode (scan, then Enter)" className="pl-9" />
          </div>
          {catalog.locations.length > 1 && (
            <SelectField label="Sell from" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectField>
          )}
        </div>
        {typing && <QuickItemDialog onClose={() => setTyping(false)} onAdd={(n, p, q) => { addTyped(n, p, q); setTyping(false) }} />}
        {bigger && <PictureViewer productId={bigger.id} name={bigger.name} onClose={() => setBigger(null)} />}
        {products.length === 0 ? <EmptyState title="No products found" description={catalog.products.length ? 'Try another search.' : 'Add products in Inventory first.'} /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {products.map((p) => {
              const have = onHand(p.id)
              const out = have <= 0
              const service = p.tracksStock === false
              return (
                <button key={p.id} type="button" disabled={out} onClick={() => add(p.id)}
                  className="rounded-lg border border-ink/10 bg-white p-3 text-left shadow-card transition-colors hover:border-brand disabled:cursor-not-allowed disabled:opacity-50">
                  {thumbs[p.id] && <span className="relative mb-2 block"><ProductThumb name={p.name} thumb={thumbs[p.id]} size="lg" /><span role="button" tabIndex={0} aria-label={`Show a bigger picture of ${p.name}`} onClick={(e) => { e.stopPropagation(); setBigger({ id: p.id, name: p.name }) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setBigger({ id: p.id, name: p.name }) } }} className="absolute right-1 top-1 grid size-6 cursor-zoom-in place-items-center rounded-full bg-white/90 shadow"><ZoomIn className="size-3.5" aria-hidden /></span></span>}
                  <span className="block text-sm font-medium leading-snug">{p.name}</span>
                  <span className="mt-1 block text-sm tabular">{naira(p.sellingPrice)}</span>
                  <span className="mt-1 block"><Badge tone={service ? 'neutral' : out ? 'danger' : p.reorderLevel !== null && have <= p.reorderLevel ? 'warning' : 'success'}>{service ? 'Service' : out ? 'Out of stock' : `${qty(have)} ${p.unit}`}</Badge></span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <form onSubmit={submit} noValidate className="h-fit space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-card lg:sticky lg:top-20">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Current sale</h2>{cart.length > 0 && <button type="button" onClick={hold} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-surface"><Pause className="size-3.5" aria-hidden /> Hold</button>}</div>
        {held.length > 0 && (
          <div className="rounded-md bg-surface p-2 text-xs">
            <p className="mb-1 font-semibold">Held sales ({held.length})</p>
            <ul className="space-y-1">{held.map((h) => <li key={h.id} className="flex items-center justify-between gap-2"><span className="truncate">{h.label}</span><span className="flex shrink-0 gap-1"><button type="button" onClick={() => resume(h)} className="inline-flex items-center gap-1 rounded border border-line bg-white px-1.5 py-0.5 font-semibold"><Play className="size-3" aria-hidden /> Resume</button><button type="button" aria-label={`Discard held sale ${h.label}`} onClick={() => keepHeld(held.filter((x) => x.id !== h.id))} className="rounded border border-line bg-white p-1 text-ink/60 hover:text-danger"><Trash2 className="size-3" aria-hidden /></button></span></li>)}</ul>
            <p className="mt-1 text-ink/55">Kept on this device only.</p>
          </div>
        )}
        {cart.length === 0 ? <p className="py-6 text-center text-sm text-ink/60">Tap a product to add it.</p> : (
          <ul className="divide-y divide-ink/10">
            {cart.map((l, i) => {
              const p = info(l)
              const line = priced.ok?.lines[i]
              return (
                <li key={lineKey(l)} className="py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}{l.custom && <Badge tone="warning">Not in product list</Badge>}</span>
                    <button type="button" onClick={() => remove(lineKey(l))} aria-label={`Remove ${p.name}`} className="text-ink/50 hover:text-danger"><X className="size-4" /></button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button type="button" aria-label="Decrease" onClick={() => l.quantity > 1 && setLine(lineKey(l), { quantity: l.quantity - 1 })} className="rounded border border-ink/20 p-1"><Minus className="size-3.5" /></button>
                    <input aria-label={`Quantity of ${p.name}`} type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(lineKey(l), { quantity: Number(e.target.value) })} className="w-16 rounded border border-ink/20 px-2 py-1 text-center tabular" />
                    <button type="button" aria-label="Increase" onClick={() => setLine(lineKey(l), { quantity: l.quantity + 1 })} className="rounded border border-ink/20 p-1"><Plus className="size-3.5" /></button>
                    <span className="ml-auto tabular">{naira(line?.total ?? 0)}</span>
                  </div>
                  {packs.some((k) => k.productId === l.productId) && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-ink/70">Sold by
                      <select aria-label={`Unit for ${p.name}`} value={l.pack ?? ''} onChange={(e) => { const pack = e.target.value || null; if (cart.some((x) => x !== l && lineKey(x) === lineKey({ productId: l.productId, pack }))) return setError(`${p.name} is already on the sale in that unit.`); setError(null); setLine(lineKey(l), { pack }) }} className="rounded border border-ink/20 px-2 py-1">
                        <option value="">{p.unit}</option>
                        {packs.filter((k) => k.productId === l.productId).map((k) => <option key={k.name} value={k.name}>{k.name} ({qty(k.units)})</option>)}
                      </select>
                      <span className="tabular">{naira(priceOf(l))} each</span>
                    </label>
                  )}
                  {canDiscount && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-ink/70">Discount ₦
                      <input type="number" min="0" step="0.01" value={l.discount || ''} onChange={(e) => setLine(lineKey(l), { discount: Number(e.target.value) || 0 })} className="w-24 rounded border border-ink/20 px-2 py-1 tabular" />
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <SelectField label="Customer (optional)" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Walk-in customer</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <dl className="space-y-1 border-t border-ink/10 pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular">{naira(priced.ok?.subtotal ?? 0)}</dd></div>
          {(priced.ok?.discountTotal ?? 0) > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular">−{naira(priced.ok!.discountTotal)}</dd></div>}
          {(priced.ok?.taxTotal ?? 0) > 0 && <div className="flex justify-between"><dt>Tax</dt><dd className="tabular">{naira(priced.ok!.taxTotal)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular">{naira(total)}</dd></div>
        </dl>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Payment</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2">
              <SelectField label={i === 0 ? 'Method' : `Method ${i + 1}`} value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
              <TextField label="Amount (₦)" type="number" min="0" step="0.01" value={r.amount} placeholder={rows.length === 1 ? String(total) : ''} onChange={(e) => setRow(i, { amount: e.target.value })} />
              {rows.length > 1 ? <button type="button" aria-label={`Remove payment ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="mb-2 p-1 text-ink/50 hover:text-danger"><X className="size-4" aria-hidden /></button> : <span />}
            </div>
          ))}
          <button type="button" onClick={() => setRows((x) => [...x, { method: 'bank_transfer', amount: '' }])} className="text-xs font-semibold text-accent underline">Split between another way of paying</button>
          {pays.some((p) => p.method === 'cash') && <TextField label="Cash given (₦)" type="number" min="0" step="0.01" value={given} onChange={(e) => setGiven(e.target.value)} hint={change > 0 ? `Change to give back: ${naira(change)}` : 'To work out the change; it is kept with the sale and printed on the receipt'} />}
          {balance > 0 && <p className="text-xs text-warning">{rows.length > 1 || paying > 0 ? 'Still to pay' : 'On credit'}: {naira(balance)}</p>}
        </div>
        {error && <ErrorState title="Sale not posted" message={error} />}
        <Button type="submit" loading={busy} className="w-full" disabled={!cart.length}>Complete sale · {naira(total)}</Button>
        <p className="text-center text-xs text-ink/50">Preview only. The server recalculates prices, totals and stock.</p>
      </form>
    </div>
  )
}

// --------------------------------------------------------------------------------- history
const SALE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { posted: 'neutral', refunded: 'warning', voided: 'danger', paid: 'success', partially_paid: 'warning', unpaid: 'danger' }

function History({ unlistedId, businessId, customers, can, onChanged, onReceipt, refreshKey }: {
  unlistedId: string | null; businessId: string; customers: CustomerDto[]; can: (p: string) => boolean; onChanged: () => Promise<void>; onReceipt: (id: string) => void; refreshKey: unknown
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState(''); const [show, setShow] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const list = useAsync(() => api.listSales(businessId, from || to ? { from: from || undefined, to: to || undefined } : undefined), [businessId, from, to, refreshKey])
  const customer = (id: string | null) => customers.find((c) => c.id === id)?.name ?? 'Walk-in'
  const rows = (list.data ?? []).filter((s) => (!show || (show === 'owing' ? s.balanceDue > 0 && s.status !== 'voided' : s.status === show))
    && (!q.trim() || [s.number, customer(s.customerId)].some((v) => v.toLowerCase().includes(q.trim().toLowerCase()))))
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-60"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sale number or customer" /></div>
        <div className="w-40"><SelectField label="Show" value={show} onChange={(e) => setShow(e.target.value)}><option value="">All sales</option><option value="owing">Owing money</option><option value="refunded">Refunded</option><option value="voided">Voided</option></SelectField></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv('sales.csv', [['Sale', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Payment'], ...rows.map((s) => [s.number, s.soldAt, customer(s.customerId), s.grandTotal, s.amountPaid, s.balanceDue, s.status, s.paymentStatus])])}><Download className="size-4" aria-hidden /> Export</Button>
        <p className="pb-2 text-sm text-ink/60">{rows.length} shown{!from && !to ? ' (latest 100)' : ''}</p>
      </div>
      {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorState message={list.error} /> : !rows.length ? <EmptyState title={list.data?.length ? 'No sales match' : 'No sales yet'} description="Completed sales appear here." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Sale</th><th className="p-3">Customer</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Balance</th><th className="p-3">Status</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(s.id)}>
                  <td className="p-3"><b>{s.number}</b><div className="text-xs text-ink/60">{dateTime(s.soldAt)}</div></td>
                  <td className="p-3">{customer(s.customerId)}</td>
                  <td className="p-3 text-right tabular">{naira(s.grandTotal)}</td>
                  <td className="p-3 text-right tabular">{naira(s.balanceDue)}</td>
                  <td className="p-3"><span className="flex flex-wrap gap-1">{s.hasUnlisted && <Badge tone="warning">Not in product list</Badge>}{s.status !== 'posted' && <Badge tone={SALE_TONE[s.status]}>{label(s.status)}</Badge>}<Badge tone={SALE_TONE[s.paymentStatus]}>{label(s.paymentStatus)}</Badge></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {open && <SaleDialog unlistedId={unlistedId} businessId={businessId} saleId={open} can={can} onClose={() => setOpen(null)} onChanged={onChanged} onReceipt={onReceipt} />}
    </>
  )
}

function SaleDialog({ unlistedId, businessId, saleId, can, onClose, onChanged, onReceipt }: {
  unlistedId: string | null; businessId: string; saleId: string; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void>; onReceipt: (id: string) => void
}) {
  const { data, error: loadError, refresh } = useAsync<SaleDetail>(() => api.saleDetail(businessId, saleId), [businessId, saleId])
  const [mode, setMode] = useState<'pay' | 'return' | 'void' | null>(null)
  const [adding, setAdding] = useState<{ name: string; price: number } | null>(null); const [added, setAdded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()

  async function act(fn: (k: string) => Promise<string | null>) {
    const err = await fn(key.current())
    setError(err)
    if (!err) { key.renew(); setMode(null); await Promise.all([refresh(), onChanged()]) }
  }

  if (!data) return <DetailPage title="Sale" onClose={onClose}>{loadError ? <ErrorState message={loadError} /> : <Spinner />}</DetailPage>
  const { sale, items, payments } = data
  const live = sale.status !== 'voided'

  return (
    <DetailPage title={sale.number} onClose={onClose} wide>
      {error && <ErrorState message={error} />}
      {added && <Notice>{added}</Notice>}
      {adding && <AddTypedProduct businessId={businessId} item={adding} onClose={() => setAdding(null)} onAdded={(m) => { setAdding(null); setAdded(m) }} />}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={SALE_TONE[sale.status]}>{label(sale.status)}</Badge><Badge tone={SALE_TONE[sale.paymentStatus]}>{label(sale.paymentStatus)}</Badge>
        <span className="text-ink/60">{dateTime(sale.soldAt)}</span>
        <Button variant="secondary" className="ml-auto" onClick={() => onReceipt(sale.id)}><ReceiptIcon className="size-4" /> Receipt</Button>
      </div>
      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-ink/10">
          {items.map((i) => (
            <tr key={i.id}><td className="py-1.5">{i.description}{unlistedId && i.productId === unlistedId && <> <Badge tone="warning">Not in product list</Badge>{can('inventory.adjust') && <button type="button" onClick={() => setAdding({ name: i.description, price: i.unitPrice })} className="ml-2 text-xs font-semibold underline">Add to products</button>}</>}{i.returnedQty > 0 && <span className="ml-2 text-xs text-warning">{qty(i.returnedQty)} returned</span>}</td><td className="py-1.5 text-right tabular">{qty(i.quantity)}</td><td className="py-1.5 text-right tabular">{naira(i.total)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-ink/60">Total</dt><dd className="tabular font-semibold">{naira(sale.grandTotal)}</dd></div>
        <div><dt className="text-xs text-ink/60">Paid</dt><dd className="tabular">{naira(sale.amountPaid)}</dd></div>
        <div><dt className="text-xs text-ink/60">Returned</dt><dd className="tabular">{naira(sale.returnedTotal)}</dd></div>
        <div><dt className="text-xs text-ink/60">{sale.refundDue > 0 ? 'Refund due' : 'Balance due'}</dt><dd className="tabular font-semibold">{naira(sale.refundDue > 0 ? sale.refundDue : sale.balanceDue)}</dd></div>
      </dl>

      <h3 className="mb-1 text-sm font-semibold">Payments</h3>
      {payments.length === 0 ? <p className="mb-3 text-sm text-ink/60">No payments recorded.</p> : (
        <ul className="mb-3 divide-y divide-ink/10 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span>{p.type === 'refund' ? 'Refund' : 'Payment'} · {label(p.method)} · <b className="tabular">{naira(p.amount)}</b></span>
              <Badge tone={p.status === 'successful' ? 'success' : p.status === 'pending' ? 'warning' : 'danger'}>{label(p.status)}</Badge>
              <span className="ml-auto flex gap-1">
                {p.status === 'pending' && can('sales.create') && <Button variant="secondary" onClick={() => void act((k) => api.confirmPayment(businessId, p.id, k))}>Confirm</Button>}
                {p.status !== 'reversed' && p.type !== 'refund' && can(p.status === 'pending' ? 'sales.create' : 'sales.refund') && (
                  <Button variant="ghost" onClick={() => { const r = window.prompt('Reason for reversing this payment?'); if (r) void act((k) => api.reversePayment(businessId, p.id, r, k)) }}>Reverse</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {live && (
        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">
          {sale.balanceDue > 0 && can('sales.create') && <Button variant="secondary" onClick={() => setMode(mode === 'pay' ? null : 'pay')}>Add payment</Button>}
          {sale.status === 'posted' && can('sales.refund') && <Button variant="secondary" onClick={() => setMode(mode === 'return' ? null : 'return')}>Return items</Button>}
          {sale.status === 'posted' && can('sales.void') && <Button variant="ghost" onClick={() => setMode(mode === 'void' ? null : 'void')}>Void sale</Button>}
        </div>
      )}
      {mode === 'pay' && <PayForm max={sale.balanceDue} onSubmit={(m, a, ref) => act((k) => api.addPayment(businessId, saleId, { method: m, amount: a, reference: ref }, k))} />}
      {mode === 'return' && <ReturnForm detail={data} onSubmit={(lines, reason, refund) => act((k) => api.returnSale(businessId, saleId, lines, reason, refund, k))} />}
      {mode === 'void' && <ReasonForm label="Reason for voiding" cta="Void sale" onSubmit={(r) => act((k) => api.voidSale(businessId, saleId, r, k))} />}
    </DetailPage>
  )
}

function PayForm({ max, onSubmit }: { max: number; onSubmit: (method: string, amount: number, ref: string) => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-3" noValidate onSubmit={async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const a = Number(f.get('amount'))
      if (!(a > 0)) return setErr('Enter an amount greater than zero.')
      if (a > max) return setErr(`The amount due is ${naira(max)}.`)
      setErr(null); await onSubmit(String(f.get('method')), a, String(f.get('ref') ?? ''))
    }}>
      <SelectField label="Method" name="method">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
      <TextField label="Amount (₦)" name="amount" type="number" step="0.01" min="0" defaultValue={max} error={err ?? undefined} />
      <TextField label="Reference" name="ref" placeholder="Transfer ref (optional)" />
      <div className="sm:col-span-3"><Button type="submit">Record payment</Button></div>
    </form>
  )
}

function ReasonForm({ label: l, cta, onSubmit }: { label: string; cta: string; onSubmit: (reason: string) => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <form className="mt-3 grid gap-3" noValidate onSubmit={async (e) => {
      e.preventDefault(); const r = String(new FormData(e.currentTarget).get('reason') ?? '')
      if (r.trim().length < 3) return setErr('A reason is required.')
      setErr(null); await onSubmit(r)
    }}>
      <TextField label={l} name="reason" error={err ?? undefined} />
      <div><Button type="submit">{cta}</Button></div>
    </form>
  )
}

function ReturnForm({ detail, onSubmit }: { detail: SaleDetail; onSubmit: (lines: { saleItemId: string; quantity: number; disposition: 'restock' | 'discard' }[], reason: string, refund: { method: string; amount: number } | null) => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null)
  const eligible = detail.items.filter((i) => i.quantity - i.returnedQty > 0)
  if (!eligible.length) return <p className="mt-3 text-sm text-ink/60">Everything on this sale has already been returned.</p>
  return (
    <form className="mt-3 space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget)
      const lines = eligible.map((i) => ({ saleItemId: i.id, quantity: Number(f.get(`q-${i.id}`) || 0), disposition: String(f.get(`d-${i.id}`)) as 'restock' | 'discard' })).filter((l) => l.quantity > 0)
      const reason = String(f.get('reason') ?? '')
      if (!lines.length) return setErr('Enter a quantity for at least one item.')
      if (reason.trim().length < 3) return setErr('A reason is required.')
      const amount = Number(f.get('refund') || 0)
      setErr(null)
      await onSubmit(lines, reason, amount > 0 ? { method: String(f.get('method')), amount } : null)
    }}>
      {eligible.map((i) => (
        <div key={i.id} className="grid items-end gap-2 sm:grid-cols-[1fr_100px_140px]">
          <span className="text-sm">{i.description} <span className="text-xs text-ink/60">(up to {qty(i.quantity - i.returnedQty)})</span></span>
          <TextField label="Qty" name={`q-${i.id}`} type="number" step="any" min="0" max={i.quantity - i.returnedQty} />
          <SelectField label="Stock" name={`d-${i.id}`}><option value="restock">Back to stock</option><option value="discard">Discard</option></SelectField>
        </div>
      ))}
      <TextField label="Reason" name="reason" />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Refund now (₦, optional)" name="refund" type="number" step="0.01" min="0" hint="Cannot exceed what the customer has paid." />
        <SelectField label="Refund method" name="method">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
      </div>
      {err && <ErrorState message={err} />}
      <Button type="submit">Post return</Button>
    </form>
  )
}

/** Type in an item that is not in the product list: its name, price and how many. It is added to the sale only; nothing is added to Products. */
function QuickItemDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, price: number, quantity: number) => void }) {
  const [problem, setProblem] = useState<string | null>(null)
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const name = String(f.get('name') ?? '').trim(); const price = Number(f.get('price')); const quantity = Number(f.get('quantity') || 1)
    if (!name) return setProblem('Type what is being sold.')
    if (name.length > 80) return setProblem('The name can be at most 80 characters.')
    if (!(price > 0) || Math.round(price * 100) / 100 !== price) return setProblem('Enter the price for one, above zero, with at most 2 decimals.')
    if (!(quantity > 0)) return setProblem('Enter how many.')
    onAdd(name, price, quantity)
  }
  return (
    <Dialog title="Quick item" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Notice>For something that is not in Products yet. It takes nothing off the stock, and the sale is marked so the owner can see it.</Notice>
        <TextField label="What is being sold" name="name" placeholder="e.g. Garri (2 cups)" autoFocus maxLength={80} />
        <div className="grid grid-cols-2 gap-3"><TextField label="Price for one (₦)" name="price" type="number" min="0" step="0.01" /><TextField label="How many" name="quantity" type="number" min="0" step="any" defaultValue="1" /></div>
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">Add to sale</Button></div>
      </form>
    </Dialog>
  )
}

/** Turns an item that was typed at the till into a real product, with the same name and price, so next time it is a normal product. */
function AddTypedProduct({ businessId, item, onClose, onAdded }: { businessId: string; item: { name: string; price: number }; onClose: () => void; onAdded: (message: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function add() {
    setBusy(true); setError(null)
    const err = await createProduct(businessId, { name: item.name, sku: '', barcode: '', unit: 'each', sellingPrice: item.price, defaultCost: null, reorderLevel: null, tracksStock: true })
    setBusy(false)
    if (err) return setError(/duplicate|unique|23505/i.test(err) ? 'A product with this name already exists.' : err)
    onAdded(`${item.name} was added to Products at ${naira(item.price)}. Receive stock for it under Products to start tracking it.`)
  }
  return (
    <Dialog title="Add to products" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>Add <b>{item.name}</b> to your products at <b className="tabular">{naira(item.price)}</b>, so it can be sold from the list, with stock, next time.</p>
        <p className="text-ink/60">This sale stays as it was. The new product starts with no stock: receive some under Products.</p>
        {error && <ErrorState title="Not added" message={error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void add()}>Add product</Button></div>
      </div>
    </Dialog>
  )
}
