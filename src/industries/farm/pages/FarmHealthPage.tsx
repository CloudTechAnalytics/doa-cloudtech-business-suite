import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, qty } from '@/shared/utilities/format'
import { FarmGate, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { listHealth, recordHealth, voidHealth } from '../services/opsApi'
import type { HealthDto } from '../services/opsApi'

const TYPES = ['treatment', 'vaccination', 'inspection', 'quarantine'] as const

/** Treatments, vaccinations and inspections per batch. A treatment can start a withdrawal period during which the batch's produce and animals cannot be sold. */
export function FarmHealthPage() {
  const { active } = useBusiness()
  const farm = useFarm()
  const businessId = active?.id ?? ''
  const records = useAsync(() => listHealth(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<HealthDto | null>(null)
  if (!active) return null
  const record = farm.can('farm.record'); const manage = farm.can('farm.manage')
  const live = (records.data ?? []).filter((r) => r.status === 'posted' && r.withdrawalEndsOn !== null && r.withdrawalEndsOn >= today())

  return (
    <>
      <PageHeader title="Health & biosecurity" description="Treatments, vaccinations and inspections for each batch. Medicine used comes out of stock; a withdrawal period stops produce and animals from being sold until it ends."
        actions={record ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record health event</Button> : undefined} />
      {records.error && <ErrorState message={records.error} />}
      <FarmGate farm={farm}>
        {(data, catalog) => (
          <>
            {live.length > 0 && (
              <Notice>
                <p className="font-semibold">Under withdrawal: do not sell or harvest</p>
                <ul className="mt-1 text-xs">{live.map((r) => <li key={r.id}>{farm.batchCode(r.batchId)}: {r.title}, until {r.withdrawalEndsOn}</li>)}</ul>
              </Notice>
            )}
            {records.loading ? <Spinner /> : !records.data?.length ? <Card className="mt-4"><EmptyState title="No health records yet" description="Record vaccinations and treatments as they happen." /></Card> : (
              <Card className="mt-4 overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">What was done</th><th className="p-3">Medicine</th><th className="p-3">Withdrawal</th>{manage && <th className="p-3" />}</tr></thead>
                  <tbody className="divide-y divide-ink/10">
                    {records.data.map((r) => (
                      <tr key={r.id} className={r.status === 'voided' ? 'text-ink/45' : ''}>
                        <td className="whitespace-nowrap p-3">{r.on}</td>
                        <td className="p-3">{farm.batchCode(r.batchId)}</td>
                        <td className="p-3"><span className={r.status === 'voided' ? 'line-through' : 'font-medium'}>{r.title}</span> <Badge>{label(r.type)}</Badge>{r.notes && <div className="text-xs text-ink/60">{r.notes}</div>}{r.status === 'voided' && <div className="text-xs">Voided: {r.voidReason}</div>}</td>
                        <td className="p-3">{r.productId ? `${farm.productName(r.productId)} · ${qty(r.quantity ?? 0)} ${farm.productUnit(r.productId)}` : '–'}</td>
                        <td className="p-3">{r.withdrawalDays > 0 ? `${r.withdrawalDays} d, until ${r.withdrawalEndsOn}` : '–'}</td>
                        {manage && <td className="p-3 text-right">{r.status === 'posted' && <Button variant="ghost" onClick={() => setVoiding(r)}>Void</Button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {adding && <HealthDialog businessId={businessId} batches={data.batches.filter((b) => b.status === 'active')} products={catalog.products.filter((p) => p.status === 'active')} locations={catalog.locations} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await Promise.all([records.refresh(), farm.refresh()]) }} />}
            {voiding && <VoidDialog businessId={businessId} record={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await Promise.all([records.refresh(), farm.refresh()]) }} />}
          </>
        )}
      </FarmGate>
    </>
  )
}

function HealthDialog({ businessId, batches, products, locations, onClose, onSaved }: {
  businessId: string; batches: { id: string; code: string; species: string }[]; products: { id: string; name: string; unit: string }[]; locations: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void>
}) {
  const runner = useFormRunner(onSaved)
  const [type, setType] = useState<(typeof TYPES)[number]>('treatment')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const medical = type === 'treatment' || type === 'vaccination'
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!s('batch')) next.batch = 'Choose a batch.'
    if (s('title').length < 2) next.title = 'Describe what was done.'
    if (s('product') && !(Number(s('qty')) > 0)) next.qty = 'Enter the quantity used.'
    if (!s('date') || s('date') > today()) next.date = 'Choose today or an earlier date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordHealth(businessId, { batchId: s('batch'), type, title: s('title'), productId: medical && s('product') ? s('product') : null, locationId: s('location'), quantity: medical && s('product') ? Number(s('qty')) : null, on: s('date'), withdrawalDays: medical ? Number(s('days') || 0) : 0, notes: s('notes') }, k), 'Recorded.')
  }
  return (
    <DetailPage title="Record a health event" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Batch" name="batch" defaultValue="" error={errors.batch}><option value="" disabled>Select…</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.species}</option>)}</SelectField>
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
        </div>
        <TextField label="What was done?" name="title" error={errors.title} placeholder="e.g. Newcastle booster" maxLength={200} />
        {medical && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Medicine used (optional)" name="product" defaultValue="" hint="Taken out of stock."><option value="">None</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</SelectField>
              <TextField label="Quantity" name="qty" type="number" min="0" step="any" error={errors.qty} />
              <SelectField label="Take from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
            </div>
            <TextField label="Withdrawal period (days)" name="days" type="number" min="0" max="365" defaultValue="0" hint="Produce and animals from this batch cannot be sold or harvested until it ends." />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} error={errors.date} /><TextField label="Notes (optional)" name="notes" /></div>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record</Button></div>
      </form>
    </DetailPage>
  )
}

function VoidDialog({ businessId, record, onClose, onSaved }: { businessId: string; record: HealthDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Void: ${record.title}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidHealth(businessId, record.id, reason, k), 'Voided.') }} className="space-y-4">
        <p className="text-sm text-ink/80">Medicine used goes back into stock and any withdrawal period from this record ends.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not voided" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Void</Button></div>
      </form>
    </Dialog>
  )
}
