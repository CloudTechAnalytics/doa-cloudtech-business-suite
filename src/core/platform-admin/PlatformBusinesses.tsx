import { CreditCard, Eye, MoreHorizontal, Pencil, ScrollText, ShieldOff, Trash2, ArrowRightLeft, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { Menu } from '@/shared/components/menu'
import type { MenuItem } from '@/shared/components/menu'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { PLANS, PLAN_PRICES } from '@/core/subscriptions/plans'
import { label, naira } from '@/shared/utilities/format'
import type { PlanCode } from '@/shared/types/domain'
import { archiveBusiness, loadBusiness, loadBusinesses, purgeBusiness, setBusinessStatus, setSubscription, transferOwnership, updateBusiness } from './platformApi'
import type { BusinessState, SubStatus } from './platformApi'
import { StateBadge, SUB_LABEL, SubBadge, day, daysFrom, industryName, usePlatform, when } from './platformUi'

export type Action = 'plan' | 'extend' | 'suspend' | 'reactivate' | 'paid' | 'cancel' | 'edit' | 'transfer' | 'delete' | 'purge'
/** What the action dialog needs to know about a business; the table and the detail page both supply it. */
export interface Target { id: string; name: string; planCode: string | null; status: BusinessState }

/** The "..." menu on a business: everything that can be done to it, limited to what this platform role may do. */
export function BusinessMenu({ b, onAction }: { b: Target; onAction: (a: Action) => void }) {
  const { canWrite, isOwner } = usePlatform()
  const archived = b.status === 'archived'
  const items: MenuItem[] = [
    { label: b.name, heading: true },
    { label: 'View', to: `/platform/businesses/${b.id}`, icon: <Eye className="size-4" /> },
    ...(canWrite && !archived ? [
      { label: 'Edit', icon: <Pencil className="size-4" />, onSelect: () => onAction('edit') },
      b.status === 'suspended' ? { label: 'Reactivate', icon: <ShieldCheck className="size-4" />, onSelect: () => onAction('reactivate') } : { label: 'Suspend', icon: <ShieldOff className="size-4" />, onSelect: () => onAction('suspend') },
    ] : []),
    ...(isOwner && !archived ? [{ label: 'Transfer ownership', icon: <ArrowRightLeft className="size-4" />, onSelect: () => onAction('transfer') }] : []),
    { label: 'View subscription', to: `/platform/subscriptions?q=${encodeURIComponent(b.name)}`, icon: <CreditCard className="size-4" />, divider: true },
    { label: 'Open audit log', to: `/platform/audit?business=${b.id}`, icon: <ScrollText className="size-4" /> },
    ...(isOwner && !archived ? [{ label: 'Delete business', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => onAction('delete'), divider: true }] : []),
    ...(isOwner ? [{ label: 'Delete permanently', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => onAction('purge'), divider: archived }] : []),
  ]
  return (
    <Menu
      label={`${b.name} actions`}
      trigger={({ toggle }) => <button type="button" onClick={(e) => { e.stopPropagation(); toggle() }} aria-haspopup="menu" aria-label={`Actions for ${b.name}`} className="grid size-8 place-items-center rounded-md text-ink/60 hover:bg-surface hover:text-ink"><MoreHorizontal className="size-5" aria-hidden /></button>}
      items={items}
    />
  )
}

/** A table of businesses with the actions menu on every row. */
export function BusinessTable() {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? ''); const [state, setState] = useState(''); const [sub, setSub] = useState(''); const [industry, setIndustry] = useState('')
  const list = useAsync(() => loadBusinesses(q), [q])
  const navigate = useNavigate()
  const [acting, setActing] = useState<{ b: Target; action: Action } | null>(null)
  const rows = (list.data ?? []).filter((b) => (!state || b.status === state) && (!sub || b.subscriptionStatus === sub) && (!industry || b.industry === industry))
  const industries = [...new Set((list.data ?? []).map((b) => b.industry))]
  return (
    <>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="w-72"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business, owner name or email" /></div>
        <div className="w-40"><SelectField label="Kind" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">All kinds</option>{industries.map((i) => <option key={i} value={i}>{industryName(i)}</option>)}</SelectField></div>
        <div className="w-40"><SelectField label="Subscription" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">All</option>{(Object.keys(SUB_LABEL) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_LABEL[s]}</option>)}</SelectField></div>
        <div className="w-40"><SelectField label="Business" value={state} onChange={(e) => setState(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Deleted</option></SelectField></div>
        <p className="pb-2 text-sm text-ink/60">{rows.length} shown</p>
      </div>
      {list.error && <ErrorState message={list.error} />}
      {list.loading && !list.data ? <Spinner /> : !rows.length ? <Card><EmptyState title="No businesses match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Business</th><th className="p-3">Owner</th><th className="p-3">Plan</th><th className="p-3">Subscription</th><th className="p-3 text-right">People</th><th className="p-3">Status</th><th className="p-3">Joined</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((b) => (
                <tr key={b.id} onClick={() => navigate(`/platform/businesses/${b.id}`)} className="cursor-pointer hover:bg-surface">
                  <td className="p-3 font-medium"><Link to={`/platform/businesses/${b.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{b.name}</Link><div className="text-xs font-normal text-ink/60">{industryName(b.industry)}</div></td>
                  <td className="p-3">{b.ownerName ?? '–'}<div className="text-xs text-ink/60">{b.ownerEmail}</div></td>
                  <td className="p-3">{b.planName ?? '–'}</td><td className="p-3"><SubBadge status={b.subscriptionStatus} /></td>
                  <td className="tabular p-3 text-right">{b.members}</td><td className="p-3"><StateBadge status={b.status} /></td><td className="p-3">{day(b.createdAt)}</td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}><BusinessMenu b={b} onAction={(action) => setActing({ b, action })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {acting && <ActionDialog b={acting.b} action={acting.action} onClose={() => setActing(null)} onDone={async () => { setActing(null); await list.refresh() }} />}
    </>
  )
}

export function PlatformBusinesses() { return <><PageHeader title="Businesses" description="Every business registered on DOA, with its owner and plan. Use the menu on a row, or open one for its people and subscription." /><BusinessTable /></> }

/** One business: who is in it, what it pays, and the changes the platform team can make (each needs a reason and is logged). */
export function PlatformBusinessPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { canWrite } = usePlatform()
  const d = useAsync(() => loadBusiness(id), [id])
  const [action, setAction] = useState<Action | null>(null)
  if (d.loading && !d.data) return <Spinner />
  if (d.error || !d.data) return <div className="space-y-3"><ErrorState message={d.error ?? 'Business not found'} /><Link to="/platform/businesses" className="underline">Back to businesses</Link></div>
  const b = d.data; const sub = b.subscription; const left = daysFrom(sub?.status === 'trialing' ? sub.trialEnd : sub?.periodEnd)
  const target: Target = { id: b.id, name: b.name, planCode: sub?.planCode ?? null, status: b.status }
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/platform/businesses" className="text-ink/60 hover:text-ink">Businesses</Link> <span className="text-ink/40">/</span> {b.name}</p>
      <PageHeader title={b.name} description={`${industryName(b.industry)} · joined ${day(b.createdAt)} · ${b.country} · ${b.currency} · ${b.timezone}${b.legalName ? ` · ${b.legalName}` : ''}`} actions={<div className="flex items-center gap-2"><StateBadge status={b.status} /><BusinessMenu b={target} onAction={setAction} /></div>} />
      {b.status === 'suspended' && <div className="mt-3"><Notice>This business is suspended. Nobody in it can sign in to it until it is reactivated. Nothing has been deleted.</Notice></div>}
      {b.status === 'archived' && <div className="mt-3"><Notice>This business was deleted by its owner or the platform team. Its records are kept but nobody can open it.</Notice></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 font-semibold">Owner</h2>
          {b.owner ? <p className="text-sm"><span className="font-medium">{b.owner.name || '–'}</span><br /><span className="text-ink/70">{b.owner.email}</span></p> : <p className="text-sm text-ink/60">No owner recorded.</p>}
        </Card>
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Subscription</h2><SubBadge status={sub?.status ?? null} /></div>
          {sub ? <p className="text-sm">{sub.planName} plan, {sub.price ? `${naira(sub.price).replace(/\.00$/, '')} a month` : 'free'}. {sub.status === 'trialing' ? 'Trial ends' : 'Current period ends'} <b>{day(sub.status === 'trialing' ? sub.trialEnd : sub.periodEnd)}</b>{left !== null && <span className={left < 0 ? 'text-danger' : 'text-ink/60'}> ({left < 0 ? `${-left} day(s) ago` : `${left} day(s) left`})</span>}.</p> : <p className="text-sm text-ink/60">No subscription.</p>}
          {canWrite && b.status !== 'archived' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setAction('plan')}>Change plan</Button>
              {sub?.status === 'trialing' && <Button variant="secondary" onClick={() => setAction('extend')}>Extend trial</Button>}
              {sub?.status !== 'active' && <Button variant="secondary" onClick={() => setAction('paid')}>Mark as paid</Button>}
              {sub?.status === 'active' && <Button variant="secondary" onClick={() => setAction('extend')}>Extend period</Button>}
              {sub && sub.status !== 'canceled' && <Button variant="secondary" onClick={() => setAction('cancel')}>Cancel subscription</Button>}
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
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Changes made from this console</h2><Link to={`/platform/audit?business=${b.id}`} className="text-sm font-semibold underline">Open audit log</Link></div>
          {b.platformActions.length ? <ul className="divide-y divide-ink/10 text-sm">{b.platformActions.map((a, i) => <li key={i} className="py-2"><b>{label(a.action.replace(/[._]/g, ' '))}</b> <span className="text-ink/60">by {a.by ?? 'unknown'} · {when(a.at)}</span>{a.reason && <div className="text-ink/80">&ldquo;{a.reason}&rdquo;</div>}</li>)}</ul> : <p className="text-sm text-ink/60">None yet.</p>}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Apps switched on ({b.modules.length})</h2>
          {b.modules.length ? <p className="flex flex-wrap gap-1.5 text-xs">{b.modules.map((m) => <Badge key={m}>{m}</Badge>)}</p> : <p className="text-sm text-ink/60">None.</p>}
          {b.activity.length > 0 && <><h2 className="mb-2 mt-4 font-semibold">Recent activity inside the business</h2><ul className="divide-y divide-ink/10 text-sm">{b.activity.slice(0, 8).map((a, i) => <li key={i} className="flex justify-between py-1.5"><span>{a.action}</span><span className="text-xs text-ink/60">{when(a.at)}</span></li>)}</ul></>}
        </Card>
      </div>

      {action && <ActionDialog b={target} action={action} onClose={() => setAction(null)} onDone={async () => { const gone = action === 'delete' || action === 'purge'; setAction(null); if (gone) navigate('/platform/businesses'); else await d.refresh() }} />}
    </>
  )
}

const TITLES: Record<Action, string> = { plan: 'Change plan', extend: 'Extend', suspend: 'Suspend business', reactivate: 'Reactivate business', paid: 'Mark as paid', cancel: 'Cancel subscription', edit: 'Edit business', transfer: 'Transfer ownership', delete: 'Delete business', purge: 'Delete permanently' }

/** Every change to a business goes through here: it says what will happen, asks for a reason, and only then does it. */
export function ActionDialog({ b, action, onClose, onDone }: { b: Target; action: Action; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const detail = useAsync(() => (action === 'edit' ? loadBusiness(b.id) : Promise.resolve(null)), [b.id, action])
  const [plan, setPlan] = useState<PlanCode>((b.planCode as PlanCode) ?? 'starter'); const [days, setDays] = useState('14'); const [why, setWhy] = useState('')
  const [email, setEmail] = useState(''); const [typed, setTyped] = useState('')
  const [form, setForm] = useState<{ name: string; legal: string; tz: string } | null>(null)
  const f = form ?? (detail.data ? { name: detail.data.name, legal: detail.data.legalName ?? '', tz: detail.data.timezone } : { name: b.name, legal: '', tz: 'Africa/Lagos' })
  const confirm = () => {
    if (action === 'plan') return setSubscription(b.id, { plan, status: null, extendDays: null, reason: why })
    if (action === 'extend') return setSubscription(b.id, { plan: null, status: null, extendDays: Number(days), reason: why })
    if (action === 'paid') return setSubscription(b.id, { plan, status: 'active', extendDays: null, reason: why })
    if (action === 'cancel') return setSubscription(b.id, { plan: null, status: 'canceled', extendDays: null, reason: why })
    if (action === 'edit') return updateBusiness(b.id, { name: f.name, legalName: f.legal, timezone: f.tz, reason: why })
    if (action === 'transfer') return transferOwnership(b.id, email, why)
    if (action === 'delete') return archiveBusiness(b.id, why)
    if (action === 'purge') return purgeBusiness(b.id, typed, why)
    return setBusinessStatus(b.id, action === 'suspend' ? 'suspended' : 'active', why)
  }
  const ready = why.trim().length >= 3 && (action !== 'transfer' || email.trim().includes('@')) && (!(action === 'delete' || action === 'purge') || typed.trim() === b.name) && (action !== 'edit' || f.name.trim().length > 0)
  return (
    <Dialog title={`${TITLES[action]}: ${b.name}`} onClose={onClose}>
      <div className="space-y-3">
        {(action === 'plan' || action === 'paid') && <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>{(Object.keys(PLANS) as PlanCode[]).map((p) => <option key={p} value={p}>{PLANS[p].name} ({PLAN_PRICES[p] ? `${naira(PLAN_PRICES[p]).replace(/\.00$/, '')} / month` : 'free'}, {PLANS[p].limits.maxMembers} people)</option>)}</SelectField>}
        {action === 'extend' && <TextField label="Extend by (days)" type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />}
        {action === 'edit' && (detail.loading ? <Spinner /> : <><TextField label="Business name" value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} /><TextField label="Registered (legal) name" value={f.legal} onChange={(e) => setForm({ ...f, legal: e.target.value })} /><TextField label="Time zone" value={f.tz} onChange={(e) => setForm({ ...f, tz: e.target.value })} placeholder="Africa/Lagos" /></>)}
        {action === 'transfer' && <><TextField label="New owner's email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Must already be a member of this business" /><Notice>The new owner gets full control. The current owner stays on as a business admin.</Notice></>}
        {action === 'suspend' && <Notice>Nobody in this business will be able to use it until you reactivate it. Their records are kept.</Notice>}
        {action === 'paid' && <Notice>Use this when payment has been received outside the app. It starts a paid month if the period had run out.</Notice>}
        {action === 'purge' && <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"><b>This cannot be undone.</b> Every record of this business is erased from the database: its people, sales, stock, payments, students, history and audit trail. The accounts of people who belong only to this business are deleted too (anyone who is also in another business keeps their account). Only the platform's own log of this deletion is kept. Unlike Delete business, nothing can be recovered afterwards.</div>}
        {(action === 'delete' || action === 'purge') && <TextField label={`Type "${b.name}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} />}
        {action === 'delete' && <Notice>The business disappears for everyone in it. Its records and history are kept, not erased, but there is no button here to bring it back. To erase the records too, use Delete permanently.</Notice>}
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus={action !== 'edit'} placeholder="For example: paid by transfer, ref 1234" />
        {runner.error && <ErrorState title="Not done" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ready} loading={runner.busy} onClick={() => void runner.run(async () => confirm(), 'Done.')}>{TITLES[action]}</Button></div>
      </div>
    </Dialog>
  )
}
