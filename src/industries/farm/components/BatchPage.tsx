import { Egg, NotebookPen, Skull, Stethoscope, Utensils } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, SelectField, TextField } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { DeleteButton } from '@/shared/components/delete-button'
import { DetailPage } from '@/shared/components/detail-page'
import { deleteKey } from '@/shared/components/ShowDeleted'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { deleteRecord } from '@/shared/utilities/deleteRecord'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { CountBasis, sumByUnit, today } from './farmUi'
import { DeathsForm, FeedForm, HarvestForm } from './recordForms'
import type { FarmContext } from '../hooks/useFarm'
import { addActivity, adjustPopulation, closeBatch, reverseEvent, voidFeeding, voidHarvest } from '../services/farmApi'
import { listBatchCosts, listHealth, voidHealth } from '../services/opsApi'
import type { HealthDto } from '../services/opsApi'
import { mortalityRate } from '../types'
import type { FarmBatch, FarmData } from '../types'

type Data = NonNullable<FarmContext['data']>
type Catalog = NonNullable<FarmContext['catalog']>
type Kind = 'feed' | 'deaths' | 'harvest' | 'note'
/** What deleting an entry undoes: a count change is reversed, feeding and harvests go back to stock, a treatment's medicine returns, a note is removed. */
export interface Removable { kind: 'event' | 'feed' | 'harvest' | 'health' | 'note'; id: string }
export interface TimelineEntry { id: string; on: string; kind: string; tone: 'success' | 'danger' | 'info' | 'warning' | 'neutral'; text: string; /** The batch it belongs to, when the list covers several. */ batchId: string | null; /** For a note about a pen, pond or field rather than a batch. */ unitId?: string | null; remove?: Removable }

const COUNT_TYPES: Record<string, string> = { opening: 'Started', mortality: 'Died', removal: 'Sold or removed', cull: 'Culled', adjustment: 'Recount', harvest: 'Taken out', closing: 'Written off', reversal: 'Correction' }
const DAY = 86400000

/**
 * Everything recorded on the farm, newest first: count changes, feeding, harvests, treatments and notes. Deleted records (voided, or count
 * changes that were reversed) are left out, and so are the reversing entries themselves: the two cancel out.
 */
export function farmTimeline(data: FarmData, health: HealthDto[], name: { product: (id: string) => string; unit: (id: string) => string }, only: { batchId?: string; day?: string } = {}): TimelineEntry[] {
  const qty = (n: number, productId: string) => `${n.toLocaleString()} ${name.unit(productId)} ${name.product(productId)}`.replace(/\s+/g, ' ')
  const keep = (batchId: string | null, on: string) => (!only.batchId || batchId === only.batchId) && (!only.day || on.slice(0, 10) === only.day)
  return [
    ...data.events.filter((e) => !e.reversed && e.type !== 'correction' && keep(e.batchId, e.on)).map((e): TimelineEntry => ({ id: `e${e.id}`, on: e.on, batchId: e.batchId, kind: COUNT_TYPES[e.type] ?? label(e.type), tone: e.type === 'opening' ? 'info' : e.quantity < 0 ? 'danger' : 'success', text: `${e.quantity > 0 ? '+' : ''}${e.quantity.toLocaleString()}${e.reason ? ` · ${e.reason}` : ''}`, remove: ['mortality', 'removal', 'cull', 'adjustment'].includes(e.type) ? { kind: 'event', id: e.id } : undefined })),
    ...data.feeds.filter((f) => f.status === 'posted' && keep(f.batchId, f.on)).map((f): TimelineEntry => ({ id: `f${f.id}`, on: f.on, batchId: f.batchId, kind: 'Fed', tone: 'info', text: qty(f.quantity, f.productId) + (f.notes ? ` · ${f.notes}` : ''), remove: { kind: 'feed', id: f.id } })),
    ...data.harvests.filter((h) => h.status === 'posted' && keep(h.batchId, h.date)).map((h): TimelineEntry => ({ id: `h${h.id}`, on: h.date, batchId: h.batchId, kind: 'Collected', tone: 'success', text: qty(h.quantity, h.productId), remove: { kind: 'harvest', id: h.id } })),
    ...health.filter((t) => t.status === 'posted' && keep(t.batchId, t.on)).map((t): TimelineEntry => ({ id: `t${t.id}`, on: t.on, batchId: t.batchId, kind: label(t.type), tone: 'warning', text: `${t.title}${t.withdrawalEndsOn ? ` · do not sell until ${t.withdrawalEndsOn}` : ''}`, remove: { kind: 'health', id: t.id } })),
    ...data.activities.filter((a) => (!only.batchId || a.batchId === only.batchId) && (!only.day || a.on.slice(0, 10) === only.day)).map((a): TimelineEntry => ({ id: `a${a.id}`, on: a.on, batchId: a.batchId, unitId: a.unitId, kind: label(a.type), tone: 'neutral', text: a.notes, remove: { kind: 'note', id: a.id } })),
  ].sort((a, b) => b.on.localeCompare(a.on) || b.id.localeCompare(a.id))
}

