import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { PAY_METHODS, myFinancePermissions } from '@/modules/finance/financeApi'
import { listCustomers, loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira, qty } from '@/shared/utilities/format'
import { blankLine, LinesEditor } from './LinesEditor'
import type { EditorLine } from './LinesEditor'
import { cancelOrder, createOrder, fulfilOrder, listOrders } from './ordersApi'
import type { OrderDto } from './ordersApi'

const TONE: Record<OrderDto['status'], 'info' | 'warning' | 'success' | 'neutral'> = { open: 'info', partially_fulfilled: 'warning', fulfilled: 'success', cancelled: 'neutral' }
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** What customers have ordered. An order reserves nothing; delivering posts a normal sale (stock, price, payment and credit limit apply). */
export function SalesOrdersPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const orders = useAsync(() => listOrders(businessId), [businessId])
  const customers = useAsync(() => listCustomers(businessId).catch(() => []), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, active?.industry ?? 'farm'), [businessId, active?.industry])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  if (!active) return null
  const canSell = perms.data?.includes('sales.create') ?? false
  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? 'Customer'
  const selected = orders.data?.find((o) => o.id === open) ?? null

  return (
    <>
      <PageHeader title="Sales orders" description="Orders customers have placed. Nothing leaves stock until you deliver; delivery creates the invoice."
        actions={canSell ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New order</Button> : undefined} />
      {orders.error && <ErrorState message={orders.error} />}
      {orders.loading ? <Spinner /> : !orders.data?.length ? <Card><EmptyState title="No sales orders yet" description={customers.data?.length ? 'Create an order when a customer asks for produce to be delivered later.' : 'Add a customer first (Customers), then create an order.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Expected</th><th className="p-3 text-right">Quoted total</th><th className="p-3">Status</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {orders.data.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(o.id)}>
                  <td className="p-3 font-medium">{o.number}<div className="text-xs font-normal text-ink/60">{o.createdAt.slice(0, 10)}</div></td>
                  <td className="p-3">{customer(o.customerId)}</td>
                  <td className="p-3">{o.expected ?? '–'}</td>
                  <td className="tabular p-3 text-right">{naira(o.quotedTotal)}</td>
                  <td className="p-3"><Badge tone={TONE[o.status]}>{label(o.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && catalog.data && <NewOrder businessId={businessId} customers={customers.data ?? []} products={catalog.data.products.filter((p) => p.status === 'active')} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await orders.refresh() }} />}
      {selected && catalog.data && <OrderDialog businessId={businessId} order={selected} customerName={customer(selected.customerId)} catalog={catalog.data} canSell={canSell} onClose={() => setOpen(null)} onChanged={async () => { await Promise.all([orders.refresh(), catalog.refresh()]) }} />}
    </>
  )
}

function NewOrder({ businessId, customers, products, onClose, onSaved }: { businessId: string; customers: { id: string; name: string }[]; products: { id: string; name: string; unit: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [lines, setLines] = useState<EditorLine[]>([blankLine()])
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const clean = lines.filter((l) => l.productId)
    if (!f.get('customer')) return setProblem('Choose the customer.')
    if (!clean.length) return setProblem('Add at least one product.')
    if (clean.some((l) => !(Number(l.quantity) > 0))) return setProblem('Every line needs a quantity above zero.')
    setProblem(null)
    await runner.run((k) => createOrder(businessId, String(f.get('customer')), clean.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })), String(f.get('expected') ?? '') || null, String(f.get('note') ?? ''), k), 'Order created.')
  }
  return (
    <DetailPage modal title="New sales order" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Customer" name="customer" defaultValue=""><option value="" disabled>Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="Expected delivery (optional)" name="expected" type="date" min={iso(new Date())} />
        </div>
        <LinesEditor lines={lines} setLines={setLines} products={products} />
        <TextField label="Note (optional)" name="note" />
        {(problem || runner.error) && <ErrorState title="Order not created" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Create order</Button></div>
      </form>
    </DetailPage>
  )
}

