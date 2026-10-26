import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { PLANS, PLAN_PRICES } from '@/core/subscriptions/plans'
import { label, naira } from '@/shared/utilities/format'
import type { PlanCode } from '@/shared/types/domain'
import { loadBusiness, loadBusinesses, setBusinessStatus, setSubscription } from './platformApi'
import type { PBusinessDetail, SubStatus } from './platformApi'
import { StateBadge, SUB_LABEL, SubBadge, day, daysFrom, industryName, usePlatform, when } from './platformUi'

/** A table of businesses: used by the Businesses page (everything) and Subscriptions (the money view). */
export function BusinessTable({ mode }: { mode: 'businesses' | 'subscriptions' }) {
  const [q, setQ] = useState(''); const [state, setState] = useState(''); const [sub, setSub] = useState(''); const [industry, setIndustry] = useState('')
  const list = useAsync(() => loadBusinesses(q), [q])
  const navigate = useNavigate()
  const rows = (list.data ?? []).filter((b) => (!state || b.status === state) && (!sub || b.subscriptionStatus === sub) && (!industry || b.industry === industry))
  const industries = [...new Set((list.data ?? []).map((b) => b.industry))]
  return (
    <>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="w-72"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business, owner name or email" /></div>
        <div className="w-40"><SelectField label="Kind" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">All kinds</option>{industries.map((i) => <option key={i} value={i}>{industryName(i)}</option>)}</SelectField></div>
        <div className="w-40"><SelectField label="Subscription" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">All</option>{(Object.keys(SUB_LABEL) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_LABEL[s]}</option>)}</SelectField></div>
        <div className="w-40"><SelectField label="Business" value={state} onChange={(e) => setState(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option></SelectField></div>
        <p className="pb-2 text-sm text-ink/60">{rows.length} shown</p>
      </div>
      {list.error && <ErrorState message={list.error} />}
      {list.loading && !list.data ? <Spinner /> : !rows.length ? <Card><EmptyState title="No businesses match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Business</th><th className="p-3">Owner</th><th className="p-3">Kind</th><th className="p-3">Plan</th><th className="p-3">Subscription</th>{mode === 'subscriptions' ? <th className="p-3">Ends</th> : <th className="p-3 text-right">People</th>}<th className="p-3">{mode === 'subscriptions' ? 'Business' : 'Joined'}</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((b) => { const end = b.subscriptionStatus === 'trialing' ? b.trialEnd : b.periodEnd; const d = daysFrom(end)
                return (
                  <tr key={b.id} onClick={() => navigate(`/platform/businesses/${b.id}`)} className="cursor-pointer hover:bg-surface">
                    <td className="p-3 font-medium"><Link to={`/platform/businesses/${b.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{b.name}</Link></td>
                    <td className="p-3">{b.ownerName ?? '–'}<div className="text-xs text-ink/60">{b.ownerEmail}</div></td>
                    <td className="p-3">{industryName(b.industry)}</td><td className="p-3">{b.planName ?? '–'}</td><td className="p-3"><SubBadge status={b.subscriptionStatus} /></td>
                    {mode === 'subscriptions' ? <td className="p-3">{day(end)}{d !== null && b.subscriptionStatus !== 'canceled' && <div className={`text-xs ${d < 0 ? 'text-danger' : 'text-ink/60'}`}>{d < 0 ? `${-d} day(s) ago` : `${d} day(s) left`}</div>}</td> : <td className="tabular p-3 text-right">{b.members}</td>}
                    <td className="p-3">{mode === 'subscriptions' ? <StateBadge status={b.status} /> : day(b.createdAt)}</td>
                  </tr>
                ) })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

export function PlatformBusinesses() { return <><PageHeader title="Businesses" description="Every business registered on DOA, with its owner and plan. Open one to see its people and manage its subscription." /><BusinessTable mode="businesses" /></> }
export function PlatformSubscriptions() { return <><PageHeader title="Subscriptions" description="Who is paying, who is on trial and when it ends. Open a business to change its plan or extend a trial." /><BusinessTable mode="subscriptions" /></> }

type Action = null | 'plan' | 'extend' | 'suspend' | 'reactivate' | 'paid' | 'cancel'

/** One business: who is in it, what it pays, and the changes an engineer can make (each needs a reason and is logged). */
export function PlatformBusinessPage() {
  const { id = '' } = useParams()
  const { canWrite } = usePlatform()
  const d = useAsync(() => loadBusiness(id), [id])
  const [action, setAction] = useState<Action>(null)
  if (d.loading && !d.data) return <Spinner />
  if (d.error || !d.data) return <div className="space-y-3"><ErrorState message={d.error ?? 'Business not found'} /><Link to="/platform/businesses" className="underline">Back to businesses</Link></div>
  const b = d.data; const sub = b.subscription; const left = daysFrom(sub?.status === 'trialing' ? sub.trialEnd : sub?.periodEnd)
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/platform/businesses" className="text-ink/60 hover:text-ink">Businesses</Link> <span className="text-ink/40">/</span> {b.name}</p>
      <PageHeader title={b.name} description={`${industryName(b.industry)} · joined ${day(b.createdAt)} · ${b.country} · ${b.currency}`} actions={<StateBadge status={b.status} />} />
      {b.status === 'suspended' && <div className="mt-3"><Notice>This business is suspended. Nobody in it can sign in to it until it is reactivated. Nothing has been deleted.</Notice></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 font-semibold">Owner</h2>
          {b.owner ? <p className="text-sm"><span className="font-medium">{b.owner.name || '–'}</span><br /><span className="text-ink/70">{b.owner.email}</span></p> : <p className="text-sm text-ink/60">No owner recorded.</p>}
        </Card>
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Subscription</h2><SubBadge status={sub?.status ?? null} /></div>
          {sub ? <p className="text-sm">{sub.planName} plan, {sub.price ? `${naira(sub.price).replace(/\.00$/, '')} a month` : 'free'}. {sub.status === 'trialing' ? 'Trial ends' : 'Current period ends'} <b>{day(sub.status === 'trialing' ? sub.trialEnd : sub.periodEnd)}</b>{left !== null && <span className={left < 0 ? 'text-danger' : 'text-ink/60'}> ({left < 0 ? `${-left} day(s) ago` : `${left} day(s) left`})</span>}.</p> : <p className="text-sm text-ink/60">No subscription.</p>}
          {canWrite && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setAction('plan')}>Change plan</Button>
              {sub?.status === 'trialing' && <Button variant="secondary" onClick={() => setAction('extend')}>Extend trial</Button>}
              {sub?.status !== 'active' && <Button variant="secondary" onClick={() => setAction('paid')}>Mark as paid</Button>}
              {sub?.status === 'active' && <Button variant="secondary" onClick={() => setAction('extend')}>Extend period</Button>}
              {sub && sub.status !== 'canceled' && <Button variant="secondary" onClick={() => setAction('cancel')}>Cancel subscription</Button>}
              {b.status === 'active' ? <Button variant="secondary" onClick={() => setAction('suspend')}>Suspend business</Button> : b.status === 'suspended' ? <Button onClick={() => setAction('reactivate')}>Reactivate business</Button> : null}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="p-4 pb-2 font-semibold">People ({b.members.length})</h2>
        <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{b.members.map((m, i) => <tr key={i}><td className="p-3 font-medium">{m.name || '–'}</td><td className="p-3">{m.email}</td><td className="p-3">{label(m.role)}</td><td className="p-3"><Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'info' : 'neutral'}>{label(m.status)}</Badge></td></tr>)}</tbody></table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Changes made from this console</h2>
          {b.platformActions.length ? <ul className="divide-y divide-ink/10 text-sm">{b.platformActions.map((a, i) => <li key={i} className="py-2"><b>{label(a.action.replace('.', ' '))}</b> <span className="text-ink/60">by {a.by ?? 'unknown'} · {when(a.at)}</span>{a.reason && <div className="text-ink/80">&ldquo;{a.reason}&rdquo;</div>}</li>)}</ul> : <p className="text-sm text-ink/60">None yet.</p>}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Apps switched on ({b.modules.length})</h2>
          {b.modules.length ? <p className="flex flex-wrap gap-1.5 text-xs">{b.modules.map((m) => <Badge key={m}>{m}</Badge>)}</p> : <p className="text-sm text-ink/60">None.</p>}
          {b.activity.length > 0 && <><h2 className="mb-2 mt-4 font-semibold">Recent activity inside the business</h2><ul className="divide-y divide-ink/10 text-sm">{b.activity.slice(0, 8).map((a, i) => <li key={i} className="flex justify-between py-1.5"><span>{a.action}</span><span className="text-xs text-ink/60">{when(a.at)}</span></li>)}</ul></>}
        </Card>
      </div>

      {action && <ActionDialog b={b} action={action} onClose={() => setAction(null)} onDone={async () => { setAction(null); await d.refresh() }} />}
    </>
  )
}

const TITLES: Record<Exclude<Action, null>, string> = { plan: 'Change plan', extend: 'Extend', suspend: 'Suspend business', reactivate: 'Reactivate business', paid: 'Mark as paid', cancel: 'Cancel subscription' }

function ActionDialog({ b, action, onClose, onDone }: { b: PBusinessDetail; action: Exclude<Action, null>; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const [plan, setPlan] = useState<PlanCode>((b.subscription?.planCode as PlanCode) ?? 'starter'); const [days, setDays] = useState('14'); const [why, setWhy] = useState('')
  const confirm = () => {
    if (action === 'plan') return setSubscription(b.id, { plan, status: null, extendDays: null, reason: why })
    if (action === 'extend') return setSubscription(b.id, { plan: null, status: null, extendDays: Number(days), reason: why })
    if (action === 'paid') return setSubscription(b.id, { plan, status: 'active', extendDays: null, reason: why })
    if (action === 'cancel') return setSubscription(b.id, { plan: null, status: 'canceled', extendDays: null, reason: why })
    return setBusinessStatus(b.id, action === 'suspend' ? 'suspended' : 'active', why)
  }
  return (
    <Dialog title={`${TITLES[action]}: ${b.name}`} onClose={onClose}>
      <div className="space-y-3">
        {(action === 'plan' || action === 'paid') && <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>{(Object.keys(PLANS) as PlanCode[]).map((p) => <option key={p} value={p}>{PLANS[p].name} ({PLAN_PRICES[p] ? `${naira(PLAN_PRICES[p]).replace(/\.00$/, '')} / month` : 'free'}, {PLANS[p].limits.maxMembers} people)</option>)}</SelectField>}
        {action === 'extend' && <TextField label="Extend by (days)" type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />}
        {action === 'suspend' && <Notice>Nobody in this business will be able to use it until you reactivate it. Their records are kept.</Notice>}
        {action === 'paid' && <Notice>Use this when payment has been received outside the app. It starts a paid month if the period had run out.</Notice>}
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus placeholder="For example: paid by transfer, ref 1234" />
        {runner.error && <ErrorState title="Not done" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={why.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => confirm(), 'Done.')}>{TITLES[action]}</Button></div>
      </div>
    </Dialog>
  )
}
