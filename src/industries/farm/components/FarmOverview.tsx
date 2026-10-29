import { CheckCircle2, Circle, Egg, NotebookPen, Skull, Utensils } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState } from '@/shared/components'
import { DataTable } from '@/shared/tables/DataTable'
import { dateTime } from '@/shared/utilities/format'
import { CountBasis, FarmGate } from './farmUi'
import { FarmKpis } from './FarmKpis'
import { useFarm } from '../hooks/useFarm'
import type { FarmContext } from '../hooks/useFarm'
import { mortalityRate } from '../types'
import type { FarmBatch } from '../types'

const RECORD: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/app/farm/daily?do=feed', label: 'Fed', icon: <Utensils className="size-5" aria-hidden /> },
  { to: '/app/farm/daily?do=deaths', label: 'Died', icon: <Skull className="size-5" aria-hidden /> },
  { to: '/app/farm/daily?do=harvest', label: 'Collected', icon: <Egg className="size-5" aria-hidden /> },
  { to: '/app/farm/daily?do=note', label: 'Note', icon: <NotebookPen className="size-5" aria-hidden /> },
]

/** The steps a new farm goes through, in order. Each is done when the farm's own records show it. */
export function setupSteps(data: NonNullable<FarmContext['data']>, catalog: NonNullable<FarmContext['catalog']>) {
  const recorded = data.feeds.length + data.harvests.length + data.activities.length + data.events.filter((e) => e.type !== 'opening').length > 0
  return [
    { done: data.units.length > 0, title: 'Add your pens, ponds or fields', hint: 'Where your animals or crops are kept, for example "Pen A" or "Pond 1".', to: '/app/farm/units' },
    { done: data.batches.length > 0, title: 'Start a flock, fish stock or crop', hint: 'Say what is in each pen, pond or field and how many you started with.', to: '/app/farm/batches' },
    { done: catalog.products.length > 0, title: 'Add your feed and what you sell to Stock', hint: 'Feed, eggs, fish, crops: anything you buy or sell. Feed comes out of stock when you record feeding; eggs and harvests go in when collected.', to: '/app/inventory' },
    { done: recorded, title: 'Record your first day', hint: 'Feeding, deaths, eggs collected or a note: one button each.', to: '/app/farm/daily' },
  ]
}

function GettingStarted({ steps }: { steps: ReturnType<typeof setupSteps> }) {
  const next = steps.findIndex((s) => !s.done)
  return (
    <Card className="mb-6 border-brand/30">
      <h2 className="font-semibold">Getting started</h2>
      <p className="mb-3 text-sm text-ink/60">Four steps, in this order. {steps.filter((s) => s.done).length} of {steps.length} done.</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className={`flex items-start gap-3 rounded-lg p-2 ${i === next ? 'bg-brand/10' : ''}`}>
            {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-ink/40" aria-label="Not done yet" />}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${s.done ? 'text-ink/60 line-through' : ''}`}>{i + 1}. {s.title}</p>
              {!s.done && <p className="text-xs text-ink/60">{s.hint}</p>}
            </div>
            {!s.done && <Link to={s.to} className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${i === next ? 'bg-brand text-white' : 'text-ink/70 underline'}`}>{i === next ? 'Do this now' : 'Open'}</Link>}
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function FarmOverview() {
  const farm = useFarm()
  return (
    <>
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const active = data.batches.filter((b) => b.status === 'active')
          const recent = data.activities.slice(0, 5)
          const steps = setupSteps(data, catalog)
          return (
            <>
              {steps.some((s) => !s.done) && <GettingStarted steps={steps} />}
              {farm.can('farm.record') && active.length > 0 && (
                <Card className="mb-6">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Record today</h2><Link to="/app/farm/daily" className="text-sm text-ink/60 underline">See today's records</Link></div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {RECORD.map((r) => <Link key={r.to} to={r.to} className="flex items-center gap-2 rounded-lg border border-line p-3 font-medium hover:border-brand/50 hover:bg-surface"><span className="text-brand">{r.icon}</span>{r.label}</Link>)}
                  </div>
                </Card>
              )}
              <FarmKpis farm={farm} />
              <h2 className="mb-2 mt-6 text-sm font-semibold">Flocks, fish and crops now</h2>
              {active.length === 0 ? (
                <EmptyState title="Nothing running yet" description="Start a flock, fish stock or crop to begin recording." action={<Link className="underline" to="/app/farm/batches">Start one</Link>} />
              ) : (
                <DataTable<FarmBatch>
                  rows={active} total={active.length} page={0} pageSize={active.length} onPage={() => {}} rowKey={(b) => b.id} emptyTitle="Nothing running"
                  columns={[
                    { key: 'code', header: 'Batch', render: (b) => <><b>{b.code}</b><div className="text-xs text-ink/60">{b.species} · {farm.unitName(b.unitId)}</div></> },
                    { key: 'pop', header: 'Count now', align: 'right', render: (b) => <>{b.population.toLocaleString()} <CountBasis basis={b.basis} /></> },
                    { key: 'mort', header: 'Died', align: 'right', render: (b) => `${mortalityRate(b).toFixed(1)}%` },
                    { key: 'feed', header: 'Feed given', align: 'right', render: (b) => b.feed.toLocaleString() },
                    { key: 'since', header: 'Started', render: (b) => b.startDate },
                  ]}
                />
              )}
              <Card className="mt-6">
                <h2 className="mb-2 text-sm font-semibold">Latest notes</h2>
                {recent.length === 0 ? <p className="text-sm text-ink/60">No notes yet. Add one with Record today.</p> : (
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