function OrderDialog({ businessId, order, customerName, catalog, canSell, onClose, onChanged }: {
  businessId: string; order: OrderDto; customerName: string; catalog: NonNullable<ReturnType<typeof useAsync<Awaited<ReturnType<typeof loadCatalog>>>>['data']>
  canSell: boolean; onClose: () => void; onChanged: () => Promise<void>
}) {
  const runner = useFormRunner(onChanged)
  const [mode, setMode] = useState<'deliver' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')
  const [take, setTake] = useState<Record<string, string>>({})
  const [location, setLocation] = useState(catalog.locations[0]?.id ?? '')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState('cash')
  const [problem, setProblem] = useState<string | null>(null)
  const p = (id: string) => catalog.products.find((x) => x.id === id)
  const active = order.status === 'open' || order.status === 'partially_fulfilled'

  async function deliver(e: FormEvent) {
    e.preventDefault()
    const lines = order.lines.map((l) => ({ lineId: l.id, quantity: Number(take[l.id] ?? l.remaining) })).filter((l) => l.quantity > 0)
    if (!lines.length) return setProblem('Enter a quantity to deliver.')
    if (order.lines.some((l) => Number(take[l.id] ?? l.remaining) > l.remaining)) return setProblem('You cannot deliver more than what remains.')
    setProblem(null)
    const amount = Math.round(Number(paid || 0) * 100) / 100
    await runner.run((k) => fulfilOrder(businessId, order.id, location, lines, amount > 0 ? [{ method, amount }] : [], k), 'Delivered and invoiced.', () => { setMode(null); setTake({}); setPaid('') })
  }

  return (
    <DetailPage title={`${order.number} · ${customerName}`} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm"><Badge tone={TONE[order.status]}>{label(order.status)}</Badge>{order.expected && <span className="text-ink/60">Expected {order.expected}</span>}{order.note && <span className="text-ink/60">· {order.note}</span>}</div>
      {order.status === 'cancelled' && <Notice>Cancelled: {order.cancelReason}</Notice>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-2">Product</th><th className="py-2 text-right">Ordered</th><th className="py-2 text-right">Delivered</th><th className="py-2 text-right">Remaining</th>{mode === 'deliver' && <th className="py-2 text-right">Deliver now</th>}</tr></thead>
        <tbody className="divide-y divide-ink/10">
          {order.lines.map((l) => (
            <tr key={l.id}>
              <td className="py-2">{p(l.productId)?.name ?? 'Product'}<div className="text-xs text-ink/60">Quoted {naira(l.quotedPrice)} / {p(l.productId)?.unit}</div></td>
              <td className="tabular py-2 text-right">{qty(l.quantity)}</td><td className="tabular py-2 text-right">{qty(l.fulfilled)}</td><td className="tabular py-2 text-right">{qty(l.remaining)}</td>
              {mode === 'deliver' && <td className="py-2 text-right"><input aria-label={`Deliver ${p(l.productId)?.name}`} type="number" min="0" step="any" max={l.remaining} value={take[l.id] ?? l.remaining} onChange={(e) => setTake({ ...take, [l.id]: e.target.value })} className="h-9 w-24 rounded-md border border-line px-2 text-right" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'deliver' && (
        <form onSubmit={deliver} className="mt-4 space-y-3 border-t border-line pt-4">
          <Notice>Delivery is priced at today&apos;s catalogue prices and takes stock out now. The customer's credit limit applies to any unpaid balance.</Notice>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Take stock from" value={location} onChange={(e) => setLocation(e.target.value)}>{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
            <TextField label="Paid now (optional)" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} />
            <SelectField label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
          </div>
          {(problem || runner.error) && <ErrorState title="Not delivered" message={(problem ?? runner.error)!} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMode(null)}>Back</Button><Button type="submit" loading={runner.busy}>Deliver and invoice</Button></div>
        </form>
      )}
      {mode === 'cancel' && (
        <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => cancelOrder(businessId, order.id, reason, k), 'Order cancelled.', () => setMode(null)) }} className="mt-4 space-y-3 border-t border-line pt-4">
          <TextField label="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          {runner.error && <ErrorState title="Not cancelled" message={runner.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMode(null)}>Back</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Cancel order</Button></div>
        </form>
      )}
      {!mode && active && canSell && <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setMode('cancel')}>Cancel order</Button><Button onClick={() => setMode('deliver')} disabled={!order.lines.some((l) => l.remaining > 0)}>Deliver</Button></div>}
    </DetailPage>
  )
}
