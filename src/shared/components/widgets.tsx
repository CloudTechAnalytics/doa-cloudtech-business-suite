import type { ComponentType } from 'react'
import type { ModuleDefinition } from '@/shared/types/domain'
import { isDemoMode } from '@/shared/utilities/env'
import { Card, EmptyState } from './index'
import { ModulePlaceholder } from './ModulePlaceholder'

export interface DemoKpi { label: string; value: string; note: string }
export interface DemoActivity { when: string; text: string }
export interface DemoDashboard { kpis: DemoKpi[]; activity: DemoActivity[] }

/**
 * Dashboard widget shown by industries until their modules record real data.
 * Figures appear only in demo mode and are illustrative; otherwise an honest empty state is shown.
 */
export function DemoKpiWidget({ data }: { data: DemoDashboard }) {
  if (!isDemoMode) return <EmptyState title="No data yet" description="Metrics appear here once transactions are recorded." />
  return (
    <>
      <p className="mb-3 text-sm text-ink/70">Demo figures for illustration only.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/60">{k.label}</p>
            <p className="tabular mt-2 text-2xl font-semibold">{k.value}</p>
            <p className="mt-1 text-xs text-ink/60">{k.note}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
        <ul className="divide-y divide-ink/10 text-sm">
          {data.activity.map((a) => (
            <li key={a.text} className="flex gap-4 py-2"><span className="w-20 shrink-0 text-ink/60">{a.when}</span>{a.text}</li>
          ))}
        </ul>
      </Card>
    </>
  )
}

export const demoWidget = (data: DemoDashboard): ComponentType => function Widget() { return <DemoKpiWidget data={data} /> }

/** Page component for a module whose screens are not built yet. */
export const placeholderPage = (module: ModuleDefinition): ComponentType => function Page() { return <ModulePlaceholder module={module} /> }
