import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { useIdempotencyKey } from '@/shared/hooks/useIdempotencyKey'
import { dateTime, label, naira, qty } from '@/shared/utilities/format'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import * as api from '@/modules/sales/tradeApi'
import type { PurchaseDetail } from '@/modules/sales/tradeApi'

const METHODS = [['bank_transfer', 'Bank transfer'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']] as const
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { ordered: 'info', partially_received: 'warning', received: 'success', cancelled: 'danger', paid: 'success', partially_paid: 'warning', unpaid: 'neutral' }

export function PurchasesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const industry = active?.industry ?? 'retail'
  const purchases = useAsync(() => api.listPurchases(businessId), [businessId])
  const suppliers = useAsync(() => api.listSuppliers(businessId), [businessId])
  const catalog = useAsync(() => api.loadCatalog(businessId, industry), [businessId, industry])
  const perms = useAsync(() => api.myTradePermissions(businessId), [businessId])
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false
  const supplier = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? 'Unknown'

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Order from suppliers, receive goods into stock and record supplier payments. An order never changes stock until goods are received."
        actions={can('purchases.manage') ? <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New purchase order</Button> : undefined}
      />
      {purchases.error && <ErrorState message={purchases.error} />}
      {purchases.loading ? <Spinner /> : !purchases.data?.length ? (
        <EmptyState title="No purchase orders yet" description={suppliers.data?.length ? 'Create your first order to a supplier.' : 'Add a supplier first, then create an order.'} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-navy/60"><tr><th className="p-3">Order</th><th className="p-3">Supplier</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Paid</th><th className="p-3">Status</th></tr></thead>
            <tbody className="divide-y divide-navy/10">
              {purchases.data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(p.id)}>
                  <td className="p-3"><b>{p.number}</b><div className="text-xs text-navy/60">{dateTime(p.at)}</div></td>
                  <td className="p-3">{supplier(p.supplierId)}</td>
                  <td className="p-3 text-right tabular">{naira(p.total)}</td>
                  <td className="p-3 text-right tabular">{naira(p.amountPaid)}</td>
                  <td className="p-3"><span className="flex flex-wrap gap-1"><Badge tone={STATUS_TONE[p.status]}>{label(p.status)}</Badge><Badge tone={STATUS_TONE[p.paymentStatus]}>{label(p.paymentStatus)}</Badge></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && catalog.data && suppliers.data && (
        <NewPurchase businessId={businessId} suppliers={suppliers.data} catalog={catalog.data} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await purchases.refresh() }} />
      )}
      {open && catalog.data && (
        <PurchaseDialog businessId={businessId} id={open} supplierName={supplier} catalog={catalog.data} can={can} onClose={() => setOpen(null)}
          onChanged={async () => { await Promise.all([purchases.refresh(), catalog.refresh()]) }} />
      )}
    </>
  )
}

