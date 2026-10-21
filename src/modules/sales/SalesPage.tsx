import clsx from 'clsx'
import { Minus, Plus, Receipt as ReceiptIcon, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { useIdempotencyKey } from '@/shared/hooks/useIdempotencyKey'
import { dateTime, label, naira, qty } from '@/shared/utilities/format'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { priceCart } from '@/modules/sales/pricing'
import { ReceiptDialog } from '@/modules/sales/Receipt'
import * as api from '@/modules/sales/tradeApi'
import type { CustomerDto, SaleDetail, SaleDto } from '@/modules/sales/tradeApi'

const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['pos', 'POS terminal'], ['card', 'Card'], ['other', 'Other']] as const
const TABS = ['New sale', 'History'] as const

export function SalesPage() {
  const { active } = useBusiness()
  const [tab, setTab] = useState<(typeof TABS)[number]>('New sale')
  const [receipt, setReceipt] = useState<string | null>(null)
  const businessId = active?.id ?? ''
  const industry = active?.industry ?? 'retail'
  const catalog = useAsync(() => api.loadCatalog(businessId, industry), [businessId, industry])
  const customers = useAsync(() => api.listCustomers(businessId).catch(() => [] as CustomerDto[]), [businessId])
  const sales = useAsync(() => api.listSales(businessId), [businessId])
  const perms = useAsync(() => api.myTradePermissions(businessId), [businessId])
  const packs = useAsync(() => api.loadPacks(businessId).catch(() => [] as api.PackDto[]), [businessId])
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false

  const reloadAll = async () => { await Promise.all([catalog.refresh(), customers.refresh(), sales.refresh()]) }

  return (
    <>
      <PageHeader title="Sales" description="Ring up sales, take payments, issue receipts and handle returns. Totals are confirmed by the server." />
      <div role="tablist" aria-label="Sales sections" className="mb-4 flex gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}</button>
        ))}
      </div>
      {catalog.error && <ErrorState message={catalog.error} />}
      {tab === 'New sale' && (catalog.data ? (
        <Pos businessId={businessId} catalog={catalog.data} packs={packs.data ?? []} customers={customers.data ?? []} canDiscount={can('sales.discount')} canCreate={can('sales.create')}
          onSold={async (id) => { await reloadAll(); setReceipt(id) }} />
      ) : <Spinner />)}
      {tab === 'History' && (
        <History businessId={businessId} sales={sales.data} loading={sales.loading} error={sales.error} customers={customers.data ?? []} can={can} onChanged={reloadAll} onReceipt={setReceipt} />
      )}
      {receipt && <ReceiptDialog businessId={businessId} saleId={receipt} onClose={() => setReceipt(null)} />}
    </>
  )
}

// ------------------------------------------------------------------------------------- POS
interface CartLine { productId: string; quantity: number; discount: number; pack: string | null }
const lineKey = (l: { productId: string; pack: string | null }) => `${l.productId}|${l.pack ?? ''}`

