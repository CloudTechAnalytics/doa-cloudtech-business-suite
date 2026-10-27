import { Link } from 'react-router-dom'
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { naira } from '@/shared/utilities/format'
import { AdoptionCard } from './PlatformApps'
import { loadHealth, loadOverview } from './platformApi'
import { Kpi, StateBadge, daysFrom, day, industryName } from './platformUi'

export function PlatformDashboard() {
  const o = useAsync(loadOverview, [])
  const h = useAsync(loadHealth, [])
  if (o.loading && !o.data) return <Spinner />
  if (o.error || !o.data) return <ErrorState message={o.error ?? 'Could not load the overview'} />
  const x = o.data
  const max = Math.max(...x.byIndustry.map((i) => i.businesses), 1)
  const bad = (h.data?.checks ?? []).filter((c) => !c.ok)
  return (
    <>
      <PageHeader title="Platform console" description="Every business on DOA, who owns it, what plan it is on, and how the system is doing." actions={<Link to="/platform/businesses" className="inline-flex h-10 items-center rounded-md bg-amber px-4 text-sm font-bold shadow-card transition hover:bg-amber-dark">All businesses</Link>} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Businesses" value={String(x.businesses)} note={`${x.newThisMonth} new this month`} to="/platform/businesses" />
        <Kpi title="Paying" value={String(x.paid)} note="On a paid plan" to="/platform/subscriptions" tone="good" />
        <Kpi title="On trial" value={String(x.trial)} note={x.trialsEnding.length ? `${x.trialsEnding.length} end within 7 days` : 'None ending soon'} to="/platform/subscriptions" />
        <Kpi title="Suspended" value={String(x.suspended)} note="Paused businesses" tone={x.suspended ? 'bad' : undefined} to="/platform/businesses" />
        <Kpi title="MRR" value={naira(x.mrr).replace(/\.00$/, '')} note="Monthly recurring" />
        <Kpi title="ARR" value={naira(x.mrr * 12).replace(/\.00$/, '')} note="MRR times 12" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Total users" value={String(x.users)} to="/platform/users" />
        <Kpi title="Platform team" value={String(x.platformTeam)} to="/platform/team" />
        <Kpi title="Signed in today" value={x.activeToday === null ? '–' : String(x.activeToday)} note={x.activeToday === null ? 'Not tracked in demo mode' : 'Last 24 hours'} />
        <Kpi title="Past due" value={String(x.pastDue)} note="Subscriptions" tone={x.pastDue ? 'warn' : undefined} to="/platform/subscriptions" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Newest businesses</h2><Link to="/platform/businesses" className="text-sm font-semibold underline">Manage all</Link></div>
          {x.recent.length ? <ul className="divide-y divide-ink/10 text-sm">{x.recent.map((b) => <li key={b.id}><Link to={`/platform/businesses/${b.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-surface"><span className="min-w-0"><span className="block truncate font-medium">{b.name}</span><span className="text-xs text-ink/60">{industryName(b.industry)} · joined {day(b.createdAt)}</span></span><StateBadge status={b.status} /></Link></li>)}</ul> : <EmptyState title="No businesses yet" />}
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold">By kind of business</h2>
            {x.byIndustry.length ? <ul className="space-y-2 text-sm">{x.byIndustry.map((i) => <li key={i.industry} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2"><span className="truncate">{industryName(i.industry)}</span><span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-amber" style={{ width: `${(i.businesses / max) * 100}%` }} /></span><span className="tabular text-right">{i.businesses}</span></li>)}</ul> : <p className="text-sm text-ink/60">Nothing yet.</p>}
          </Card>
          <Card>
            <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">System health</h2><Link to="/platform/health" className="text-sm font-semibold underline">Details</Link></div>
            {h.loading ? <Spinner /> : bad.length ? <ul className="space-y-1 text-sm">{bad.map((c) => <li key={c.name} className="text-warning">{c.name}: {c.detail}</li>)}</ul> : <p className="text-sm font-medium text-success">All checks passing</p>}
          </Card>
        </div>
      </div>

      <div className="mt-4"><AdoptionCard /></div>

      {x.trialsEnding.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-semibold">Trials ending within 7 days</h2>
          <ul className="divide-y divide-ink/10 text-sm">{x.trialsEnding.map((t) => { const d = daysFrom(t.trialEnd); return <li key={t.id}><Link to={`/platform/businesses/${t.id}`} className="flex justify-between py-2 hover:bg-surface"><span className="font-medium">{t.name}</span><span className={d !== null && d < 0 ? 'text-danger' : 'text-ink/70'}>{d === null ? '' : d < 0 ? `ended ${-d} day(s) ago` : d === 0 ? 'ends today' : `${d} day(s) left`} · {day(t.trialEnd)}</span></Link></li> })}</ul>
        </Card>
      )}
    </>
  )
}
