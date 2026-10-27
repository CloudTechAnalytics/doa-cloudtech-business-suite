import { ErrorState, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { crmReport } from './dealsApi'

const STAGE_COLOR: Record<string, string> = { new: '#1c7ed6', qualified: '#7048e8', proposal: '#e8590c', negotiation: '#f08c00', won: '#2f9e44', lost: '#868e96' }
const Tile = ({ title, value, hint }: { title: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-line bg-white p-3"><p className="text-xs uppercase tracking-wide text-ink/60">{title}</p><p className="mt-0.5 text-xl font-bold">{value}</p>{hint && <p className="text-xs text-ink/60">{hint}</p>}</div>
)

/** Where the money is: open pipeline, what was won this month, the win rate, the deals at each stage, why deals are lost, and what needs doing today. */
export function CrmReports({ businessId }: { businessId: string }) {
  const r = useAsync(() => crmReport(businessId), [businessId])
  if (r.loading && !r.data) return <Spinner />
  if (r.error || !r.data) return <ErrorState message={r.error ?? 'Could not load the report.'} />
  const d = r.data
  const max = Math.max(1, ...d.stages.map((s) => s.value))
  const leads = Object.entries(d.leads)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Open pipeline" value={naira(d.openValue)} hint={`${d.openDeals} open ${d.openDeals === 1 ? 'deal' : 'deals'}`} />
        <Tile title="Won this month" value={naira(d.wonThisMonth)} hint={`${d.wonDealsThisMonth} ${d.wonDealsThisMonth === 1 ? 'deal' : 'deals'}`} />
        <Tile title="Win rate" value={d.winRate === null ? '–' : `${d.winRate}%`} hint="Won of all closed deals" />
        <Tile title="Follow-ups" value={`${d.overdueTasks} overdue`} hint={`${d.dueToday} due today`} />
      </div>
      <section className="rounded-lg border border-line bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold">Deals by stage</h3>
        <ul className="space-y-2">
          {d.stages.map((s) => (
            <li key={s.stage} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm max-sm:grid-cols-[5.5rem_1fr]">
              <span>{label(s.stage)}</span>
              <span className="h-3 overflow-hidden rounded-full bg-ink/10" aria-hidden><span className="block h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: STAGE_COLOR[s.stage] }} /></span>
              <span className="text-xs text-ink/70 max-sm:col-span-2">{s.deals} · {naira(s.value)}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-3"><h3 className="mb-2 text-sm font-semibold">Why deals are lost</h3>
          {d.lostReasons.length === 0 ? <p className="text-sm text-ink/60">No lost deals.</p> : <ul className="space-y-1 text-sm">{d.lostReasons.map((l) => <li key={l.reason} className="flex justify-between gap-2"><span>{l.reason}</span><b>{l.deals}</b></li>)}</ul>}</section>
        <section className="rounded-lg border border-line bg-white p-3"><h3 className="mb-2 text-sm font-semibold">Leads</h3>
          {leads.length === 0 ? <p className="text-sm text-ink/60">No leads.</p> : <ul className="space-y-1 text-sm">{leads.map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{label(k)}</span><b>{v}</b></li>)}</ul>}</section>
      </div>
    </div>
  )
}
