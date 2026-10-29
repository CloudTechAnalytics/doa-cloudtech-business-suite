import { Egg, NotebookPen, Skull, Stethoscope, Utensils } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import { label } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice, today } from '../components/farmUi'
import { DeathsForm, FeedForm, HarvestForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { addActivity } from '../services/farmApi'

const TYPES = ['observation', 'water_check', 'cleaning', 'treatment_note', 'maintenance', 'other']
type Kind = 'feed' | 'deaths' | 'harvest' | 'note'
const CHOICES: { kind: Kind; title: string; hint: string; icon: ReactNode }[] = [
  { kind: 'feed', title: 'Fed', hint: 'Feed given to a flock or pond', icon: <Utensils className="size-6" aria-hidden /> },
  { kind: 'deaths', title: 'Died', hint: 'Animals that died', icon: <Skull className="size-6" aria-hidden /> },
  { kind: 'harvest', title: 'Collected', hint: 'Eggs, fish or crops harvested', icon: <Egg className="size-6" aria-hidden /> },
  { kind: 'note', title: 'Note', hint: 'Water, cleaning, anything seen', icon: <NotebookPen className="size-6" aria-hidden /> },
]

/** One place to record the day's work: choose what happened, fill in a short form, and see everything recorded that day underneath. */
export function FarmDailyPage() {
  const farm = useFarm()
  const [params, setParams] = useSearchParams()
  const picked = (params.get('do') as Kind | null) ?? null
  const choose = (k: Kind | null) => setParams(k ? { do: k } : {}, { replace: true })
  const [day, setDay] = useState(today())
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Record today" description="What happened on the farm? Choose one, fill in the short form, and it is saved. Everything recorded for the day is listed below." />
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const entries = [
            ...data.events.filter((e) => e.on === day && e.type !== 'opening').map((e) => ({ id: `e${e.id}`, kind: e.type === 'mortality' ? 'Died' : label(e.type), tone: e.quantity < 0 ? ('danger' as const) : ('success' as const), text: `${farm.batchCode(e.batchId)}: ${e.quantity > 0 ? '+' : ''}${e.quantity}${e.reason ? ` (${e.reason})` : ''}` })),
            ...data.feeds.filter((f) => f.on === day && f.status === 'posted').map((f) => ({ id: `f${f.id}`, kind: 'Fed', tone: 'info' as const, text: `${farm.batchCode(f.batchId)}: ${f.quantity} ${farm.productUnit(f.productId)} ${farm.productName(f.productId)}` })),
            ...data.harvests.filter((h) => h.date === day && h.status === 'posted').map((h) => ({ id: `h${h.id}`, kind: 'Collected', tone: 'success' as const, text: `${farm.batchCode(h.batchId)}: ${h.quantity} ${farm.productUnit(h.productId)} ${farm.productName(h.productId)}` })),
            ...data.activities.filter((a) => a.on === day).map((a) => ({ id: `a${a.id}`, kind: label(a.type), tone: 'neutral' as const, text: `${a.batchId ? farm.batchCode(a.batchId) : farm.unitName(a.unitId)}: ${a.notes}` })),
          ]
          return (
            <>
              <ReadOnlyNotice show={!can} />
              {can && (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {CHOICES.map((c) => (
                      <button key={c.kind} type="button" onClick={() => choose(picked === c.kind ? null : c.kind)} aria-pressed={picked === c.kind}
                        className={`flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors ${picked === c.kind ? 'border-brand bg-brand/10' : 'border-line bg-white hover:border-brand/50 hover:bg-surface'}`}>
                        <span className="text-brand">{c.icon}</span><span className="font-semibold">{c.title}</span><span className="text-xs text-ink/60">{c.hint}</span>
                      </button>
                    ))}
                    <Link to="/app/farm/health" className="flex flex-col items-start gap-1 rounded-xl border border-line bg-white p-4 text-left transition-colors hover:border-brand/50 hover:bg-surface">
                      <span className="text-brand"><Stethoscope className="size-6" aria-hidden /></span><span className="font-semibold">Treated</span><span className="text-xs text-ink/60">Medicine or vaccine (opens Health)</span>
                    </Link>
                  </div>
                  {picked === 'feed' && <FeedForm farm={farm} catalog={catalog} />}
                  {picked === 'deaths' && <DeathsForm farm={farm} />}
                  {picked === 'harvest' && <HarvestForm farm={farm} catalog={catalog} />}
                  {picked === 'note' && <NoteForm farm={farm} day={day} />}
                </>
              )}
              <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3">
                <h2 className="font-semibold">Recorded on this day</h2>
                <div className="w-48"><TextField label="Day" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} /></div>
              </div>
              {entries.length === 0 ? <EmptyState title="Nothing recorded for this day" description="Feeding, deaths, harvests and notes appear here." /> : (
                <Card className="p-0">
                  <ul className="divide-y divide-ink/10 text-sm">
                    {entries.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 p-3"><Badge tone={x.tone}>{x.kind}</Badge>{x.text}</li>)}
                  </ul>
                </Card>
              )}
            </>
          )
        }}
      </FarmGate>
    </>
  )
}

function NoteForm({ farm, day }: { farm: ReturnType<typeof useFarm>; day: string }) {
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<string | undefined>()
  const data = farm.data!
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
    if (!s('target')) return setFieldErr('Choose a batch or a pen, pond or field.')
    if (!s('notes').trim()) return setFieldErr('Write a short note.')
    setFieldErr(undefined)
    const [kind, id] = s('target').split(':')
    const err = await addActivity(farm.businessId, { batchId: kind === 'b' ? id : null, unitId: kind === 'u' ? id : null, type: s('type'), notes: s('notes'), on: day })
    setError(err)
    if (!err) { form.reset(); await farm.refresh() }
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid items-end gap-3 sm:grid-cols-4">
        <SelectField label="About" name="target" defaultValue="" error={fieldErr}>
          <option value="" disabled>Select…</option>
          {data.batches.filter((b) => b.status === 'active').map((b) => <option key={b.id} value={`b:${b.id}`}>Batch {b.code}</option>)}
          {data.units.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={`u:${u.id}`}>{u.name}</option>)}
        </SelectField>
        <SelectField label="Kind of note" name="type">{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
        <TextField label="Note" name="notes" />
        <Button type="submit">Save note</Button>
        {error && <div className="sm:col-span-4"><ErrorState message={error} /></div>}
      </form>
    </Card>
  )
}