function NewPurchase({ businessId, suppliers, catalog, onClose, onDone }: { businessId: string; suppliers: api.SupplierDto[]; catalog: api.InventoryData; onClose: () => void; onDone: () => Promise<void> }) {
  const [lines, setLines] = useState([{ productId: '', quantity: '', unitCost: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = useIdempotencyKey()
  const products = catalog.products.filter((p) => p.status === 'active')
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const total = lines.reduce((a, l) => a + Math.round(Number(l.quantity || 0) * Number(l.unitCost || 0) * 100) / 100, 0)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const supplierId = String(f.get('supplier') ?? '')
    if (!supplierId) return setError('Select a supplier.')
    const clean = lines.filter((l) => l.productId)
    if (!clean.length) return setError('Add at least one product.')
    if (clean.some((l) => !(Number(l.quantity) > 0) || !(Number(l.unitCost) >= 0) || l.unitCost === '')) return setError('Every line needs a quantity above zero and a unit cost.')
    setBusy(true)
    const err = await api.createPurchase(businessId, supplierId, clean.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })), String(f.get('ref') ?? ''), key.current())
    setBusy(false)
    setError(err)
    if (!err) { key.renew(); await onDone() }
  }

  return (
    <Dialog title="New purchase order" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Supplier" name="supplier" defaultValue=""><option value="" disabled>Select…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
          <TextField label="Supplier invoice / reference" name="ref" />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_100px_120px_auto]">
            <SelectField label={i === 0 ? 'Product' : ' '} value={l.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); set(i, { productId: e.target.value, unitCost: l.unitCost || (p?.defaultCost != null ? String(p.defaultCost) : '') }) }}>
              <option value="">Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </SelectField>
            <TextField label={i === 0 ? 'Quantity' : ' '} type="number" step="any" min="0" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            <TextField label={i === 0 ? 'Unit cost (₦)' : ' '} type="number" step="0.01" min="0" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
            <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="mb-2 p-2 text-navy/50 hover:text-danger disabled:opacity-30"><X className="size-4" /></button>
          </div>
        ))}
        <Button type="button" variant="ghost" onClick={() => setLines((l) => [...l, { productId: '', quantity: '', unitCost: '' }])}><Plus className="size-4" /> Add line</Button>
        <p className="text-right text-sm">Order total: <b className="tabular">{naira(total)}</b></p>
        {error && <ErrorState title="Order not created" message={error} />}
        <div className="flex justify-end"><Button type="submit" loading={busy}>Create order</Button></div>
      </form>
    </Dialog>
  )
}

