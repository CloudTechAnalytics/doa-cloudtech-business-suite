import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { ShowDeleted, deleteKey } from '@/shared/components/ShowDeleted'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, qty } from '@/shared/utilities/format'
import { FarmGate, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { listHealth, recordHealth, voidHealth } from '../services/opsApi'

const TYPES = ['treatment', 'vaccination', 'inspection', 'quarantine'] as const
const TYPE_LABEL: Record<(typeof TYPES)[number], string> = { treatment: 'Gave medicine', vaccination: 'Vaccinated', inspection: 'Checked (no medicine)', quarantine: 'Separated sick animals' }

/** Treatments, vaccinations and inspections per batch. A treatment can start a withdrawal period during which the batch's produce and animals cannot be sold. */
export function FarmHealthPage() {
  const { active } = useBusiness()
  const farm = useFarm()
  const businessId = active?.id ?? ''
  const records = useAsync(() => listHealth(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  if (!active) return null
  const record = farm.can('farm.record'); const manage = farm.can('farm.manage')
  const shown = (records.data ?? []).filter((r) => showDeleted || r.status !== 'voided')
  const live = (records.data ?? []).filter((r) => r.status === 'posted' && r.withdrawalEndsOn !== null && r.withdrawalEndsOn >= today())

  return (
    <>
      <PageHeader title="Health & treatments" description="Medicines, vaccines and check-ups given to each flock or pond. If a medicine says to wait before selling eggs, meat or fish, enter the number of days: the farm will warn you until then."
        actions={record ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record a treatment</Button> : undefined} />
      {records.error && <ErrorState message={records.error} />}
      <FarmGate farm={farm}>
        {(data, catalog) => (
          <>
            {live.length > 0 && (
              <Notice>
                <p className="font-semibold">Recently treated: do not sell or harvest yet</p>
                <ul className="mt-1 text-xs">{live.map((r) => <li key={r.id}>{farm.batchCode(r.batchId)}: {r.title}, until {r.withdrawalEndsOn}</li>)}</ul>
              </Notice>
            )}
            {records.loading ? <Spinner /> : !shown.length ? <Card className="mt-4"><EmptyState title="No treatments recorded yet" description="Record medicines, vaccines and check-ups as they happen." /></Card> : (
              <Card className="mt-4 overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">What was given or done</th><th className="p-3">Taken from stock</th><th className="p-3">Do not sell until</th>{manage && <th className="p-3" />}</tr></thead>
                  <tbody className="divide-y divide-ink/10">
                    {shown.map((r) => (
                      <tr key={r.id} className={r.status === 'voided' ? 'text-ink/45' : ''}>
                        <td className="whitespace-nowrap p-3">{r.on}</td>
                        <td className="p-3">{farm.batchCode(r.batchId)}</td>
                        <td className="p-3"><span className={r.status === 'voided' ? 'line-through' : 'font-medium'}>{r.title}</span> <Badge>{label(r.type)}</Badge>{r.notes && <div className="text-xs text-ink/60">{r.notes}</div>}{r.status === 'voided' && <div className="text-xs">Deleted: {r.voidReason}</div>}</td>
                        <td className="p-3">{r.productId ? `${farm.productName(r.productId)} · ${qty(r.quantity ?? 0)} ${farm.productUnit(r.productId)}` : '–'}</td>
                        <td className="p-3">{r.withdrawalDays > 0 ? `${r.withdrawalEndsOn} (${r.withdrawalDays} days)` : '–'}</td>
                        {manage && <td className="p-3 text-right">{r.status === 'posted' && <ConfirmDelete compact withReason noun="treatment" label={`${r.title} for ${farm.batchCode(r.batchId)}`} warning="Any medicine taken from stock goes back, and the do-not-sell warning from it ends." onConfirm={(why) => voidHealth(businessId, r.id, why, deleteKey())} onDeleted={async () => { await Promise.all([records.refresh(), farm.refresh()]) }} />}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <ShowDeleted count={(records.data ?? []).filter((r) => r.status === 'voided').length} show={showDeleted} onChange={setShowDeleted} />
            {adding && <HealthDialog businessId={businessId} batches={data.batches.filter((b) => b.status === 'active')} products={catalog.products.filter((p) => p.status === 'active')} locations={catalog.locations} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await Promise.all([records.refresh(), farm.refresh()]) }} />}
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
    if (!s('batch')) next.batch = 'Choose the flock or pond.'
    if (s('title').length < 2) next.title = medical ? 'Write the medicine or vaccine name.' : 'Describe what was done.'
    if (s('product') && !(Number(s('qty')) > 0)) next.qty = 'Enter the quantity used.'
    if (!s('date') || s('date') > today()) next.date = 'Choose today or an earlier date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordHealth(businessId, { batchId: s('batch'), type, title: s('title'), productId: medical && s('product') ? s('product') : null, locationId: s('location'), quantity: medical && s('product') ? Number(s('qty')) : null, on: s('date'), withdrawalDays: medical ? Number(s('days') || 0) : 0, notes: s('notes') }, k), 'Recorded.')
  }
  return (
    <DetailPage modal title="Record a treatment" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Flock, pond or batch" name="batch" defaultValue="" error={errors.batch}><option value="" disabled>Select…</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.species}</option>)}</SelectField>
          <SelectField label="What happened" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</SelectField>
        </div>
        <TextField label={medical ? 'Medicine or vaccine given' : 'What was done?'} name="title" error={errors.title} placeholder={medical ? 'e.g. Newcastle vaccine, Oxytetracycline' : 'e.g. Weekly check, sick birds moved out'} maxLength={200} />
        {medical && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Take it out of Stock? (optional)" name="product" defaultValue="" hint="Only if you keep this medicine in Stock. Leave as 'No' otherwise."><option value="">No</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</SelectField>
              <TextField label="How much was used" name="qty" type="number" min="0" step="any" error={errors.qty} />
              <SelectField label="Take from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
            </div>
            <TextField label="Days to wait before selling (optional)" name="days" type="number" min="0" max="365" defaultValue="0" hint="Many medicines say: do not sell eggs, meat or fish for some days. Enter that number; leave 0 if none." />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} error={errors.date} /><TextField label="Notes (optional)" name="notes" /></div>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record</Button></div>
      </form>
    </DetailPage>
  )
}