/** Everything that happened to one batch, newest first. */
export const batchTimeline = (data: FarmData, health: HealthDto[], batchId: string, name: { product: (id: string) => string; unit: (id: string) => string }) => farmTimeline(data, health, name, { batchId })

const WHAT_DELETE_UNDOES: Record<Removable['kind'], string> = {
  event: 'The count goes back to what it was before this entry.',
  feed: 'The feed goes back into stock.',
  harvest: 'The produce is taken back out of stock, and any animals taken out are counted again.',
  health: 'Any medicine taken from stock goes back, and its do-not-sell warning ends.',
  note: 'The note is removed.',
}

/** Who may delete an entry: a farm manager, or for a note also the people who record farm work. */
export const canDelete = (farm: Pick<FarmContext, 'can'>, r: Removable) => farm.can('farm.manage') || (r.kind === 'note' && farm.can('farm.record'))

/** Delete for one line of a farm history: asks first (with a reason), undoes the record's effect, and refreshes. */
export function DeleteEntry({ farm, entry, onDeleted }: { farm: FarmContext; entry: TimelineEntry; onDeleted: () => void | Promise<void> }) {
  const r = entry.remove
  if (!r || !canDelete(farm, r)) return null
  const run = (why: string): Promise<string | null> => {
    const b = farm.businessId; const k = deleteKey()
    switch (r.kind) {
      case 'event': return reverseEvent(b, r.id, why, k)
      case 'feed': return voidFeeding(b, r.id, why, k)
      case 'harvest': return voidHarvest(b, r.id, why, k)
      case 'health': return voidHealth(b, r.id, why, k)
      case 'note': return deleteRecord(b, 'farm_note', r.id)
    }
  }
  return <ConfirmDelete compact withReason={r.kind !== 'note'} noun={r.kind === 'note' ? 'note' : 'record'} label={`${entry.kind}: ${entry.text}`} warning={WHAT_DELETE_UNDOES[r.kind]} onConfirm={run} onDeleted={onDeleted} />
}

/** The latest date the batch's produce must not be sold until, from treatments still in their waiting period (null when none). */
export function sellAfter(health: HealthDto[], batchId: string, on = today()): string | null {
  const ends = health.filter((t) => t.batchId === batchId && t.status === 'posted' && t.withdrawalEndsOn && t.withdrawalEndsOn >= on).map((t) => t.withdrawalEndsOn!)
  return ends.length ? ends.sort().at(-1)! : null
}

function Stat({ title, value, note }: { title: string; value: ReactNode; note?: string }) {
  return <div className="rounded-lg border border-line p-3"><dt className="text-xs text-ink/60">{title}</dt><dd className="tabular mt-1 text-lg font-semibold">{value}</dd>{note && <p className="text-xs text-ink/60">{note}</p>}</div>
}

