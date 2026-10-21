import { getIndustry } from '@/core/industry-registry'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Card, EmptyState, PageHeader } from '@/shared/components'

/** Dashboard shell: the industry decides which widgets appear. */
export function DashboardPage() {
  const { active } = useBusiness()
  if (!active) return null
  const widgets = getIndustry(active.industry).dashboardWidgets
  return (
    <>
      <PageHeader title={active.name} description="Key figures for this business." />
      {widgets.length === 0 ? (
        <EmptyState title="No widgets yet" description="This industry has no dashboard widgets configured." />
      ) : (
        <div className="space-y-6">
          {widgets.map((w) => (
            <section key={w.id} aria-label={w.title}>
              <h2 className="mb-2 text-sm font-semibold text-navy/80">{w.title}</h2>
              <Card className="border-0 p-0 shadow-none"><w.component /></Card>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
