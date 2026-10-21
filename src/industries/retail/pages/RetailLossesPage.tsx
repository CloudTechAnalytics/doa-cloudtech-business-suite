import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira, qty } from '@/shared/utilities/format'
import { LOSS_REASONS, loadLosses, loadProducts, recordLoss, voidLoss } from '../services/martApi'
import type { LossReason, MartLoss } from '../services/martApi'

/** Damaged, expired and missing stock. Each entry is a stock movement with its estimated loss; an expired lot is taken out oldest first. */
export function RetailLossesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const losses = useAsync(() => loadLosses(businessId), [businessId])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'retail'), [businessId])
  const { can } = usePermissions(businessId)
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<MartLoss | null>(null)
  const [reasonFilter, setReasonFilter] = useState('')
  if (!active) return null
  const record = can('inventory.adjust'); const manage = can('retail.manage')
  const name = (id: string) => products.data?.find((p) => p.id === id)?.name ?? 'Product'
  const unit = (id: string) => products.data?.find((p) => p.id === id)?.unit ?? ''
  const list = (losses.data ?? []).filter((w) => !reasonFilter || w.reason === reasonFilter)
  const total = list.filter((w) => w.status === 'posted').reduce((a, w) => a + Math.round(w.loss * 100), 0) / 100
  const refresh = async () => { await Promise.all([losses.refresh(), products.refresh()]) }

  return (
    <>
      <PageHeader title="Damaged & expired" description="Write off damaged, expired or missing stock. Stock goes down and the estimated loss is kept at the cost the product was worth."
        actions={record ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record loss</Button> : undefined} />
      {(losses.error || products.error) && <ErrorState message={(losses.error ?? products.error)!} />}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-52"><SelectField label="Reason" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}><option value="">All reasons</option>{LOSS_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</SelectField></div>
        <p className="ml-auto text-sm text-ink/70">Estimated loss shown: <b className="tabular text-ink">{naira(total)}</b></p>
      </div>
      {losses.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No losses recorded" description="When stock is damaged, expires or goes missing, record it so stock and profit stay honest." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Entry</th><th className="p-3">Product</th><th className="p-3 text-right">Quantity</th><th className="p-3">Reason</th><th className="p-3 text-right">Estimated loss</th>{manage && <th className="p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((w) => (
                <tr key={w.id} className={w.status === 'voided' ? 'text-ink/45' : ''}>
                  <td className="p-3"><span className={w.status === 'voided' ? 'line-through' : 'font-medium'}>{w.number}</span><div className="text-xs text-ink/60">{w.createdAt.slice(0, 10)}{w.notes ? ` · ${w.notes}` : ''}</div>{w.status === 'voided' && <div className="text-xs">Voided: {w.voidReason}</div>}</td>
                  <td className="p-3">{name(w.productId)}</td>
                  <td className="tabular p-3 text-right">{qty(w.quantity)} {unit(w.productId)}</td>
                  <td className="p-3"><Badge>{label(w.reason)}</Badge></td>
                  <td className="tabular p-3 text-right">{naira(w.loss)}</td>
                  {manage && <td className="p-3 text-right">{w.status === 'posted' && <Button variant="ghost" onClick={() => setVoiding(w)}>Void</Button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <LossDialog businessId={businessId} products={(products.data ?? []).filter((p) => p.active)} locations={catalog.data?.locations ?? []} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await refresh() }} />}
      {voiding && <VoidDialog businessId={businessId} record={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await refresh() }} />}
    </>
  )
}

function LossDialog({ businessId, products, locations, onClose, onSaved }: { businessId: string; products: { id: string; name: string; unit: string; onHand: number }[]; locations: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [productId, setProductId] = useState('')
  const p = products.find((x) => x.id === productId)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!productId) next.item = 'Choose the product.'
    if (!(Number(s('qty')) > 0)) next.qty = 'Enter a quantity above zero.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordLoss(businessId, { productId, locationId: s('location'), quantity: Number(s('qty')), reason: s('reason') as LossReason, notes: s('notes') }, k), 'Loss recorded.')
  }
  return (
    <Dialog title="Record damaged or expired stock" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} error={errors.item}><option value="">Select…</option>{products.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={`Quantity${p ? ` (${p.unit})` : ''}`} name="qty" type="number" min="0" step="any" error={errors.qty} hint={p ? `${p.onHand} in stock` : undefined} />
          <SelectField label="Reason" name="reason" defaultValue="damaged">{LOSS_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</SelectField>
          <SelectField label="Taken from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
        </div>
        <TextField label="Notes (optional)" name="notes" />
        <Notice>You cannot write off more than is in stock. Products that track expiry leave the batch that expires first.</Notice>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record loss</Button></div>
      </form>
    </Dialog>
  )
}

function VoidDialog({ businessId, record, onClose, onSaved }: { businessId: string; record: MartLoss; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Void ${record.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidLoss(businessId, record.id, reason, k), 'Voided.') }} className="space-y-4">
        <p className="text-sm text-ink/80">The quantity goes back into stock and the loss is removed from the figures.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not voided" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Void</Button></div>
      </form>
    </Dialog>
  )
}
