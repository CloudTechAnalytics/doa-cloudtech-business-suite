import { ErrorState, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { crmReport } from './dealsApi'
import type { CrmReport } from './dealsApi'

const PALETTE = ['#1c7ed6', '#7048e8', '#e8590c', '#f08c00', '#0ca678', '#d6336c', '#5c940d', '#4263eb']
const Tile = ({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: 'warn' }) => (
  <div className="rounded-lg border border-line bg-white p-3"><p className="text-xs uppercase tracking-wide text-ink/60">{title}</p><p className={`mt-0.5 text-xl font-bold ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</p>{hint && <p className="text-xs text-ink/60">{hint}</p>}</div>
)
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-line bg-white p-3"><h3 className="text-sm font-semibold">{title}</h3>{hint && <p className="mb-2 text-xs text-ink/60">{hint}</p>}<div className={hint ? '' : 'mt-2'}>{children}</div></section>
)

/** "2026-11" as "Nov 2026"; deals with no expected date are grouped as "No close date". */
export const monthLabel = (m: string) => (m === 'none' ? 'No close date' : new Date(`${m}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }))
/** Share of closed deals that were won, as a whole percentage; null when none closed. */
export const sourceWinRate = (s: { deals: number; won: number }) => (s.deals ? Math.round((s.won / s.deals) * 100) : null)

/**
 * The questions a sales manager asks: what is in the pipeline and what is likely to close, where deals are stuck or lost, who is carrying what, which lead sources actually
 * turn into sales, and what needs doing. Everything comes from the same deals, leads and activities as the rest of the CRM.
 */
export function CrmReports({ businessId }: { businessId: string }) {
  const r = useAsync(() => crmReport(businessId), [businessId])
  if (r.loading && !r.data) return <Spinner />
  if (r.error || !r.data) return <ErrorState message={r.error ?? 'Could not load the report.'} />
  return <Body d={r.data} />
}

export function Body({ d }: { d: CrmReport }) {
  const max = Math.max(1, ...d.stages.map((s) => s.deals))
  const maxForecast = Math.max(1, ...d.forecast.map((f) => f.value))
  const leads = Object.entries(d.leads)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Open pipeline" value={naira(d.openValue)} hint={`${d.openDeals} open ${d.openDeals === 1 ? 'deal' : 'deals'}`} />
        <Tile title="Likely to close" value={naira(d.weightedValue)} hint="Value times each stage's chance of winning" />
        <Tile title="Won this month" value={naira(d.wonThisMonth)} hint={`${d.wonDealsThisMonth} ${d.wonDealsThisMonth === 1 ? 'deal' : 'deals'}`} />
        <Tile title="Win rate" value={d.winRate === null ? '–' : `${d.winRate}%`} hint={!d.avgCycleDays ? 'Won of all closed deals' : `Won of closed deals · ${d.avgCycleDays} days to win`} />
        <Tile title="Overdue" value={String(d.overdueTasks)} hint={`${d.dueToday} due today`} tone={d.overdueTasks ? 'warn' : undefined} />
        <Tile title="Gone quiet" value={String(d.staleDeals)} hint="Open deals with no activity for 14+ days" tone={d.staleDeals ? 'warn' : undefined} />
        <Tile title="Activities done" value={String(d.activitiesDone30d)} hint="Calls, meetings and tasks, last 30 days" />
        <Tile title="Leads" value={String(Object.values(d.leads).reduce((a, b) => a + b, 0))} hint={leads.map(([k, v]) => `${v} ${label(k).toLowerCase()}`).join(' · ') || 'None yet'} />
      </div>

      <Section title="Pipeline funnel" hint="Deals at each stage, with their value. The percentage is the chance of winning at that stage.">
        <ul className="space-y-2">
          {d.stages.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm max-sm:grid-cols-[6rem_1fr]">
              <span className="truncate">{s.stage}{s.kind === 'open' ? <span className="text-ink/50"> · {s.probability}%</span> : null}</span>
              <span className="h-3 overflow-hidden rounded-full bg-ink/10" aria-hidden><span className="block h-full rounded-full" style={{ width: `${(s.deals / max) * 100}%`, background: s.kind === 'won' ? '#2f9e44' : s.kind === 'lost' ? '#868e96' : PALETTE[i % PALETTE.length] }} /></span>
              <span className="text-xs text-ink/70 max-sm:col-span-2">{s.deals} · {naira(s.value)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Forecast by month" hint="Open deals by expected close date. The darker part is what is likely to close.">
          {d.forecast.length === 0 ? <p className="text-sm text-ink/60">No open deals.</p> : (
            <ul className="space-y-2">{d.forecast.map((f) => (
              <li key={f.month} className="text-sm"><div className="flex justify-between gap-2"><span>{monthLabel(f.month)}</span><span className="text-xs text-ink/70">{f.deals} · {naira(f.weighted)} of {naira(f.value)}</span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-ink/10" aria-hidden><div className="h-full rounded-full bg-accent/40" style={{ width: `${(f.value / maxForecast) * 100}%` }}><div className="h-full rounded-full bg-accent" style={{ width: `${f.value ? (f.weighted / f.value) * 100 : 0}%` }} /></div></div></li>
            ))}</ul>
          )}
        </Section>
        <Section title="By owner" hint="Who is carrying what.">
          {d.byOwner.length === 0 ? <p className="text-sm text-ink/60">No deals yet.</p> : (
            <table data-keep-table className="w-full text-sm"><thead className="text-left text-xs text-ink/60"><tr><th className="py-1">Owner</th><th className="py-1 text-right">Open</th><th className="py-1 text-right">Open value</th><th className="py-1 text-right">Won this month</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{d.byOwner.map((o) => <tr key={o.owner}><td className="py-1.5">{o.owner}</td><td className="tabular py-1.5 text-right">{o.openDeals}</td><td className="tabular py-1.5 text-right">{naira(o.openValue)}</td><td className="tabular py-1.5 text-right">{naira(o.wonThisMonth)}</td></tr>)}</tbody></table>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Which lead sources turn into sales" hint="From leads that became deals.">
          {d.bySource.length === 0 ? <p className="text-sm text-ink/60">No leads yet.</p> : (
            <table data-keep-table className="w-full text-sm"><thead className="text-left text-xs text-ink/60"><tr><th className="py-1">Source</th><th className="py-1 text-right">Leads</th><th className="py-1 text-right">Deals</th><th className="py-1 text-right">Won</th><th className="py-1 text-right">Won value</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{d.bySource.map((s) => <tr key={s.source}><td className="py-1.5">{s.source}</td><td className="tabular py-1.5 text-right">{s.leads}</td><td className="tabular py-1.5 text-right">{s.deals}</td><td className="tabular py-1.5 text-right">{s.won}{sourceWinRate(s) !== null ? <span className="text-ink/50"> ({sourceWinRate(s)}%)</span> : null}</td><td className="tabular py-1.5 text-right">{naira(s.wonValue)}</td></tr>)}</tbody></table>
          )}
        </Section>
        <Section title="Why deals are lost">
          {d.lostReasons.length === 0 ? <p className="text-sm text-ink/60">No lost deals.</p> : <ul className="space-y-1 text-sm">{d.lostReasons.map((l) => <li key={l.reason} className="flex justify-between gap-2"><span>{l.reason}</span><b>{l.deals}</b></li>)}</ul>}
        </Section>
      </div>
    </div>
  )
}
