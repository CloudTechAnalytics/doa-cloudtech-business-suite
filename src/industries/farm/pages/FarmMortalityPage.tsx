import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { DeathsForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { reverseEvent } from '../services/farmApi'
import { mortalityRate } from '../types'

export function FarmMortalityPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Deaths" description="Deaths lower a batch's count. The death rate is deaths (after corrections) out of all the animals that entered the batch." />
      <FarmGate farm={farm}>
        {(data) => {
          const deaths = data.events.filter((e) => e.type === 'mortality')
          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {farm.activeBatches.map((b) => (
                  <Card key={b.id}><p className="text-xs uppercase tracking-wide text-ink/60">{b.code}</p><p className="tabular mt-1 text-xl font-semibold">{mortalityRate(b).toFixed(1)}%</p><p className="text-xs text-ink/60">{b.mortality.toLocaleString()} died of {b.entering.toLocaleString()} entered</p></Card>
                ))}
              </div>
              <ReadOnlyNotice show={!can} />
              {can && <DeathsForm farm={farm} />}
              {runner.error && <ErrorState message={runner.error} />}
              {runner.ok && <Notice>{runner.ok}</Notice>}
              {deaths.length === 0 ? <EmptyState title="No deaths recorded" /> : (
                <Card className="p-0">
                  <ul className="divide-y divide-ink/10 text-sm">
                    {deaths.slice(0, 50).map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2 p-3">
                        <b>{farm.batchCode(e.batchId)}</b><span className="tabular text-danger">{e.quantity}</span><span className="text-ink/70">{e.reason}</span>
                        {e.reversed && <Badge tone="warning">Corrected</Badge>}
                        <span className="ml-auto text-xs text-ink/50">{dateTime(e.on)}</span>
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
