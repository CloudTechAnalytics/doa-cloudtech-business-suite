import { useState } from 'react'
import { Card, EmptyState, PageHeader } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { ShowDeleted, deleteKey } from '@/shared/components/ShowDeleted'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { DeathsForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { reverseEvent } from '../services/farmApi'
import { mortalityRate } from '../types'

export function FarmMortalityPage() {
  const farm = useFarm()
  const [showDeleted, setShowDeleted] = useState(false)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Deaths" description="Deaths lower a batch's count. The death rate is deaths out of all the animals that entered the batch. Deleting a wrong entry puts the animals back in the count." />
      <FarmGate farm={farm}>
        {(data) => {
          const deaths = data.events.filter((e) => e.type === 'mortality')
          const rows = deaths.filter((e) => showDeleted || !e.reversed)
          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {farm.activeBatches.map((b) => (
                  <Card key={b.id}><p className="text-xs uppercase tracking-wide text-ink/60">{b.code}</p><p className="tabular mt-1 text-xl font-semibold">{mortalityRate(b).toFixed(1)}%</p><p className="text-xs text-ink/60">{b.mortality.toLocaleString()} died of {b.entering.toLocaleString()} entered</p></Card>
                ))}
              </div>
              <ReadOnlyNotice show={!can} />
              {can && <DeathsForm farm={farm} />}
              {rows.length === 0 ? <EmptyState title="No deaths recorded" /> : (
                <Card className="p-0">
                  <ul className="divide-y divide-ink/10 text-sm">
                    {rows.slice(0, 50).map((e) => (
                      <li key={e.id} className={`flex flex-wrap items-center gap-2 p-3 ${e.reversed ? 'opacity-50' : ''}`}>
                        <b>{farm.batchCode(e.batchId)}</b><span className="tabular text-danger">{e.quantity}</span><span className="text-ink/70">{e.reason}</span>
                        {e.reversed && <span className="text-xs">Deleted</span>}
                        <span className="ml-auto text-xs text-ink/50">{dateTime(e.on)}</span>
                        {farm.can('farm.manage') && !e.reversed && (
                          <ConfirmDelete compact withReason noun="death record" label={`${-e.quantity} died in ${farm.batchCode(e.batchId)}`} warning="The animals are counted in the batch again." onConfirm={(why) => reverseEvent(farm.businessId, e.id, why, deleteKey())} onDeleted={farm.refresh} />
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <ShowDeleted count={deaths.filter((e) => e.reversed).length} show={showDeleted} onChange={setShowDeleted} />
            </>
          )
        }}
      </FarmGate>
    </>
  )
}
