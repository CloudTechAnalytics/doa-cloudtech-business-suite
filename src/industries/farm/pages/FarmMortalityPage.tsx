import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { BatchSelect, FarmGate, ReadOnlyNotice, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { recordMortality, reverseEvent } from '../services/farmApi'
import { mortalityRate } from '../types'

export function FarmMortalityPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Mortality" description="Deaths reduce the batch's animal count. Rate = deaths (net of corrections) ÷ animals that entered the batch." />
      <FarmGate farm={farm}>
        {(data) => {
          const deaths = data.events.filter((e) => e.type === 'mortality')
          async function submit(e: FormEvent<HTMLFormElement>) {
            e.preventDefault()
            const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
            const next: Record<string, string> = {}
            if (!s('batch')) next.batch = 'Choose a batch.'
            if (!(Number(s('qty')) > 0)) next.qty = 'Enter how many died.'
            if (s('cause').trim().length < 3) next.cause = 'Give a cause (at least 3 characters).'
            setErrors(next)
            if (Object.keys(next).length) return
            await runner.run((k) => recordMortality(farm.businessId, s('batch'), Number(s('qty')), s('cause'), s('date'), k), 'Mortality recorded.', () => form.reset())
          }
          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {farm.activeBatches.map((b) => (
                  <Card key={b.id}><p className="text-xs uppercase tracking-wide text-navy/60">{b.code}</p><p className="tabular mt-1 text-xl font-semibold">{mortalityRate(b).toFixed(1)}%</p><p className="text-xs text-navy/60">{b.mortality.toLocaleString()} of {b.entering.toLocaleString()} entered</p></Card>
                ))}
              </div>
              <ReadOnlyNotice show={!can} />
              {can && (
                <Card className="mb-4">
                  <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-4">
                    <BatchSelect batches={farm.activeBatches} error={errors.batch} />
                    <TextField label="Number that died" name="qty" type="number" min="1" step="any" error={errors.qty} />
                    <TextField label="Cause" name="cause" error={errors.cause} placeholder="Disease, heat, predator…" />
                    <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
                    <div className="space-y-2 sm:col-span-4">
                      {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
                      {runner.ok && <Notice>{runner.ok}</Notice>}
                      <Button type="submit" loading={runner.busy}>Record mortality</Button>
                    </div>
                  </form>
                </Card>
              )}
              {deaths.length === 0 ? <EmptyState title="No mortality recorded" /> : (
                <Card className="p-0">
                  <ul className="divide-y divide-navy/10 text-sm">
                    {deaths.slice(0, 50).map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2 p-3">
                        <b>{farm.batchCode(e.batchId)}</b><span className="tabular text-danger">{e.quantity}</span><span className="text-navy/70">{e.reason}</span>
                        {e.reversed && <Badge tone="warning">Corrected</Badge>}
                        <span className="ml-auto text-xs text-navy/50">{dateTime(e.on)}</span>
                        {farm.can('farm.manage') && !e.reversed && (
                          <Button variant="ghost" onClick={async () => { const why = window.prompt('Reason for correcting this entry?'); if (why) await runner.run((k) => reverseEvent(farm.businessId, e.id, why, k), 'Correction posted.') }}>Correct</Button>
                        )}
                      </li>
                    ))}
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
