import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira } from '@/shared/utilities/format'
import type { PlanCode } from '@/shared/types/domain'
import { loadBusinesses, loadOverview, loadPlans, setSubscription } from './platformApi'
import type { PBusinessRow, SubStatus } from './platformApi'
import { SUB_LABEL, StateBadge, day, daysFrom, usePlatform } from './platformUi'
import { Kpi } from './platformUi'

type Chip = 'all' | PlanCode | 'trialing' | 'expired_trials' | 'canceled' | 'past_due'
const money = (n: number) => naira(n).replace(/\.00$/, '')
const STATUSES = Object.keys(SUB_LABEL) as SubStatus[]

/** Plans and subscription status for every business. Changing either asks for a reason first, because it changes what the business can use and pay. */
export function PlatformSubscriptions() {
  const { canWrite } = usePlatform()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? ''); const [chip, setChip] = useState<Chip>('all')
  const list = useAsync(() => loadBusinesses(q), [q])
  const plans = useAsync(loadPlans, [])
  const overview = useAsync(loadOverview, [])
  const [change, setChange] = useState<{ b: PBusinessRow; plan?: PlanCode; status?: SubStatus } | null>(null)

  const planList = plans.data ?? []
  const price = (code: string | null) => planList.find((p) => p.code === code)?.price ?? 0
  const limit = (code: string | null) => planList.find((p) => p.code === code)?.maxMembers ?? null
  const expiredTrial = (b: PBusinessRow) => b.subscriptionStatus === 'trialing' && (daysFrom(b.trialEnd) ?? 1) < 0
  const rows = (list.data ?? []).filter((b) => b.status !== 'archived').filter((b) => {
    if (chip === 'all') return true
    if (chip === 'trialing') return b.subscriptionStatus === 'trialing'
    if (chip === 'expired_trials') return expiredTrial(b)
    if (chip === 'canceled' || chip === 'past_due') return b.subscriptionStatus === chip
    return b.planCode === chip
  })
  const o = overview.data
  const chips: [Chip, string][] = [['all', 'All'], ...planList.map((p): [Chip, string] => [p.code as PlanCode, p.name]), ['trialing', 'Trial'], ['expired_trials', 'Expired trials'], ['canceled', 'Cancelled'], ['past_due', 'Past due']]

  return (
    <>
      <PageHeader title="Subscriptions" description="Assign plans to businesses and see who is paying. Revenue is counted from paid subscriptions only." />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="MRR" value={o ? money(o.mrr) : '–'} note="Monthly recurring revenue" />
        <Kpi title="ARR" value={o ? money(o.mrr * 12) : '–'} note="Annualised" />
        <Kpi title="Businesses" value={o ? String(o.paid + o.trial + o.pastDue) : '–'} note="Paying + trial" />
        <Kpi title="Trials" value={o ? String(o.trial) : '–'} note="Not yet paying, excluded from MRR" />
      </div>

      <div className="my-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter subscriptions">
        {chips.map(([id, text]) => <button key={id} type="button" aria-pressed={chip === id} onClick={() => setChip(id)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${chip === id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/80 hover:bg-surface'}`}>{text}</button>)}
        <div className="ml-auto w-64"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business or owner" /></div>
      </div>
      {(list.error || plans.error) && <ErrorState message={(list.error ?? plans.error)!} />}
      {list.loading && !list.data ? <Spinner /> : !rows.length ? <Card><EmptyState title="No subscriptions match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Business</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Seats</th><th className="p-3">Ends</th><th className="p-3">Business</th><th className="p-3 text-right">Monthly</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((b) => { const end = b.subscriptionStatus === 'trialing' ? b.trialEnd : b.periodEnd; const d = daysFrom(end); const lim = limit(b.planCode)
                return (
                  <tr key={b.id}>
                    <td className="p-3 font-medium"><Link to={`/platform/businesses/${b.id}`} className="hover:underline">{b.name}</Link><div className="text-xs font-normal text-ink/60">{b.ownerEmail}</div></td>
                    <td className="p-3"><select aria-label={`Plan for ${b.name}`} disabled={!canWrite || !b.planCode} value={b.planCode ?? ''} onChange={(e) => setChange({ b, plan: e.target.value as PlanCode })} className="h-9 rounded-md border border-line bg-white px-2 text-sm disabled:opacity-60">{planList.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.price ? money(p.price) : 'free'})</option>)}</select></td>
                    <td className="p-3"><select aria-label={`Status for ${b.name}`} disabled={!canWrite || !b.subscriptionStatus} value={b.subscriptionStatus ?? ''} onChange={(e) => setChange({ b, status: e.target.value as SubStatus })} className="h-9 rounded-md border border-line bg-white px-2 text-sm disabled:opacity-60">{STATUSES.map((s) => <option key={s} value={s}>{SUB_LABEL[s]}</option>)}</select></td>
                    <td className="tabular p-3">{b.members}{lim ? ` of ${lim}` : ''}{lim && b.members > lim && <span className="ml-1 text-xs text-warning">over</span>}</td>
                    <td className="p-3">{day(end)}{d !== null && b.subscriptionStatus !== 'canceled' && <div className={`text-xs ${d < 0 ? 'text-danger' : 'text-ink/60'}`}>{d < 0 ? `${-d} day(s) ago` : `${d} day(s) left`}</div>}</td>
                    <td className="p-3"><StateBadge status={b.status} /></td>
                    <td className="tabular p-3 text-right">{b.subscriptionStatus === 'active' ? money(price(b.planCode)) : <span className="text-ink/50">{b.planCode && price(b.planCode) ? `${money(price(b.planCode))} (not paying)` : '–'}</span>}</td>
                  </tr>
                ) })}
            </tbody>
          </table>
        </Card>
      )}
      {change && <ChangeDialog change={change} onClose={() => setChange(null)} onDone={async () => { setChange(null); await Promise.all([list.refresh(), overview.refresh(), plans.refresh()]) }} />}
    </>
  )
}

function ChangeDialog({ change, onClose, onDone }: { change: { b: PBusinessRow; plan?: PlanCode; status?: SubStatus }; onClose: () => void; onDone: () => Promise<void> }) {
  const { b, plan, status } = change
  const runner = useFormRunner(onDone)
  const [why, setWhy] = useState('')
  const what = plan ? `Move ${b.name} from ${b.planName ?? 'no plan'} to the ${plan} plan.` : `Change the subscription of ${b.name} from ${SUB_LABEL[b.subscriptionStatus ?? 'active']} to ${SUB_LABEL[status!]}.`
  return (
    <Dialog title={plan ? 'Change plan' : 'Change subscription status'} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">{what}</p>
        {status === 'active' && <Notice>Use this when payment has been received outside the app. It starts a paid month if the period had run out.</Notice>}
        {status === 'canceled' && <Notice>The business keeps its records but is no longer on a live subscription.</Notice>}
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus placeholder="For example: paid by transfer, ref 1234" />
        {runner.error && <ErrorState title="Not done" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={why.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => setSubscription(b.id, { plan: plan ?? null, status: status ?? null, extendDays: null, reason: why }), 'Done.')}>Save</Button></div>
      </div>
    </Dialog>
  )
}
