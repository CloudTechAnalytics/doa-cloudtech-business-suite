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
import { WASTE_REASONS, loadBatches, loadFinished, loadIngredients, loadWaste, recordWaste, voidWaste } from '../services/bakeryApi'
import type { WasteDto, WasteReason } from '../services/bakeryApi'

/** Ingredients and products thrown away: spoiled, burnt, expired or unsold. Each entry is a stock movement with its estimated loss. */
export function BakeryWastePage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const waste = useAsync(() => loadWaste(businessId), [businessId])
  const ingredients = useAsync(() => loadIngredients(businessId), [businessId])
  const products = useAsync(() => loadFinished(businessId), [businessId])
  const batches = useAsync(() => loadBatches(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'bakery'), [businessId])
  const { can } = usePermissions(businessId)
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<WasteDto | null>(null)
  const [reasonFilter, setReasonFilter] = useState('')
  if (!active) return null
  const record = can('bakery.record'); const manage = can('bakery.manage')
  const name = (id: string) => ingredients.data?.find((i) => i.id === id)?.name ?? products.data?.find((p) => p.id === id)?.name ?? 'Item'
  const unit = (id: string) => ingredients.data?.find((i) => i.id === id)?.unit ?? products.data?.find((p) => p.id === id)?.unit ?? ''
  const list = (waste.data ?? []).filter((w) => !reasonFilter || w.reason === reasonFilter)
  const total = list.filter((w) => w.status === 'posted').reduce((a, w) => a + Math.round(w.loss * 100), 0) / 100
  const refresh = async () => { await Promise.all([waste.refresh(), ingredients.refresh(), products.refresh()]) }

  return (
    <>
      <PageHeader title="Waste" description="Record anything thrown away. Stock goes down and the estimated loss is kept at the cost the item was worth. Failed units inside a production batch are already part of that batch's cost, so do not record them again here."
        actions={record ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record waste</Button> : undefined} />
      {(waste.error || ingredients.error) && <ErrorState message={(waste.error ?? ingredients.error)!} />}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-52"><SelectField label="Reason" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}><option value="">All reasons</option>{WASTE_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</SelectField></div>
        <p className="ml-auto text-sm text-ink/70">Estimated loss shown: <b className="tabular text-ink">{naira(total)}</b></p>
      </div>
      {waste.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No waste recorded" description="Good. When something is thrown away, record it so stock and costs stay honest." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Entry</th><th className="p-3">Item</th><th className="p-3 text-right">Quantity</th><th className="p-3">Reason</th><th className="p-3 text-right">Estimated loss</th>{manage && <th className="p-3" />}</tr></thead>
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
      {adding && <WasteDialog businessId={businessId} items={[...(products.data ?? []).filter((p) => p.active).map((p) => ({ id: p.id, name: `${p.name} (product)`, unit: p.unit })), ...(ingredients.data ?? []).filter((i) => i.active).map((i) => ({ id: i.id, name: `${i.name} (ingredient)`, unit: i.unit }))]} locations={catalog.data?.locations ?? []} batches={(batches.data?.batches ?? []).filter((b) => b.status === 'completed')} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await refresh() }} />}
      {voiding && <VoidDialog businessId={businessId} record={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await refresh() }} />}
    </>
  )
}

function WasteDialog({ businessId, items, locations, batches, onClose, onSaved }: { businessId: string; items: { id: string; name: string; unit: string }[]; locations: { id: string; name: string }[]; batches: { id: string; number: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [productId, setProductId] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!productId) next.item = 'Choose what was wasted.'
    if (!(Number(s('qty')) > 0)) next.qty = 'Enter a quantity above zero.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordWaste(businessId, { productId, locationId: s('location'), quantity: Number(s('qty')), reason: s('reason') as WasteReason, batchId: s('batch') || null, notes: s('notes') }, k), 'Waste recorded.')
  }
  const unit = items.find((i) => i.id === productId)?.unit
  return (
    <Dialog title="Record waste" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label="What was wasted?" value={productId} onChange={(e) => setProductId(e.target.value)} error={errors.item}><option value="">Select…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={`Quantity${unit ? ` (${unit})` : ''}`} name="qty" type="number" min="0" step="any" error={errors.qty} />
          <SelectField label="Reason" name="reason" defaultValue="unsold">{WASTE_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</SelectField>
          <SelectField label="Taken from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
          {batches.length > 0 && <SelectField label="Production batch (optional)" name="batch" defaultValue=""><option value="">None</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}</SelectField>}
        </div>
        <TextField label="Notes (optional)" name="notes" />
        <Notice>Finished goods leave the batch that expires first. The loss is estimated at the item's average cost.</Notice>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record waste</Button></div>
      </form>
    </Dialog>
  )
}

function VoidDialog({ businessId, record, onClose, onSaved }: { businessId: string; record: WasteDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Void ${record.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidWaste(businessId, record.id, reason, k), 'Voided.') }} className="space-y-4">
        <p className="text-sm text-ink/80">The quantity goes back into stock (and into the same batch) and the loss is removed from the figures.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not voided" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Void</Button></div>
      </form>
    </Dialog>
  )
}
