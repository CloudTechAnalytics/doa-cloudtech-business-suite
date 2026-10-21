import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState, PageHeader } from '@/shared/components'
import { DataTable } from '@/shared/tables/DataTable'
import { dateTime } from '@/shared/utilities/format'
import { FarmKpis } from '../components/FarmKpis'
import { CountBasis, FarmGate } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { mortalityRate } from '../types'
import type { FarmBatch } from '../types'

export function FarmOverviewPage() {
  const farm = useFarm()
  return (
    <>
      <PageHeader title="Farm overview" description="Live figures from your batches, feed, harvests and daily records." />
      <FarmGate farm={farm}>
        {(data) => {
          const active = data.batches.filter((b) => b.status === 'active')
          const recent = data.activities.slice(0, 5)
          return (
            <>
              <FarmKpis farm={farm} />
              <h2 className="mb-2 mt-6 text-sm font-semibold">Active batches</h2>
              {active.length === 0 ? (
                <EmptyState title="No active batches" description="Start a batch to begin recording." action={<Link className="underline" to="/app/farm/batches">Go to batches</Link>} />
              ) : (
                <DataTable<FarmBatch>
                  rows={active} total={active.length} page={0} pageSize={active.length} onPage={() => {}} rowKey={(b) => b.id} emptyTitle="No active batches"
                  columns={[
                    { key: 'code', header: 'Batch', render: (b) => <><b>{b.code}</b><div className="text-xs text-ink/60">{b.species} · {farm.unitName(b.unitId)}</div></> },
                    { key: 'pop', header: 'Animals now', align: 'right', render: (b) => <>{b.population.toLocaleString()} <CountBasis basis={b.basis} /></> },
                    { key: 'mort', header: 'Mortality', align: 'right', render: (b) => `${mortalityRate(b).toFixed(1)}%` },
                    { key: 'feed', header: 'Feed given', align: 'right', render: (b) => b.feed.toLocaleString() },
                    { key: 'since', header: 'Started', render: (b) => b.startDate },
                  ]}
                />
              )}
              <Card className="mt-6">
                <h2 className="mb-2 text-sm font-semibold">Latest daily notes</h2>
                {recent.length === 0 ? <p className="text-sm text-ink/60">No notes yet. Add one on the Daily operations page.</p> : (
                  <ul className="divide-y divide-ink/10 text-sm">
                    {recent.map((a) => <li key={a.id} className="flex flex-wrap gap-2 py-1.5"><Badge>{a.type.replace('_', ' ')}</Badge>{a.notes}<span className="ml-auto text-xs text-ink/50">{dateTime(a.on)}</span></li>)}
                  </ul>
                )}
              </Card>
            </>
          )
        }}
      </FarmGate>
    </>
  )
}
