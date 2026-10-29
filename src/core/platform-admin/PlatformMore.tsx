import { Ban, CheckCircle2, Database, Eye, HardDrive, MoreHorizontal, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { Menu } from '@/shared/components/menu'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { addAdmin, deleteUser, loadAudit, loadHealth, loadPlans, loadTeam, loadUsage, loadUser, loadUsers, probeServices, removeAdmin, removeUserEverywhere, setMemberStatus } from './platformApi'
import type { ServiceCheck } from './platformApi'
import type { PUserRow, PlatformRole } from './platformApi'
import { Kpi, day, usePlatform, when } from './platformUi'

type UserRow = PUserRow
type Membership = UserRow['businesses'][number]

/** A person's overall standing across their businesses, for the one-row-per-person list. */
function overall(u: UserRow): { text: string; tone: 'success' | 'info' | 'neutral' | 'warning' } {
  const live = u.businesses.filter((b) => b.businessStatus !== 'archived')
  if (!live.length) return { text: 'No business', tone: 'neutral' }
  if (live.some((b) => b.status === 'active')) return { text: 'Active', tone: 'success' }
  if (live.some((b) => b.status === 'suspended')) return { text: 'Inactive', tone: 'warning' }
  if (live.some((b) => b.status === 'invited')) return { text: 'Invited', tone: 'info' }
  return { text: 'Removed everywhere', tone: 'neutral' }
}
/** Memberships the platform team can still take away: not already removed, in a business that still exists, and not one the person owns. */
const removable = (u: UserRow) => u.businesses.filter((b) => b.status !== 'revoked' && b.businessStatus !== 'archived' && !b.isOwner)

/** One row per person, however many businesses they are in. Open a person to see each business, their role there, and act on one business or all. */
export function PlatformUsers() {
  const { canWrite, isOwner } = usePlatform()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [bizFilter, setBizFilter] = useState('')
  const list = useAsync(() => loadUsers(q), [q])
  const [deleting, setDeleting] = useState<UserRow | null>(null)
  const [removing, setRemoving] = useState<UserRow | null>(null)
  const users = list.data ?? []
  const businesses = [...new Map(users.flatMap((u) => u.businesses.map((b) => [b.businessId, b.business] as const))).entries()].sort((x, y) => x[1].localeCompare(y[1]))
  const shown = users.filter((u) => !bizFilter || u.businesses.some((b) => b.businessId === bizFilter))
  return (
    <>
      <PageHeader title="Users" description="Everyone with an account, once each. Open a person to see every business they belong to and their role there." />
      <Notice>People are added to a business by that business's own owner or admin. Stopping someone here is a support action, for when a business cannot do it itself (for example to free a seat). Ownership is moved from the Businesses page.</Notice>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="w-72"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></div>
        <div className="w-60"><SelectField label="Business" value={bizFilter} onChange={(e) => setBizFilter(e.target.value)}><option value="">All businesses</option>{businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</SelectField></div>
        <p className="pb-2 text-sm text-ink/60">{shown.length} {shown.length === 1 ? 'user' : 'users'}</p>
      </div>
      {list.error && <ErrorState message={list.error} />}
      {list.loading && !list.data ? <Spinner /> : !shown.length ? <Card><EmptyState title="No users match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">User</th><th className="p-3">Businesses</th><th className="p-3">Status</th><th className="p-3">Last signed in</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{shown.map((u) => {
              const st = overall(u); const live = u.businesses.filter((b) => b.businessStatus !== 'archived'); const canRemove = canWrite && removable(u).length > 0
              return (
                <tr key={u.id} className="cursor-pointer hover:bg-surface/60" onClick={() => navigate(`/platform/users/${u.id}`)}>
                  <td className="p-3 font-medium"><Link to={`/platform/users/${u.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{u.name || '–'}</Link> {u.platformRole && <Badge tone="info">Platform {u.platformRole}</Badge>}<div className="text-xs font-normal text-ink/60">{u.email}</div></td>
                  <td className="p-3">{live.length ? <span className="flex flex-wrap items-center gap-1">{live.slice(0, 3).map((b) => <Badge key={b.businessId} tone={b.status === 'revoked' ? 'neutral' : 'info'}>{b.business}{b.isOwner ? ' (owner)' : ''}</Badge>)}{live.length > 3 && <span className="text-xs text-ink/60">+{live.length - 3} more</span>}</span> : <span className="text-ink/50">None</span>}</td>
                  <td className="p-3"><Badge tone={st.tone}>{st.text}</Badge></td>
                  <td className="p-3 text-ink/70">{u.lastSignIn ? when(u.lastSignIn) : '–'}</td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}><Menu label={`Actions for ${u.name || u.email}`}
                    trigger={({ toggle }) => <button type="button" onClick={toggle} aria-haspopup="menu" aria-label={`Actions for ${u.name || u.email}`} className="grid size-8 place-items-center rounded-md text-ink/60 hover:bg-surface hover:text-ink"><MoreHorizontal className="size-5" aria-hidden /></button>}
                    items={[
                      { label: u.name || u.email, heading: true },
                      { label: 'View details', to: `/platform/users/${u.id}`, icon: <Eye className="size-4" /> },
                      ...(canRemove ? [{ label: 'Remove from all businesses', icon: <Ban className="size-4 text-danger" />, onSelect: () => setRemoving(u), divider: true }] : []),
                      ...(isOwner && !u.platformRole ? [{ label: 'Delete user', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => setDeleting(u), divider: !canRemove }] : []),
                    ]} /></td>
                </tr>)
            })}</tbody></table>
        </Card>
      )}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} onDone={async () => { setDeleting(null); await list.refresh() }} />}
      {removing && <RemoveEverywhereDialog user={removing} onClose={() => setRemoving(null)} onDone={async () => { setRemoving(null); await list.refresh() }} />}
    </>
  )
}

/** One person: their account, and every business they belong to with their role, status and what can be done to that one membership. */
export function PlatformUserPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { canWrite, isOwner } = usePlatform()
  const d = useAsync(() => loadUser(id), [id])
  const [acting, setActing] = useState<{ m: Membership; status: 'active' | 'suspended' | 'revoked' } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  if (d.loading && !d.data) return <Spinner />
  if (d.error || !d.data) return <div className="space-y-3"><ErrorState message={d.error ?? 'User not found'} /><Link to="/platform/users" className="underline">Back to users</Link></div>
  const u = d.data; const st = overall(u); const canRemoveAll = canWrite && removable(u).length > 0
  const owned = u.businesses.filter((b) => b.isOwner && b.businessStatus !== 'archived')
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/platform/users" className="text-ink/60 hover:text-ink">Users</Link> <span className="text-ink/40">/</span> {u.name || u.email}</p>
      <PageHeader title={u.name || u.email} description={`${u.email}${u.createdAt ? ` · joined ${day(u.createdAt)}` : ''} · last signed in ${u.lastSignIn ? when(u.lastSignIn) : 'never'}`}
        actions={<div className="flex flex-wrap items-center gap-2">{u.platformRole && <Badge tone="info">Platform {u.platformRole}</Badge>}<Badge tone={st.tone}>{st.text}</Badge>
          {canRemoveAll && <Button variant="secondary" onClick={() => setRemoving(true)}><Ban className="size-4" aria-hidden /> Remove from all businesses</Button>}
          {isOwner && !u.platformRole && <Button variant="secondary" onClick={() => setDeleting(true)}><Trash2 className="size-4 text-danger" aria-hidden /> Delete user</Button>}</div>} />
      {done && <div className="mt-3"><Notice>{done}</Notice></div>}
      {owned.length > 0 && <div className="mt-3"><Notice>{u.name || 'This person'} owns {owned.map((b) => b.business).join(', ')}. They cannot be removed from a business they own: move the ownership from that business's page first.</Notice></div>}
      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold">Businesses ({u.businesses.length})</h2>
        {!u.businesses.length ? <div className="p-4"><EmptyState title="Not in any business" /></div> : (
          <table className="mt-2 w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Business</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Joined</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{u.businesses.map((m) => {
              const gone = m.businessStatus === 'archived'; const can = canWrite && !gone && !m.isOwner && m.status !== 'invited'
              return (
                <tr key={m.businessId}>
                  <td className="p-3 font-medium"><Link to={`/platform/businesses/${m.businessId}`} className="hover:underline">{m.business}</Link>{gone && <span className="ml-2"><Badge>Business deleted</Badge></span>}{m.businessStatus === 'suspended' && <span className="ml-2"><Badge tone="danger">Business suspended</Badge></span>}</td>
                  <td className="p-3">{label(m.role)}{m.isOwner && m.role !== 'owner' && <span className="ml-2"><Badge tone="info">Owner</Badge></span>}</td>
                  <td className="p-3"><Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'info' : m.status === 'suspended' ? 'warning' : 'neutral'}>{m.status === 'suspended' ? 'Inactive' : m.status === 'revoked' ? 'Removed' : label(m.status)}</Badge></td>
                  <td className="p-3 text-ink/70">{day(m.joinedAt)}</td>
                  <td className="p-3 text-right">{can ? (
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      {m.status === 'active' && <Button variant="secondary" onClick={() => setActing({ m, status: 'suspended' })}>Set inactive</Button>}
                      {m.status === 'suspended' && <Button variant="secondary" onClick={() => setActing({ m, status: 'active' })}>Set active again</Button>}
                      {m.status !== 'revoked' && <Button variant="secondary" onClick={() => setActing({ m, status: 'revoked' })}><Trash2 className="size-4 text-danger" aria-hidden /> Remove</Button>}
                    </span>) : m.isOwner && !gone ? <Link to={`/platform/businesses/${m.businessId}`} className="text-xs text-ink/60 underline">Move ownership first</Link> : null}</td>
                </tr>)
            })}</tbody></table>
        )}
      </Card>
      {acting && <MemberDialog user={u} m={acting.m} status={acting.status} onClose={() => setActing(null)} onDone={async () => { setActing(null); setDone(null); await d.refresh() }} />}
      {removing && <RemoveEverywhereDialog user={u} onClose={() => setRemoving(false)} onDone={async (msg) => { setRemoving(false); setDone(msg ?? null); await d.refresh() }} />}
      {deleting && <DeleteUserDialog user={u} onClose={() => setDeleting(false)} onDone={async () => { setDeleting(false); navigate('/platform/users') }} />}
    </>
  )
}

function RemoveEverywhereDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: (msg?: string) => Promise<void> }) {
  const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const goes = removable(user); const kept = user.businesses.filter((b) => b.isOwner && b.businessStatus !== 'archived')
  async function go() {
    setBusy(true); const r = await removeUserEverywhere(user.id, why); setBusy(false)
    if (typeof r === 'string') { setError(r); return }
    await onDone(`Removed from ${r.removed} ${r.removed === 1 ? 'business' : 'businesses'}.${r.keptOwned ? ` Still the owner of ${r.keptOwned}.` : ''}`)
  }
  return (
    <Dialog title={`Remove from all businesses: ${user.name || user.email}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">They will no longer be able to use {goes.length === 1 ? 'this business' : `these ${goes.length} businesses`}: <b>{goes.map((b) => b.business).join(', ')}</b>. Their account stays and their past records stay. To bring them back, a business must invite them again.</p>
        {kept.length > 0 && <Notice>They own {kept.map((b) => b.business).join(', ')}, so they stay there. Move the ownership first to remove them from it.</Notice>}
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        {error && <ErrorState title="Not done" message={error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={why.trim().length < 3} loading={busy} onClick={() => void go()}>Remove from all</Button></div>
      </div>
    </Dialog>
  )
}

function DeleteUserDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const [why, setWhy] = useState(''); const [typed, setTyped] = useState('')
  const ready = why.trim().length >= 3 && typed.trim().toLowerCase() === user.email.toLowerCase()
  return (
    <Dialog title={`Delete user: ${user.name || user.email}`} onClose={onClose}>
      <div className="space-y-3">
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"><b>This cannot be undone.</b> The account is erased: they can no longer sign in, and they are taken out of every business they belong to. Records they made in a business are not erased, and an account that has recorded sales, payments or stock movements cannot be deleted at all (use Remove from all businesses instead). Someone who owns a business, or is on the platform team, cannot be deleted until that is dealt with.</div>
        <TextField label={`Type "${user.email}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} />
        {runner.error && <ErrorState title="Not deleted" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ready} loading={runner.busy} onClick={() => void runner.run(async () => deleteUser(user.id, typed, why), 'User deleted.')}>Delete user for good</Button></div>
      </div>
    </Dialog>
  )
}

function MemberDialog({ user, m, status, onClose, onDone }: { user: UserRow; m: Membership; status: 'active' | 'suspended' | 'revoked'; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const [why, setWhy] = useState('')
  const verb = status === 'active' ? 'Set active again' : status === 'suspended' ? 'Set inactive' : 'Remove from business'
  return (
    <Dialog title={`${verb}: ${user.name || user.email}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">{status === 'active' ? 'They can use' : 'They will no longer be able to use'} <b>{m.business}</b>{status === 'active' ? ' again.' : '. Their past records stay, and their other businesses are not affected.'}{status === 'revoked' && ' To bring them back, the business must invite them again.'}</p>
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not done" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={why.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => setMemberStatus(m.businessId, user.id, status, why), 'Done.')}>{verb}</Button></div>
      </div>
    </Dialog>
  )
}

export function PlatformPlans() {
  const plans = useAsync(loadPlans, [])
  return (
    <>
      <PageHeader title="Plans & Pricing" description="The plans businesses can be on. Prices and limits come from the database; to change one, change the plan data and a migration." />
      {plans.error && <ErrorState message={plans.error} />}
      {plans.loading && !plans.data ? <Spinner /> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(plans.data ?? []).map((p) => (
            <Card key={p.code}>
              <h2 className="font-semibold">{p.name}</h2>
              <p className="mt-2 text-3xl font-bold tabular">{p.price ? naira(p.price).replace(/\.00$/, '') : 'Free'}{p.price > 0 && <span className="text-sm font-normal text-ink/60"> / {p.interval}</span>}</p>
              <ul className="mt-3 space-y-1 text-sm text-ink/80"><li>Up to {p.maxMembers} people</li><li>{p.maxBranches === 1 ? 'One branch' : `Up to ${p.maxBranches} branches`}</li></ul>
              <p className="mt-3 border-t border-line pt-3 text-sm"><b className="tabular">{p.businesses}</b> business{p.businesses === 1 ? '' : 'es'} on this plan</p>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

export function PlatformAudit() {
  const [params, setParams] = useSearchParams()
  const business = params.get('business')
  const log = useAsync(loadAudit, [])
  const rows = (log.data ?? []).filter((a) => !business || a.businessId === business)
  const name = rows[0]?.business ?? log.data?.find((a) => a.businessId === business)?.business ?? 'this business'
  return (
    <>
      <PageHeader title="Audit Log" description="Every change made from this console, with who made it and why. It cannot be edited or deleted." />
      {business && <div className="mt-3 flex items-center gap-3 text-sm"><Notice>Showing only the changes to {name}.</Notice><button type="button" className="font-semibold underline" onClick={() => setParams({})}>Show everything</button></div>}
      {log.error && <ErrorState message={log.error} />}
      {log.loading && !log.data ? <Spinner /> : !rows.length ? <Card className="mt-4"><EmptyState title="Nothing yet" description="Changes to plans, trials, suspensions, people and the platform team appear here." /></Card> : (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Business</th><th className="p-3">By</th><th className="p-3">Reason</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{rows.map((a) => <tr key={a.id}><td className="whitespace-nowrap p-3">{when(a.at)}</td><td className="p-3 font-medium">{label(a.action.replace(/[._]/g, ' '))}</td><td className="p-3">{a.businessId ? <Link to={`/platform/businesses/${a.businessId}`} className="hover:underline">{a.business ?? 'Business'}</Link> : '–'}</td><td className="p-3">{a.by ?? '–'}</td><td className="p-3 text-ink/80">{a.reason ?? '–'}</td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  )
}

type Level = 'ok' | 'slow' | 'down'
/** Under 1.5 s is fine, up to 4 s is slow, anything slower (or failing) is down. These are timings from your own browser, so your connection counts too. */
const levelOf = (c: ServiceCheck): Level => (!c.ok || c.ms === null ? 'down' : c.ms < 1500 ? 'ok' : c.ms < 4000 ? 'slow' : 'down')
const LEVEL = {
  ok: { text: 'Operational', badge: 'bg-success-soft text-success', dot: 'bg-success' },
  slow: { text: 'Degraded', badge: 'bg-warning-soft text-warning', dot: 'bg-amber-dark' },
  down: { text: 'Not responding', badge: 'bg-danger-soft text-danger', dot: 'bg-danger' },
} as const
const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(Math.round(bytes / 1024 ** 2), bytes > 0 ? 1 : 0)} MB`)

function UsageBar({ icon, name, used, cap }: { icon: ReactNode; name: string; used: number; cap: number }) {
  const pct = cap ? (used / cap) * 100 : 0
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-amber-dark' : 'bg-accent'
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-medium">{icon}{name}</span><span className="tabular text-ink/70">{mb(used)} of {mb(cap)} ({pct < 0.1 && used > 0 ? '<0.1' : pct.toFixed(1)}%)</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-label={`${name} used`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(Math.max(pct, used > 0 ? 1 : 0), 100)}%` }} /></div>
      {pct >= 70 && <p className="mt-1 text-xs text-warning">{pct >= 90 ? 'Almost full.' : 'Above 70%.'} Upgrade the hosting plan, then raise the limit in the platform settings table.</p>}
    </div>
  )
}

export function PlatformHealth() {
  const services = useAsync(probeServices, [])
  const data = useAsync(loadHealth, [])
  const usage = useAsync(loadUsage, [])
  const [checked, setChecked] = useState<Date | null>(null)
  const run = async () => { await Promise.all([services.refresh(), data.refresh(), usage.refresh()]); setChecked(new Date()) }
  useEffect(() => { const t = setInterval(() => void run(), 60_000); return () => clearInterval(t) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const checks = services.data ?? []
  const worst: Level = checks.some((c) => levelOf(c) === 'down') ? 'down' : checks.some((c) => levelOf(c) === 'slow') ? 'slow' : 'ok'
  const failing = (data.data?.checks ?? []).filter((c) => !c.ok)
  const u = usage.data
  return (
    <>
      <PageHeader title="System Health" description="Live checks against the services the platform depends on, timed from your browser, and how much of the hosting plan is used." actions={<Button variant="secondary" loading={services.loading} onClick={() => void run()}><RefreshCw className="size-4" aria-hidden /> Run checks</Button>} />
      {services.error && <ErrorState message={services.error} />}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium"><span className={`size-2.5 rounded-full ${LEVEL[worst].dot}`} aria-hidden />{services.loading && !checks.length ? 'Checking…' : worst === 'ok' ? 'All services are responding normally' : worst === 'slow' ? 'Some services are slow' : 'A service is not responding'}</p>
          <p className="text-xs text-ink/60">{checked ? `Last checked ${checked.toLocaleTimeString('en-NG')}` : 'Just now'} · refreshes every minute</p>
        </div>
      </Card>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {services.loading && !checks.length ? <Spinner /> : checks.map((c) => { const l = levelOf(c); return (
          <Card key={c.key}>
            <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{c.name}</h2><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LEVEL[l].badge}`}>{LEVEL[l].text}</span></div>
            <p className="mt-1 text-sm text-ink/70">{c.detail}</p>
            <p className="mt-3 text-sm">Round-trip <b className="tabular">{c.ms === null ? 'no answer' : `${c.ms}ms`}</b></p>
          </Card>
        ) })}
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Hosting plan usage</h2>
      <Card>
        {usage.loading && !u ? <Spinner /> : u && (
          <div className="grid gap-6 md:grid-cols-2">
            <UsageBar icon={<Database className="size-4" aria-hidden />} name="Database" used={u.databaseBytes} cap={u.databaseCapBytes} />
            <UsageBar icon={<HardDrive className="size-4" aria-hidden />} name="File storage" used={u.storageBytes} cap={u.storageCapBytes} />
          </div>
        )}
        {usage.error && <ErrorState message={usage.error} />}
        <p className="mt-4 text-xs text-ink/60">Measured against the plan limits kept in the platform settings table (they start at the free plan: 500 MB database and 1 GB storage). Raise them there after upgrading.</p>
      </Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Platform usage</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Businesses" value={u ? String(u.businesses) : '–'} note="Not deleted" to="/platform/businesses" />
        <Kpi title="Users" value={u ? String(u.users) : '–'} note="Accounts across all businesses" to="/platform/users" />
        <Kpi title="Storage used" value={u ? mb(u.storageBytes) : '–'} note="Uploaded files" />
        <Kpi title="Audit events" value={u ? String(u.auditEvents) : '–'} note="Recorded platform-wide" to="/platform/audit" />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Data checks</h2>
      {data.error && <ErrorState message={data.error} />}
      {data.loading && !data.data ? <Spinner /> : data.data && (
        <Card className="p-0">
          <ul className="divide-y divide-ink/10 text-sm">{data.data.checks.map((c) => <li key={c.name} className="flex items-center justify-between gap-3 p-4"><span className="flex items-center gap-2 font-medium">{c.ok ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-warning" aria-hidden />}{c.name}</span><span className={c.ok ? 'text-ink/70' : 'font-semibold text-warning'}>{c.detail}</span></li>)}</ul>
          <p className="border-t border-line p-3 text-xs text-ink/60">{failing.length ? `${failing.length} check(s) need attention. ` : ''}Last 24 hours: {data.data.businessChanges24h} change(s) inside businesses, {data.data.platformActions24h} from this console.</p>
        </Card>
      )}
    </>
  )
}

const ROLE_HELP: Record<PlatformRole, string> = { owner: 'Everything, including who is on the team', engineer: 'Manage businesses and subscriptions', support: 'Read only' }

export function PlatformTeam() {
  const { isOwner } = usePlatform()
  const team = useAsync(loadTeam, [])
  const runner = useFormRunner(async () => { await team.refresh() })
  const [email, setEmail] = useState(''); const [role, setRole] = useState<PlatformRole>('engineer')
  return (
    <>
      <PageHeader title="Platform Team" description="The people who run DOA itself. This is separate from any business's own staff and roles." />
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{(Object.keys(ROLE_HELP) as PlatformRole[]).map((r) => <Card key={r}><p className="font-semibold">{label(r)}</p><p className="text-sm text-ink/70">{ROLE_HELP[r]}</p></Card>)}</div>
      {team.error && <ErrorState message={team.error} />}
      {team.loading && !team.data ? <Spinner /> : (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Since</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">{(team.data ?? []).map((a) => (
              <tr key={a.userId}><td className="p-3 font-medium">{a.name || '–'}</td><td className="p-3">{a.email}</td><td className="p-3"><Badge tone="info">{label(a.role)}</Badge></td><td className="p-3">{day(a.since)}</td>
                <td className="p-3 text-right">{isOwner && <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => removeAdmin(a.userId), 'Removed.')}>Remove</Button>}</td></tr>))}</tbody></table>
        </Card>
      )}
      {runner.error && <div className="mt-3"><ErrorState title="Not done" message={runner.error} /></div>}
      {isOwner ? (
        <Card className="mt-4">
          <h2 className="mb-2 font-semibold">Add someone, or change their role</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <TextField label="Their email (they must already have an account)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}><option value="owner">Owner</option><option value="engineer">Engineer</option><option value="support">Support</option></SelectField>
            <Button disabled={!email.trim()} loading={runner.busy} onClick={() => void runner.run(async () => addAdmin(email, role), 'Saved.', () => setEmail(''))}>Save</Button>
          </div>
          <p className="mt-2 text-xs text-ink/60">The platform always keeps at least one owner.</p>
        </Card>
      ) : <div className="mt-4"><Notice>Only a platform owner can change the team.</Notice></div>}
    </>
  )
}
