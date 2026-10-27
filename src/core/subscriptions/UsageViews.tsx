import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { USAGE_LABEL, loadUsage, usageLevel } from './usage'
import type { UsageKey } from './usage'

/**
 * Tells people about a limit before they hit it: nothing until 80% of a limit is used, then how much is left and where to upgrade. When the limit is
 * used up it says what that means (new ones cannot be added, everything existing is kept). Shows nothing on a plan with no limit.
 */
export function UsageNotice({ keys }: { keys: UsageKey[] }) {
  const { active } = useBusiness()
  const usage = useAsync(() => (active ? loadUsage(active.id) : Promise.resolve([])), [active?.id])
  const rows = (usage.data ?? []).filter((r) => keys.includes(r.key) && ['near', 'full'].includes(usageLevel(r)))
  if (!rows.length) return null
  return (
    <div className="mb-4 space-y-2">
      {rows.map((r) => {
        const full = usageLevel(r) === 'full'
        return (
          <div key={r.key} role="status" className={`rounded-lg border p-3 text-sm ${full ? 'border-danger/40 bg-danger-soft text-danger' : 'border-amber/50 bg-amber/10 text-ink'}`}>
            {full
              ? <>You have reached your plan&apos;s limit of {r.limit} {USAGE_LABEL[r.key].noun}, so no more can be added. Everything you already have is kept.</>
              : <>You have used {r.used} of {r.limit} {USAGE_LABEL[r.key].noun} on your plan.</>}{' '}
            <Link to="/app/settings" className="font-semibold underline">See plans and upgrade</Link>
          </div>
        )
      })}
    </div>
  )
}

/** Every limit of the plan with how much of it is used. A plan with none says so. */
export function UsagePanel() {
  const { active } = useBusiness()
  const usage = useAsync(() => (active ? loadUsage(active.id) : Promise.resolve([])), [active?.id])
  const rows = usage.data ?? []
  if (!active || (!usage.data && usage.loading)) return null
  return (
    <section className="rounded-xl border border-line bg-white p-4 shadow-card" aria-label="Plan usage">
      <h2 className="text-lg font-semibold">Plan usage</h2>
      {rows.every((r) => r.limit === null)
        ? <p className="mt-1 text-sm text-ink/70">Your plan has no limits on customers, invoices, sales or expenses.</p>
        : <>
          <p className="mt-1 text-sm text-ink/70">Limits only stop new records. Everything you have stays available, and moving to a bigger plan lifts the limit.</p>
          <ul className="mt-3 space-y-3">
            {rows.map((r) => {
              const level = usageLevel(r); const pct = r.limit ? Math.min(100, Math.round((r.used / r.limit) * 100)) : 0
              return (
                <li key={r.key}>
                  <div className="flex justify-between text-sm"><span>{USAGE_LABEL[r.key].name}</span><span className="tabular text-ink/70">{r.limit === null ? `${r.used} · no limit` : `${r.used} of ${r.limit}`}</span></div>
                  {r.limit !== null && <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden><div className={`h-full rounded-full ${level === 'full' ? 'bg-danger' : level === 'near' ? 'bg-amber' : 'bg-success'}`} style={{ width: `${pct}%` }} /></div>}
                </li>
              )
            })}
          </ul>
          <Link to="/app/settings" className="mt-3 inline-block text-sm font-semibold underline">See plans and upgrade</Link>
        </>}
    </section>
  )
}