function PurchaseDialog({ businessId, id, supplierName, catalog, can, onClose, onChanged }: {
  businessId: string; id: string; supplierName: (id: string) => string; catalog: api.InventoryData; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void>
}) {
  const { data, error: loadError, refresh } = useAsync<PurchaseDetail>(() => api.purchaseDetail(businessId, id), [businessId, id])
  const [mode, setMode] = useState<'receive' | 'pay' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = useIdempotencyKey()

  async function act(fn: (k: string) => Promise<string | null>) {
    const err = await fn(key.current())
    setError(err)
    if (!err) { key.renew(); setMode(null); await Promise.all([refresh(), onChanged()]) }
  }
  if (!data) return <Dialog title="Purchase order" onClose={onClose}>{loadError ? <ErrorState message={loadError} /> : <Spinner />}</Dialog>
  const { purchase: p, items, payments } = data
  const name = (pid: string) => catalog.products.find((x) => x.id === pid)?.name ?? 'Product'
  const open = items.filter((i) => i.ordered - i.received > 0)
  const canReceive = ['ordered', 'partially_received'].includes(p.status) && can('purchases.receive')
  const due = Math.round((p.total - p.amountPaid) * 100) / 100

  return (
    <Dialog title={p.number} onClose={onClose} wide>
      {error && <ErrorState message={error} />}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={STATUS_TONE[p.status]}>{label(p.status)}</Badge><Badge tone={STATUS_TONE[p.paymentStatus]}>{label(p.paymentStatus)}</Badge>
        <span className="text-navy/60">{supplierName(p.supplierId)} · {dateTime(p.at)}{p.reference ? ` · ${p.reference}` : ''}</span>
      </div>
      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-xs uppercase text-navy/60"><tr><th className="py-1">Product</th><th className="py-1 text-right">Ordered</th><th className="py-1 text-right">Received</th><th className="py-1 text-right">Unit cost</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-navy/10">
          {items.map((i) => <tr key={i.id}><td className="py-1.5">{name(i.productId)}</td><td className="py-1.5 text-right tabular">{qty(i.ordered)}</td><td className="py-1.5 text-right tabular">{qty(i.received)}</td><td className="py-1.5 text-right tabular">{naira(i.unitCost)}</td><td className="py-1.5 text-right tabular">{naira(i.lineTotal)}</td></tr>)}
        </tbody>
      </table>
      <dl className="mb-3 grid grid-cols-3 gap-4 text-sm">
        <div><dt className="text-xs text-navy/60">Total</dt><dd className="tabular font-semibold">{naira(p.total)}</dd></div>
        <div><dt className="text-xs text-navy/60">Paid</dt><dd className="tabular">{naira(p.amountPaid)}</dd></div>
        <div><dt className="text-xs text-navy/60">Owed to supplier</dt><dd className="tabular font-semibold">{naira(p.status === 'cancelled' ? 0 : due)}</dd></div>
      </dl>
      {payments.length > 0 && (
        <ul className="mb-3 divide-y divide-navy/10 text-sm">
          {payments.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span>{label(x.method)} · <b className="tabular">{naira(x.amount)}</b>{x.reference ? ` · ${x.reference}` : ''}</span>
              <Badge tone={x.status === 'successful' ? 'success' : 'danger'}>{label(x.status)}</Badge>
              {x.status === 'successful' && can('purchases.pay') && (
                <Button variant="ghost" className="ml-auto" onClick={() => { const r = window.prompt('Reason for reversing this payment?'); if (r) void act((k) => api.reversePayment(businessId, x.id, r, k)) }}>Reverse</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-navy/10 pt-3">
        {canReceive && open.length > 0 && <Button variant="secondary" onClick={() => setMode(mode === 'receive' ? null : 'receive')}>Receive goods</Button>}
        {p.status !== 'cancelled' && due > 0 && can('purchases.pay') && <Button variant="secondary" onClick={() => setMode(mode === 'pay' ? null : 'pay')}>Pay supplier</Button>}
        {p.status === 'ordered' && can('purchases.manage') && <Button variant="ghost" onClick={() => setMode(mode === 'cancel' ? null : 'cancel')}>Cancel order</Button>}
      </div>
      {mode === 'receive' && (
        <form className="mt-3 space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          const lines = open.map((i) => ({ purchaseItemId: i.id, quantity: Number(f.get(`q-${i.id}`) || 0) })).filter((l) => l.quantity > 0)
          if (!lines.length) return setError('Enter a received quantity for at least one line.')
          void act((k) => api.receivePurchase(businessId, id, String(f.get('location')), lines, k))
        }}>
          <Notice>Stock increases only for the quantities you receive now, at the order's unit cost.</Notice>
          <SelectField label="Receive into" name="location">{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
          {open.map((i) => <TextField key={i.id} label={`${name(i.productId)} (up to ${qty(i.ordered - i.received)})`} name={`q-${i.id}`} type="number" step="any" min="0" max={i.ordered - i.received} />)}
          <Button type="submit">Post goods received</Button>
        </form>
      )}
      {mode === 'pay' && (
        <form className="mt-3 grid gap-3 sm:grid-cols-3" noValidate onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget); const a = Number(f.get('amount'))
          if (!(a > 0) || a > due) return setError(`Enter an amount between 0.01 and ${naira(due)}.`)
          void act((k) => api.payPurchase(businessId, id, String(f.get('method')), a, String(f.get('ref') ?? ''), k))
        }}>
          <SelectField label="Method" name="method">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          <TextField label="Amount (₦)" name="amount" type="number" step="0.01" min="0" defaultValue={due} />
          <TextField label="Reference" name="ref" />
          <div className="sm:col-span-3"><Button type="submit">Record payment</Button></div>
        </form>
      )}
      {mode === 'cancel' && (
        <form className="mt-3 grid gap-3" noValidate onSubmit={(e) => {
          e.preventDefault(); const r = String(new FormData(e.currentTarget).get('reason') ?? '')
          if (r.trim().length < 3) return setError('A reason is required.')
          void act((k) => api.cancelPurchase(businessId, id, r, k))
        }}>
          <TextField label="Reason for cancelling" name="reason" />
          <div><Button type="submit">Cancel order</Button></div>
        </form>
      )}
    </Dialog>
  )
}
