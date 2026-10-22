import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { listSuppliers, loadCatalog } from '@/modules/sales/tradeApi'
import { Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { loadProducts, loadReturns, supplierReturn } from '../services/martApi'

/** Goods sent back to a supplier. Stock goes down and the supplier credit reduces what you owe them. */
export function RetailReturnsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const returns = useAsync(() => loadReturns(businessId), [businessId])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const suppliers = useAsync(() => listSuppliers(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'retail'), [businessId])
  const { can } = usePermissions(businessId)
  const [adding, setAdding] = useState(false)
  if (!active) return null
  const manage = can('purchases.receive') || can('retail.manage')
  const supplier = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? 'Supplier'
  const product = (id: string) => products.data?.find((p) => p.id === id)?.name ?? 'Product'

  return (
    <>
      <PageHeader title="Supplier returns" description="Send damaged, expired or wrong goods back. You cannot return more than you received from that supplier."
        actions={manage ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New return</Button> : undefined} />
      {(returns.error || suppliers.error) && <ErrorState message={(returns.error ?? suppliers.error)!} />}
      {returns.loading ? <Spinner /> : !returns.data?.length ? <Card><EmptyState title="No supplier returns" description="Returns you record here reduce stock and the amount you owe the supplier." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Return</th><th className="p-3">Supplier</th><th className="p-3">Items</th><th className="p-3 text-right">Credit</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {returns.data.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 font-medium">{r.number}<div className="text-xs font-normal text-ink/60">{r.createdAt.slice(0, 10)} · {r.reason}</div></td>
                  <td className="p-3">{supplier(r.supplierId)}</td>
                  <td className="p-3">{r.items.map((i) => `${qty(i.quantity)} × ${product(i.productId)}`).join(', ')}</td>
                  <td className="tabular p-3 text-right">{naira(r.totalCredit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <ReturnDialog businessId={businessId} suppliers={suppliers.data ?? []} products={(products.data ?? []).filter((p) => p.active)} locations={catalog.data?.locations ?? []} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await Promise.all([returns.refresh(), products.refresh()]) }} />}
    </>
  )
}

function ReturnDialog({ businessId, suppliers, products, locations, onClose, onSaved }: { businessId: string; suppliers: { id: string; name: string }[]; products: { id: string; name: string; avgCost: number | null; costPrice: number | null }[]; locations: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [lines, setLines] = useState<{ productId: string; quantity: string; cost: string }[]>([{ productId: '', quantity: '', cost: '' }])
  const [problem, setProblem] = useState<string | null>(null)
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (!s('supplier')) return setProblem('Choose the supplier.')
    if (s('reason').length < 3) return setProblem('Say why the goods are going back.')
    if (lines.some((l) => !l.productId || !(Number(l.quantity) > 0) || !(Number(l.cost) >= 0) || l.cost === '')) return setProblem('Each line needs a product, a quantity above zero and a cost.')
    setProblem(null)
    await runner.run((k) => supplierReturn(businessId, { supplierId: s('supplier'), purchaseId: null, locationId: s('location'), reason: s('reason'), items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.cost) })) }, k), 'Return recorded.')
  }
  return (
    <DetailPage modal title="Return goods to a supplier" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Supplier" name="supplier" defaultValue=""><option value="">Select…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
          <SelectField label="Taken from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_110px_130px_auto]">
            <SelectField label={i === 0 ? 'Product' : ' '} value={l.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); set(i, { productId: e.target.value, cost: l.cost || String(p?.avgCost ?? p?.costPrice ?? '') }) }}><option value="">Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
            <TextField label={i === 0 ? 'Quantity' : ' '} type="number" min="0" step="any" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            <TextField label={i === 0 ? 'Cost each' : ' '} type="number" min="0" step="0.01" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
            <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger disabled:opacity-30"><X className="size-4" aria-hidden /></button>
          </div>
        ))}
        <Button type="button" variant="ghost" onClick={() => setLines([...lines, { productId: '', quantity: '', cost: '' }])}><Plus className="size-4" aria-hidden /> Add line</Button>
        <TextField label="Reason" name="reason" placeholder="Damaged on delivery, expired, wrong item" />
        <Notice>The credit lowers what you owe this supplier. It cannot be more than you received from them.</Notice>
        {(problem || runner.error) && <ErrorState title="Not recorded" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record return</Button></div>
      </form>
    </DetailPage>
  )
}
