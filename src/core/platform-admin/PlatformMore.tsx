import { Ban, CheckCircle2, Eye, MoreHorizontal, Trash2, UserCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { Menu } from '@/shared/components/menu'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { addAdmin, loadAudit, loadHealth, loadPlans, loadTeam, loadUsers, removeAdmin, setMemberStatus } from './platformApi'
import type { PlatformRole } from './platformApi'
import { day, usePlatform, when } from './platformUi'

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

export function PlatformHealth() {
  const h = useAsync(loadHealth, [])
  return (
    <>
      <PageHeader title="System Health" description="Checks over the real records. A failing check says what it found." actions={<Button variant="secondary" onClick={() => void h.refresh()}>Check again</Button>} />
      {h.error && <ErrorState message={h.error} />}
      {h.loading && !h.data ? <Spinner /> : h.data && (
        <>
          <Card className="mt-4 p-0"><ul className="divide-y divide-ink/10 text-sm">{h.data.checks.map((c) => <li key={c.name} className="flex items-center justify-between gap-3 p-4"><span className="flex items-center gap-2 font-medium">{c.ok ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-warning" aria-hidden />}{c.name}</span><span className={c.ok ? 'text-ink/70' : 'font-semibold text-warning'}>{c.detail}</span></li>)}</ul></Card>
          <p className="mt-3 text-sm text-ink/70">Last 24 hours: {h.data.businessChanges24h} change(s) inside businesses, {h.data.platformActions24h} from this console. Checked {when(h.data.checkedAt)}.</p>
        </>
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