/** One flock, fish stock, herd or crop: its figures, buttons to record against it, and its whole history. */
export function BatchPage({ farm, data, catalog, id, onClose }: { farm: FarmContext; data: Data; catalog: Catalog; id: string; onClose: () => void }) {
  const batch = data.batches.find((b) => b.id === id)
  const health = useAsync(() => listHealth(farm.businessId), [farm.businessId])
  const costs = useAsync(() => listBatchCosts(farm.businessId), [farm.businessId])
  const [doing, setDoing] = useState<Kind | null>(null)
  const [mode, setMode] = useState<'adjust' | 'close' | null>(null)
  const runner = useFormRunner(async () => { setMode(null); await farm.refresh() })
  if (!batch) return <DetailPage title="Not found" onClose={onClose}><EmptyState title="This batch no longer exists" /></DetailPage>

  const crop = batch.productionType === 'crop'
  const active = batch.status === 'active'
  const record = farm.can('farm.record') && active
  const manage = farm.can('farm.manage') && active
  const treatments = health.data ?? []
  const hold = sellAfter(treatments, id)
  const feed = sumByUnit(data.feeds.filter((f) => f.batchId === id && f.status === 'posted').map((f) => ({ quantity: f.quantity, unit: farm.productUnit(f.productId) })))
  const collected = sumByUnit(data.harvests.filter((h) => h.batchId === id && h.status === 'posted').map((h) => ({ quantity: h.quantity, unit: farm.productUnit(h.productId) })))
  const days = Math.max(0, Math.round((Date.parse(active ? today() : (batch.plannedEnd ?? today())) - Date.parse(batch.startDate)) / DAY))
  const timeline = batchTimeline(data, treatments, id, { product: farm.productName, unit: farm.productUnit })
  const choices: { kind: Kind; title: string; icon: ReactNode }[] = [
    ...(crop ? [] : [{ kind: 'feed' as const, title: 'Fed', icon: <Utensils className="size-5" aria-hidden /> }, { kind: 'deaths' as const, title: 'Died', icon: <Skull className="size-5" aria-hidden /> }]),
    { kind: 'harvest', title: crop ? 'Harvested' : 'Collected', icon: <Egg className="size-5" aria-hidden /> },
    { kind: 'note', title: 'Note', icon: <NotebookPen className="size-5" aria-hidden /> },
  ]

  return (
    <DetailPage title={`${batch.code} · ${batch.species}`} onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-ink/60">{batch.variety ? `${batch.variety} · ` : ''}{farm.unitName(batch.unitId)} · {crop ? 'planted' : 'started'} {batch.startDate} ({days} days{active ? '' : ', closed'}) {active ? <Badge tone="success">{crop ? 'Growing' : 'Running'}</Badge> : <Badge>Closed</Badge>}</p>
      {hold && <div className="mb-4"><Notice>Treated recently: do not sell {crop ? 'this crop' : 'eggs, meat or fish'} from this batch until <b>{hold}</b>.</Notice></div>}
      {runner.error && <ErrorState message={runner.error} />}
      {runner.ok && <Notice>{runner.ok}</Notice>}

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {crop ? <Stat title="Area planted" value={batch.opening.toLocaleString()} /> : <Stat title="Count now" value={<>{batch.population.toLocaleString()} <CountBasis basis={batch.basis} /></>} note={`Started with ${batch.opening.toLocaleString()}`} />}
        {!crop && <Stat title="Died" value={batch.mortality.toLocaleString()} note={`${mortalityRate(batch).toFixed(1)}% of all that entered`} />}
        {!crop && <Stat title="Feed given" value={feed} />}
        <Stat title={crop ? 'Harvested' : 'Collected'} value={collected} />
        <Stat title="Money spent" value={naira(costs.data?.get(id) ?? 0)} note="Expenses recorded against it" />
      </dl>

      {record && (
        <Card className="mb-5">
          <h3 className="mb-3 text-sm font-semibold">Record for {batch.code}</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {choices.map((c) => <Button key={c.kind} variant={doing === c.kind ? 'primary' : 'secondary'} aria-pressed={doing === c.kind} onClick={() => setDoing(doing === c.kind ? null : c.kind)}><span className="mr-1">{c.icon}</span>{c.title}</Button>)}
            <Link to="/app/farm/health" className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-surface"><Stethoscope className="size-5" aria-hidden /> Treated</Link>
            <Link to="/app/farm/expenses" className="inline-flex items-center rounded-md px-3 py-2 text-sm text-ink/70 underline">Add an expense</Link>
          </div>
          {doing === 'feed' && <FeedForm farm={farm} catalog={catalog} batchId={id} onSaved={() => setDoing(null)} />}
          {doing === 'deaths' && <DeathsForm farm={farm} batchId={id} onSaved={() => setDoing(null)} />}
          {doing === 'harvest' && <HarvestForm farm={farm} catalog={catalog} batchId={id} onSaved={() => setDoing(null)} />}
          {doing === 'note' && <BatchNote farm={farm} batch={batch} onSaved={() => setDoing(null)} />}
        </Card>
      )}

      <h3 className="mb-2 text-sm font-semibold">History</h3>
      {timeline.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
        <Card className="mb-5 p-0">
          <ul className="divide-y divide-ink/10 text-sm">
            {timeline.slice(0, 100).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="w-24 shrink-0 text-xs text-ink/60">{dateTime(x.on)}</span>
                <Badge tone={x.tone}>{x.kind}</Badge><span>{x.text}</span>
                {active && <span className="ml-auto"><DeleteEntry farm={farm} entry={x} onDeleted={async () => { await Promise.all([farm.refresh(), health.refresh()]) }} /></span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {manage && (
        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">
          {!crop && <Button variant="secondary" onClick={() => setMode(mode === 'adjust' ? null : 'adjust')}>Cull, sell or recount</Button>}
          <Button variant="ghost" onClick={() => setMode(mode === 'close' ? null : 'close')}>{crop ? 'Close this crop' : 'Close this batch'}</Button>
          <span className="ml-auto"><DeleteButton businessId={farm.businessId} kind="farm_batch" id={id} label={`${batch.code} · ${batch.species}`} noun={crop ? 'crop' : 'batch'} onDeleted={async () => { onClose(); await farm.refresh() }} /></span>
        </div>
      )}
      {mode === 'adjust' && (
        <form className="mt-3 grid gap-3 sm:grid-cols-4" noValidate onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          const qty = Number(f.get('qty')); const type = String(f.get('type')) as 'cull' | 'removal' | 'adjustment'
          if (!qty || (type !== 'adjustment' && qty < 0)) return
          await runner.run((k) => adjustPopulation(farm.businessId, id, type, qty, String(f.get('reason') ?? ''), today(), k), 'Count updated.')
        }}>
          <SelectField label="What happened" name="type"><option value="cull">Culled</option><option value="removal">Sold or removed</option><option value="adjustment">Recounted (+/−)</option></SelectField>
          <TextField label="How many" name="qty" type="number" step="any" hint="A negative number only for a recount." />
          <TextField label="Reason" name="reason" />
          <div className="flex items-end"><Button type="submit" loading={runner.busy}>Save</Button></div>
        </form>
      )}
      {mode === 'close' && (
        <form className="mt-3 space-y-3" noValidate onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          await runner.run((k) => closeBatch(farm.businessId, id, String(f.get('reason') ?? ''), f.get('writeoff') === 'on', k), 'Closed.')
        }}>
          <Notice>Closing locks it: nothing more can be recorded against it.{!crop && ' Any animals still counted must be written off, which is recorded.'}</Notice>
          <TextField label="Reason for closing" name="reason" />
          {!crop && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="writeoff" /> Write off the {batch.population.toLocaleString()} animals still counted</label>}
          <Button type="submit" loading={runner.busy}>Close</Button>
        </form>
      )}
    </DetailPage>
  )
}

function BatchNote({ farm, batch, onSaved }: { farm: FarmContext; batch: FarmBatch; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form); const notes = String(f.get('notes') ?? '').trim()
    if (!notes) return setError('Write a short note.')
    setBusy(true)
    const err = await addActivity(farm.businessId, { batchId: batch.id, unitId: null, type: String(f.get('type')), notes, on: String(f.get('date') || today()) })
    setBusy(false); setError(err)
    if (!err) { form.reset(); await farm.refresh(); onSaved() }
  }
  return (
    <form onSubmit={submit} noValidate className="grid items-end gap-3 sm:grid-cols-4">
      <SelectField label="Kind of note" name="type">{['observation', 'water_check', 'cleaning', 'treatment_note', 'maintenance', 'other'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
      <TextField label="Note" name="notes" />
      <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
      <Button type="submit" loading={busy}>Save note</Button>
      {error && <div className="sm:col-span-4"><ErrorState message={error} /></div>}
    </form>
  )
}
