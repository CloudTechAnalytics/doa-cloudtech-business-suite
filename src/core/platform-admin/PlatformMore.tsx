import { Ban, CheckCircle2, Database, Eye, HardDrive, MoreHorizontal, RefreshCw, Trash2, UserCheck, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { Menu } from '@/shared/components/menu'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { addAdmin, loadAudit, loadHealth, loadPlans, loadTeam, loadUsage, loadUsers, probeServices, removeAdmin, setMemberStatus } from './platformApi'
import type { ServiceCheck } from './platformApi'
import type { PlatformRole } from './platformApi'
import { Kpi, day, usePlatform, when } from './platformUi'

type MemberRow = { key: string; userId: string; name: string; email: string; platformRole: PlatformRole | null; businessId: string | null; business: string | null; role: string | null; status: string | null; lastSignIn: string | null }

/** One row per person per business, like the people lists inside a business, with what the platform team can do to each membership. */
export function PlatformUsers() {
  const { canWrite } = usePlatform()
  const [q, setQ] = useState('')
  const [bizFilter, setBizFilter] = useState('')
  const list = useAsync(() => loadUsers(q), [q])
  const [acting, setActing] = useState<{ row: MemberRow; status: 'active' | 'suspended' | 'revoked' } | null>(null)
  const rows: MemberRow[] = (list.data ?? []).flatMap((u): MemberRow[] => u.businesses.length
    ? u.businesses.map((b) => ({ key: u.id + b.businessId, userId: u.id, name: u.name, email: u.email, platformRole: u.platformRole, businessId: b.businessId, business: b.business, role: b.role, status: b.status, lastSignIn: u.lastSignIn }))
    : [{ key: u.id, userId: u.id, name: u.name, email: u.email, platformRole: u.platformRole, businessId: null, business: null, role: null, status: null, lastSignIn: u.lastSignIn }])
  const businesses = [...new Map(rows.filter((r) => r.businessId).map((r) => [r.businessId!, r.business!])).entries()]
  const shown = rows.filter((r) => !bizFilter || r.businessId === bizFilter)
  return (
    <>
      <PageHeader title="Users" description="Everyone with an account, and the businesses they belong to." />
      <Notice>People are added to a business by that business's own owner or admin. Stopping someone here is a support action, for when a business cannot do it itself (for example to free a seat). Ownership is moved from the Businesses page.</Notice>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="w-72"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></div>
        <div className="w-60"><SelectField label="Business" value={bizFilter} onChange={(e) => setBizFilter(e.target.value)}><option value="">All businesses</option>{businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</SelectField></div>
        <p className="pb-2 text-sm text-ink/60">{new Set(shown.map((r) => r.userId)).size} users</p>
      </div>
      {list.error && <ErrorState message={list.error} />}
      {list.loading && !list.data ? <Spinner /> : !shown.length ? <Card><EmptyState title="No users match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">User</th><th className="p-3">Business</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Last signed in</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{shown.map((r) => (
              <tr key={r.key}>
                <td className="p-3 font-medium">{r.name || '–'} {r.platformRole && <Badge tone="info">Platform {r.platformRole}</Badge>}<div className="text-xs font-normal text-ink/60">{r.email}</div></td>
                <td className="p-3">{r.businessId ? <Link to={`/platform/businesses/${r.businessId}`} className="hover:underline">{r.business}</Link> : <span className="text-ink/50">None</span>}</td>
                <td className="p-3">{r.role ? label(r.role) : '–'}</td>
                <td className="p-3">{r.status ? <Badge tone={r.status === 'active' ? 'success' : r.status === 'invited' ? 'info' : 'neutral'}>{label(r.status)}</Badge> : '–'}</td>
                <td className="p-3 text-ink/70">{r.lastSignIn ? when(r.lastSignIn) : '–'}</td>
                <td className="p-3 text-right">{r.businessId && r.status !== 'invited' && canWrite && <Menu label={`Actions for ${r.name || r.email}`}
                  trigger={({ toggle }) => <button type="button" onClick={toggle} aria-haspopup="menu" aria-label={`Actions for ${r.name || r.email}`} className="grid size-8 place-items-center rounded-md text-ink/60 hover:bg-surface hover:text-ink"><MoreHorizontal className="size-5" aria-hidden /></button>}
                  items={[
                    { label: r.name || r.email, heading: true },
                    { label: 'View business', to: `/platform/businesses/${r.businessId}`, icon: <Eye className="size-4" /> },
                    ...(r.status === 'active' ? [{ label: 'Set inactive', icon: <Ban className="size-4" />, onSelect: () => setActing({ row: r, status: 'suspended' }), divider: true }] : []),
                    ...(r.status === 'suspended' ? [{ label: 'Set active again', icon: <UserCheck className="size-4" />, onSelect: () => setActing({ row: r, status: 'active' }), divider: true }] : []),
                    ...(r.status !== 'revoked' ? [{ label: 'Remove from business', icon: <Trash2 className="size-4 text-danger" />, onSelect: () => setActing({ row: r, status: 'revoked' }) }] : []),
                  ]} />}</td>
              </tr>))}</tbody></table>
        </Card>
      )}
      {acting && <MemberDialog row={acting.row} status={acting.status} onClose={() => setActing(null)} onDone={async () => { setActing(null); await list.refresh() }} />}
    </>
  )
}

function MemberDialog({ row, status, onClose, onDone }: { row: MemberRow; status: 'active' | 'suspended' | 'revoked'; onClose: () => void; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone)
  const [why, setWhy] = useState('')
  const verb = status === 'active' ? 'Set active again' : status === 'suspended' ? 'Set inactive' : 'Remove from business'
  return (
    <Dialog title={`${verb}: ${row.name || row.email}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">{status === 'active' ? 'They can use' : 'They will no longer be able to use'} <b>{row.business}</b>{status === 'active' ? ' again.' : '. Their past records stay.'}{status === 'revoked' && ' To bring them back, the business must invite them again.'}</p>
        <TextField label="Reason (kept in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not done" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={why.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => setMemberStatus(row.businessId!, row.userId, status, why), 'Done.')}>{verb}</Button></div>
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