function Pos({ businessId, catalog, packs, customers, canDiscount, canCreate, onSold }: {
  businessId: string; catalog: api.InventoryData; packs: api.PackDto[]; customers: CustomerDto[]; canDiscount: boolean; canCreate: boolean; onSold: (saleId: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [locationId, setLocationId] = useState(catalog.locations[0]?.id ?? '')
  const [method, setMethod] = useState('cash')
  const [payNow, setPayNow] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()

  useEffect(() => { if (!locationId && catalog.locations[0]) setLocationId(catalog.locations[0].id) }, [catalog.locations, locationId])

  const onHand = (productId: string) => catalog.balances.filter((b) => b.productId === productId && b.locationId === locationId).reduce((a, b) => a + b.qty, 0)
  const products = useMemo(() => {
    const t = search.trim().toLowerCase()
    return catalog.products.filter((p) => p.status === 'active' && (!t || [p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(t))))
  }, [catalog.products, search])
  const byId = (id: string) => catalog.products.find((p) => p.id === id)!
  const packOf = (l: CartLine) => (l.pack ? packs.find((k) => k.productId === l.productId && k.name === l.pack) : undefined)
  const priceOf = (l: CartLine) => { const k = packOf(l); return k ? Math.round(byId(l.productId).sellingPrice * k.units * 100) / 100 : byId(l.productId).sellingPrice }

  const priced = useMemo(() => {
    try { return { ok: priceCart(cart.map((l) => ({ quantity: l.quantity, unitPrice: priceOf(l), discount: l.discount }))), err: null } }
    catch (e) { return { ok: null, err: (e as Error).message } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, catalog.products, packs])

  const total = priced.ok?.grandTotal ?? 0
  const paying = payNow === '' ? total : Number(payNow)
  const balance = Math.max(Math.round((total - paying) * 100) / 100, 0)

  const add = (id: string) => setCart((c) => (c.some((l) => lineKey(l) === `${id}|`) ? c.map((l) => (lineKey(l) === `${id}|` ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { productId: id, quantity: 1, discount: 0, pack: null }]))
  const setLine = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setCart((c) => c.filter((l) => lineKey(l) !== key))
  /** A barcode scanner types the code and presses Enter: add the exact match and clear the box for the next scan. */
  function scan() {
    const t = search.trim().toLowerCase()
    if (!t) return
    const hit = catalog.products.find((p) => p.status === 'active' && (p.barcode?.toLowerCase() === t || p.sku?.toLowerCase() === t))
    if (!hit) return setError(`No product has the code ${search.trim()}.`)
    if (onHand(hit.id) <= 0) return setError(`${hit.name} is out of stock.`)
    setError(null); add(hit.id); setSearch('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!cart.length) return setError('Add at least one product.')
    if (priced.err) return setError(priced.err)
    if (!(paying >= 0) || paying > total) return setError('The amount paid cannot be more than the total.')
    if (balance > 0 && !customerId) return setError('Select a customer to sell on credit, or take the full payment.')
    setBusy(true)
    const r = await api.postSale(businessId, locationId, customerId || null,
      cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: priceOf(l), discount: l.discount, pack: l.pack })),
      paying > 0 ? [{ method, amount: paying }] : [], key.current())
    setBusy(false)
    if (r.error) return setError(r.error)
    key.renew(); setCart([]); setPayNow(''); setCustomerId('')
    await onSold(r.saleId!)
  }

  if (!canCreate) return <Notice>Your role can view sales but not record them.</Notice>

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-9 size-4 text-ink/40" aria-hidden />
            <TextField label="Find a product" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan() } }} placeholder="Name, SKU or barcode (scan, then Enter)" className="pl-9" />
          </div>
          {catalog.locations.length > 1 && (
            <SelectField label="Sell from" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectField>
          )}
        </div>
        {products.length === 0 ? <EmptyState title="No products found" description={catalog.products.length ? 'Try another search.' : 'Add products in Inventory first.'} /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {products.map((p) => {
              const have = onHand(p.id)
              const out = have <= 0
              return (
                <button key={p.id} type="button" disabled={out} onClick={() => add(p.id)}
                  className="rounded-lg border border-ink/10 bg-white p-3 text-left shadow-card transition-colors hover:border-brand disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="block text-sm font-medium leading-snug">{p.name}</span>
                  <span className="mt-1 block text-sm tabular">{naira(p.sellingPrice)}</span>
                  <span className="mt-1 block"><Badge tone={out ? 'danger' : p.reorderLevel !== null && have <= p.reorderLevel ? 'warning' : 'success'}>{out ? 'Out of stock' : `${qty(have)} ${p.unit}`}</Badge></span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <form onSubmit={submit} noValidate className="h-fit space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-card lg:sticky lg:top-20">
        <h2 className="text-sm font-semibold">Current sale</h2>
        {cart.length === 0 ? <p className="py-6 text-center text-sm text-ink/60">Tap a product to add it.</p> : (
          <ul className="divide-y divide-ink/10">
            {cart.map((l, i) => {
              const p = byId(l.productId)
              const line = priced.ok?.lines[i]
              return (
                <li key={lineKey(l)} className="py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
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
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Payment" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <TextField label="Amount paid (₦)" type="number" min="0" step="0.01" value={payNow} placeholder={String(total)} onChange={(e) => setPayNow(e.target.value)} hint={balance > 0 ? `On credit: ${naira(balance)}` : undefined} />
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

function History({ businessId, sales, loading, error, customers, can, onChanged, onReceipt }: {
  businessId: string; sales: SaleDto[] | null; loading: boolean; error: string | null; customers: CustomerDto[]; can: (p: string) => boolean
  onChanged: () => Promise<void>; onReceipt: (id: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (loading) return <Spinner />
  if (error) return <ErrorState message={error} />
  if (!sales?.length) return <EmptyState title="No sales yet" description="Completed sales appear here." />
  const customer = (id: string | null) => customers.find((c) => c.id === id)?.name ?? 'Walk-in'
  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Sale</th><th className="p-3">Customer</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Balance</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-ink/10">
            {sales.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(s.id)}>
                <td className="p-3"><b>{s.number}</b><div className="text-xs text-ink/60">{dateTime(s.soldAt)}</div></td>
                <td className="p-3">{customer(s.customerId)}</td>
                <td className="p-3 text-right tabular">{naira(s.grandTotal)}</td>
                <td className="p-3 text-right tabular">{naira(s.balanceDue)}</td>
                <td className="p-3"><span className="flex flex-wrap gap-1">{s.status !== 'posted' && <Badge tone={SALE_TONE[s.status]}>{label(s.status)}</Badge>}<Badge tone={SALE_TONE[s.paymentStatus]}>{label(s.paymentStatus)}</Badge></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && <SaleDialog businessId={businessId} saleId={open} can={can} onClose={() => setOpen(null)} onChanged={onChanged} onReceipt={onReceipt} />}
    </>
  )
}

function SaleDialog({ businessId, saleId, can, onClose, onChanged, onReceipt }: {
  businessId: string; saleId: string; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void>; onReceipt: (id: string) => void
}) {
  const { data, error: loadError, refresh } = useAsync<SaleDetail>(() => api.saleDetail(businessId, saleId), [businessId, saleId])
  const [mode, setMode] = useState<'pay' | 'return' | 'void' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()

  async function act(fn: (k: string) => Promise<string | null>) {
    const err = await fn(key.current())
    setError(err)
    if (!err) { key.renew(); setMode(null); await Promise.all([refresh(), onChanged()]) }
  }

  if (!data) return <Dialog title="Sale" onClose={onClose}>{loadError ? <ErrorState message={loadError} /> : <Spinner />}</Dialog>
  const { sale, items, payments } = data
  const live = sale.status !== 'voided'

  return (
    <Dialog title={sale.number} onClose={onClose} wide>
      {error && <ErrorState message={error} />}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={SALE_TONE[sale.status]}>{label(sale.status)}</Badge><Badge tone={SALE_TONE[sale.paymentStatus]}>{label(sale.paymentStatus)}</Badge>
        <span className="text-ink/60">{dateTime(sale.soldAt)}</span>
        <Button variant="secondary" className="ml-auto" onClick={() => onReceipt(sale.id)}><ReceiptIcon className="size-4" /> Receipt</Button>
      </div>
      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-ink/10">
          {items.map((i) => (
            <tr key={i.id}><td className="py-1.5">{i.description}{i.returnedQty > 0 && <span className="ml-2 text-xs text-warning">{qty(i.returnedQty)} returned</span>}</td><td className="py-1.5 text-right tabular">{qty(i.quantity)}</td><td className="py-1.5 text-right tabular">{naira(i.total)}</td></tr>
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
    </Dialog>
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
