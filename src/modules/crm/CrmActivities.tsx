import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Button, Card, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { dateTime, label } from '@/shared/utilities/format'
import { ContactActions } from './ContactActions'
import { ACTIVITY_KINDS, cancelActivity, completeActivity, createActivity, listActivities, listContacts, listDeals, listTeam, rescheduleActivity } from './dealsApi'
import type { ActivityKind, ActivityRow } from './dealsApi'

export type Bucket = 'overdue' | 'today' | 'upcoming' | 'undated'
/** Where an open activity falls: before now, later today, later on, or no date at all. */
export function bucketOf(dueAt: string | null, now = new Date()): Bucket {
  if (!dueAt) return 'undated'
  const due = new Date(dueAt)
  if (due.getTime() < now.getTime()) return 'overdue'
  return due.toDateString() === now.toDateString() ? 'today' : 'upcoming'
}
const BUCKETS: { key: Bucket; title: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }[] = [
  { key: 'overdue', title: 'Overdue', tone: 'danger' }, { key: 'today', title: 'Today', tone: 'warning' }, { key: 'upcoming', title: 'Coming up', tone: 'info' }, { key: 'undated', title: 'No date', tone: 'neutral' },
]

/**
 * Everything to do, in one place: calls, meetings, emails and tasks across customers, leads and deals. What is overdue or due today comes first; finishing one asks
 * what happened and puts a call, meeting or email on the timeline of the person or deal it was about.
 */
export function Activities({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const { userId } = useAuth()
  const list = useAsync(() => listActivities(businessId), [businessId])
  const team = useAsync(() => listTeam(businessId), [businessId])
  const [who, setWho] = useState<'all' | 'mine'>('all'); const [type, setType] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState<string | null>(null); const [outcome, setOutcome] = useState('')
  const [moving, setMoving] = useState<string | null>(null); const [when, setWhen] = useState('')
  const manage = can('customers.manage')
  if (list.loading && !list.data) return <Spinner />
  const mine = (a: ActivityRow) => who === 'all' || a.assignedTo === userId
  const rows = (list.data ?? []).filter((a) => mine(a) && (!type || a.kind === type))
  const open = rows.filter((a) => a.status === 'open'); const done = rows.filter((a) => a.status === 'done').sort((a, z) => (z.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 15)
  const refresh = async () => { await list.refresh() }
  const act = (a: ActivityRow) => (
    <li key={a.id} className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{label(a.kind)}</Badge><b>{a.title}</b>
        {a.dueAt && <span className="text-xs text-ink/60">{dateTime(a.dueAt)}</span>}
        {a.assignee && <span className="text-xs text-ink/60">· {a.assignee}</span>}
        <span className="ml-auto"><ContactActions name={a.subject} phone={a.subjectPhone} email={a.subjectEmail} /></span>
      </div>
      {a.subject && <p className="text-xs text-ink/60">{a.subject}</p>}
      {a.status === 'done' && a.outcome && <p className="rounded bg-surface px-2 py-1 text-xs">Outcome: {a.outcome}</p>}
      {a.status === 'open' && manage && (finishing === a.id ? (
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-[14rem] flex-1"><TextField label="What happened?" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Optional: shown on their timeline" /></div>
          <Button onClick={async () => { setError(await completeActivity(businessId, a, outcome)); setFinishing(null); setOutcome(''); await refresh() }}>Mark done</Button><Button variant="secondary" onClick={() => setFinishing(null)}>Cancel</Button></div>
      ) : moving === a.id ? (
        <div className="flex flex-wrap items-end gap-2"><TextField label="New time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button onClick={async () => { setError(await rescheduleActivity(businessId, a.id, when ? new Date(when).toISOString() : null)); setMoving(null); await refresh() }}>Move it</Button><Button variant="secondary" onClick={() => setMoving(null)}>Cancel</Button></div>
      ) : (
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setFinishing(a.id); setOutcome('') }}>Done</Button><Button variant="secondary" onClick={() => { setMoving(a.id); setWhen('') }}>Reschedule</Button>
          <Button variant="secondary" onClick={async () => { setError(await cancelActivity(businessId, a.id)); await refresh() }}>Cancel it</Button></div>
      ))}
    </li>
  )
  return (
    <>
      {manage && <NewActivity businessId={businessId} team={team.data ?? []} onDone={refresh} />}
      <div className="my-3 flex flex-wrap items-end gap-3">
        <div className="w-44"><SelectField label="Show" value={who} onChange={(e) => setWho(e.target.value as 'all' | 'mine')}><option value="all">Everyone&apos;s</option><option value="mine">Mine</option></SelectField></div>
        <div className="w-40"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</SelectField></div>
        <p className="pb-2 text-sm text-ink/60">{open.length} to do</p>
      </div>
      {(error || list.error) && <ErrorState message={error ?? list.error!} />}
      {open.length === 0 && done.length === 0 ? <EmptyState title="Nothing planned" description="Schedule a call, meeting, email or task above, or from a deal, customer or lead." /> : (
        <div className="space-y-4">
          {BUCKETS.map((b) => { const items = open.filter((a) => bucketOf(a.dueAt) === b.key).sort((x, y) => (x.dueAt ?? '').localeCompare(y.dueAt ?? '')); return items.length ? (
            <Card key={b.key} className="p-0"><h3 className="flex items-center gap-2 border-b border-ink/10 p-3 text-sm font-semibold"><Badge tone={b.tone}>{b.title}</Badge> {items.length}</h3><ul className="divide-y divide-ink/10">{items.map(act)}</ul></Card>
          ) : null })}
          {done.length > 0 && <Card className="p-0"><h3 className="border-b border-ink/10 p-3 text-sm font-semibold">Done recently</h3><ul className="divide-y divide-ink/10">{done.map(act)}</ul></Card>}
        </div>
      )}
    </>
  )
}

