import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import { label } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { addActivity } from '../services/farmApi'

const TYPES = ['observation', 'water_check', 'cleaning', 'treatment_note', 'maintenance', 'other']

export function FarmDailyPage() {
  const farm = useFarm()
  const [day, setDay] = useState(today())
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<string | undefined>()
  const can = farm.can('farm.record')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
    if (!s('notes').trim()) return setFieldErr('Write a short note.')
    if (!s('target')) return setFieldErr('Choose a batch or unit.')
    setFieldErr(undefined)
    const [kind, id] = s('target').split(':')
    const err = await addActivity(farm.businessId, { batchId: kind === 'b' ? id : null, unitId: kind === 'u' ? id : null, type: s('type'), notes: s('notes'), on: day })
    setError(err)
    if (!err) { form.reset(); await farm.refresh() }
  }

  return (
    <>
      <PageHeader title="Daily operations" description="Everything recorded on the farm for one day, in one place." />
      <FarmGate farm={farm}>
        {(data) => {
          const entries = [
            ...data.events.filter((e) => e.on === day && e.type !== 'opening').map((e) => ({ id: `e${e.id}`, kind: label(e.type), tone: e.quantity < 0 ? ('danger' as const) : ('success' as const), text: `${farm.batchCode(e.batchId)}: ${e.quantity > 0 ? '+' : ''}${e.quantity}${e.reason ? ` (${e.reason})` : ''}` })),
            ...data.feeds.filter((f) => f.on === day && f.status === 'posted').map((f) => ({ id: `f${f.id}`, kind: 'Feeding', tone: 'info' as const, text: `${farm.batchCode(f.batchId)}: ${f.quantity} ${farm.productUnit(f.productId)} ${farm.productName(f.productId)}` })),
            ...data.harvests.filter((h) => h.date === day && h.status === 'posted').map((h) => ({ id: `h${h.id}`, kind: 'Harvest', tone: 'success' as const, text: `${farm.batchCode(h.batchId)}: ${h.quantity} ${farm.productUnit(h.productId)} ${farm.productName(h.productId)}` })),
            ...data.activities.filter((a) => a.on === day).map((a) => ({ id: `a${a.id}`, kind: label(a.type), tone: 'neutral' as const, text: `${a.batchId ? farm.batchCode(a.batchId) : farm.unitName(a.unitId)}: ${a.notes}` })),
          ]
          return (
            <>
              <div className="mb-3 max-w-xs"><TextField label="Day" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} /></div>
              {error && <ErrorState message={error} />}
              <ReadOnlyNotice show={!can} />
              {can && (
                <Card className="mb-4">
                  <form onSubmit={submit} noValidate className="grid items-end gap-3 sm:grid-cols-4">
                    <SelectField label="About" name="target" defaultValue="" error={fieldErr}>
                      <option value="" disabled>Select…</option>
                      {data.batches.filter((b) => b.status === 'active').map((b) => <option key={b.id} value={`b:${b.id}`}>Batch {b.code}</option>)}
                      {data.units.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={`u:${u.id}`}>Unit {u.name}</option>)}
                    </SelectField>
                    <SelectField label="Type" name="type">{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
                    <TextField label="Note" name="notes" />
                    <Button type="submit">Add note</Button>
                  </form>
                </Card>
              )}
              {entries.length === 0 ? <EmptyState title="Nothing recorded for this day" description="Mortality, feeding, harvests and notes appear here." /> : (
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
