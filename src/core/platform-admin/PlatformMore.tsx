import { CheckCircle2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { addAdmin, loadAudit, loadHealth, loadPlans, loadTeam, loadUsers, removeAdmin } from './platformApi'
import type { PlatformRole } from './platformApi'
import { day, usePlatform, when } from './platformUi'

export function PlatformUsers() {
  const [q, setQ] = useState('')
  const list = useAsync(() => loadUsers(q), [q])
  return (
    <>
      <PageHeader title="Users" description="Everyone with an account, and the businesses they belong to." />
      <div className="my-4 w-72"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></div>
      {list.error && <ErrorState message={list.error} />}
      {list.loading && !list.data ? <Spinner /> : !list.data?.length ? <Card><EmptyState title="No users match" /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Businesses</th><th className="p-3">Last signed in</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{list.data.map((u) => (
              <tr key={u.id}>
                <td className="p-3 font-medium">{u.name || '–'} {u.platformRole && <Badge tone="info">Platform {u.platformRole}</Badge>}</td><td className="p-3">{u.email}</td>
                <td className="p-3">{u.businesses.length ? u.businesses.map((b) => <div key={b.businessId + b.role}><Link to={`/platform/businesses/${b.businessId}`} className="hover:underline">{b.business}</Link> <span className="text-xs text-ink/60">{label(b.role)}{b.status !== 'active' ? `, ${b.status}` : ''}</span></div>) : <span className="text-ink/50">None</span>}</td>
                <td className="p-3 text-ink/70">{u.lastSignIn ? when(u.lastSignIn) : '–'}</td>
              </tr>))}</tbody></table>
        </Card>
      )}
    </>
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
  const log = useAsync(loadAudit, [])
  return (
    <>
      <PageHeader title="Audit Log" description="Every change made from this console, with who made it and why. It cannot be edited or deleted." />
      {log.error && <ErrorState message={log.error} />}
      {log.loading && !log.data ? <Spinner /> : !log.data?.length ? <Card className="mt-4"><EmptyState title="Nothing yet" description="Changes to plans, trials, suspensions and the platform team appear here." /></Card> : (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Business</th><th className="p-3">By</th><th className="p-3">Reason</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{log.data.map((a) => <tr key={a.id}><td className="whitespace-nowrap p-3">{when(a.at)}</td><td className="p-3 font-medium">{label(a.action.replace('.', ' '))}</td><td className="p-3">{a.businessId ? <Link to={`/platform/businesses/${a.businessId}`} className="hover:underline">{a.business ?? 'Business'}</Link> : '–'}</td><td className="p-3">{a.by ?? '–'}</td><td className="p-3 text-ink/80">{a.reason ?? '–'}</td></tr>)}</tbody></table>
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