function NewActivity({ businessId, team, onDone }: { businessId: string; team: { userId: string; name: string }[]; onDone: () => Promise<void> }) {
  const { userId } = useAuth()
  const contacts = useAsync(() => listContacts(businessId), [businessId])
  const deals = useAsync(() => listDeals(businessId), [businessId])
  const [kind, setKind] = useState<ActivityKind>('call'); const [title, setTitle] = useState(''); const [due, setDue] = useState(''); const [about, setAbout] = useState(''); const [who, setWho] = useState(userId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [t, id] = about.split(':')
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Schedule an activity</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>{ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</SelectField>
        <div className="lg:col-span-2"><TextField label="What" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call Bola about the delivery" /></div>
        <TextField label="When" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <SelectField label="For" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Nobody yet</option>{team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</SelectField>
        <div className="sm:col-span-2 lg:col-span-4"><SelectField label="About" value={about} onChange={(e) => setAbout(e.target.value)}>
          <option value="">Choose a deal, customer or lead</option>
          {(deals.data ?? []).filter((d) => d.stageKind === 'open').length > 0 && <optgroup label="Deals">{(deals.data ?? []).filter((d) => d.stageKind === 'open').map((d) => <option key={d.id} value={`deal:${d.id}`}>{d.title}</option>)}</optgroup>}
          {(contacts.data ?? []).some((c) => c.kind === 'customer') && <optgroup label="Customers">{(contacts.data ?? []).filter((c) => c.kind === 'customer').map((c) => <option key={c.id} value={`customer:${c.id}`}>{c.name}</option>)}</optgroup>}
          {(contacts.data ?? []).some((c) => c.kind === 'lead') && <optgroup label="Leads">{(contacts.data ?? []).filter((c) => c.kind === 'lead').map((c) => <option key={c.id} value={`lead:${c.id}`}>{c.name}</option>)}</optgroup>}
        </SelectField></div>
        <div className="flex items-end"><Button onClick={async () => {
          const parent = t === 'deal' ? { dealId: id } : t === 'customer' ? { customerId: id } : t === 'lead' ? { leadId: id } : null
          if (!parent) return setError('Choose who or what this is about.')
          const e = await createActivity(businessId, parent, { kind, title, dueAt: due ? new Date(due).toISOString() : null, assignedTo: who || null }); setError(e)
          if (!e) { setTitle(''); setDue(''); await onDone() }
        }}>Schedule</Button></div>
      </div>
      {error && <div className="mt-2"><ErrorState title="Not saved" message={error} /></div>}
    </Card>
  )
}
