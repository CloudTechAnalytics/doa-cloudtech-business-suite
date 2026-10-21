import clsx from 'clsx'
import { X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { useIdempotencyKey } from '@/shared/hooks/useIdempotencyKey'
import { DataTable } from '@/shared/tables/DataTable'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { setCreditLimit, myTradePermissions } from '@/modules/sales/tradeApi'
import * as api from './crmApi'
import type { CustomerRow, LeadRow, LeadStatus, Parent } from './crmApi'

const TABS = ['Customers', 'Leads', 'Follow-ups'] as const
const PAGE = 10
const LEAD_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { new: 'info', contacted: 'neutral', qualified: 'warning', converted: 'success', lost: 'danger' }

export function CrmPage() {
  const { active } = useBusiness()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Customers')
  const businessId = active?.id ?? ''
  const perms = useAsync(() => myTradePermissions(businessId), [businessId])
  if (!active) return null
  const can = (p: string) => perms.data?.includes(p) ?? false
  return (
    <>
      <PageHeader title="CRM" description="Track leads and customers, keep notes, schedule follow-ups and see each customer's history in one place." />
      <div role="tablist" aria-label="CRM sections" className="mb-4 flex gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}</button>
        ))}
      </div>
      {tab === 'Customers' && <Customers businessId={businessId} can={can} />}
      {tab === 'Leads' && <Leads businessId={businessId} can={can} />}
      {tab === 'Follow-ups' && <FollowUps businessId={businessId} can={can} />}
    </>
  )
}

// ---------------------------------------------------------------------------- customers
function Customers({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const query = useDebounced(q)
  const list = useAsync(() => api.searchCustomers(businessId, { q: query, category, page, pageSize: PAGE }), [businessId, query, category, page])
  const categories = useAsync(() => api.listCategories(businessId), [businessId])

  return (
    <>
      <div className="mb-3 grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
        <TextField label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Name, phone or email" />
        <SelectField label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}>
          <option value="">All categories</option>{categories.data?.map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        {can('customers.manage') && <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add customer'}</Button>}
      </div>
      {adding && <AddCustomer businessId={businessId} onDone={async () => { setAdding(false); await Promise.all([list.refresh(), categories.refresh()]) }} />}
      {list.error && <ErrorState message={list.error} />}
      <DataTable<CustomerRow>
        rows={list.data?.rows ?? []} total={list.data?.total ?? 0} page={page} pageSize={PAGE} onPage={setPage} loading={list.loading}
        rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} emptyTitle={q || category ? 'No customers match' : 'No customers yet'} emptyHint="Walk-in sales do not need a customer record."
        columns={[
          { key: 'name', header: 'Customer', render: (r) => <><b>{r.name}</b><div className="text-xs text-ink/60">{r.phone ?? r.email ?? 'No contact'}</div></> },
          { key: 'category', header: 'Category', render: (r) => r.category ?? '–' },
          { key: 'source', header: 'Source', render: (r) => r.source ?? '–' },
          { key: 'limit', header: 'Credit limit', align: 'right', render: (r) => naira(r.creditLimit) },
          { key: 'owes', header: 'Owes', align: 'right', render: (r) => naira(r.outstanding) },
        ]}
      />
      {open && <CustomerDialog businessId={businessId} id={open} can={can} onClose={() => setOpen(null)} onChanged={list.refresh} />}
    </>
  )
}

function AddCustomer({ businessId, onDone }: { businessId: string; onDone: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | undefined>()
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const s = (k: string) => String(f.get(k) ?? '')
    if (!s('name').trim()) return setNameErr('Enter the customer name.')
    setNameErr(undefined)
    const err = await api.createCustomer(businessId, { name: s('name'), phone: s('phone'), email: s('email'), source: s('source'), category: s('category') })
    setError(err)
    if (!err) await onDone()
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
        <TextField label="Name" name="name" error={nameErr} />
        <TextField label="Phone" name="phone" />
        <TextField label="Email" name="email" type="email" />
        <TextField label="Source" name="source" placeholder="walk-in, referral…" />
        <TextField label="Category" name="category" placeholder="Retailer, Wholesale…" />
        <div className="flex items-end"><Button type="submit">Save customer</Button></div>
        {error && <div className="sm:col-span-3"><ErrorState message={error} /></div>}
      </form>
    </Card>
  )
}

function CustomerDialog({ businessId, id, can, onClose, onChanged }: { businessId: string; id: string; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const d = useAsync(() => api.customerDetail(businessId, id), [businessId, id])
  const [error, setError] = useState<string | null>(null)
  if (!d.data) return <Dialog title="Customer" onClose={onClose}>{d.error ? <ErrorState message={d.error} /> : <Spinner />}</Dialog>
  const { customer: c, history, tasks, tags } = d.data
  const parent: Parent = { customerId: id }
  const reload = async () => { await Promise.all([d.refresh(), onChanged()]) }
  return (
    <Dialog title={c.name} onClose={onClose} wide>
      {error && <ErrorState message={error} />}
      <p className="mb-3 text-sm text-ink/70">{[c.phone, c.email, c.category, c.source && `via ${c.source}`].filter(Boolean).join(' · ') || 'No contact details'}</p>
      <dl className="mb-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-xs text-ink/60">Owes you</dt><dd className="tabular font-semibold">{naira(c.outstanding)}</dd></div>
        <div>
          <dt className="text-xs text-ink/60">Credit limit</dt>
          <dd className="tabular">
            {can('customers.credit') ? (
              <input aria-label="Credit limit" type="number" min="0" step="1" defaultValue={c.creditLimit} className="w-32 rounded border border-ink/20 px-2 py-1"
                onBlur={async (e) => { const v = Number(e.target.value); if (v !== c.creditLimit) { setError(await setCreditLimit(businessId, id, v)); await reload() } }} />
            ) : naira(c.creditLimit)}
          </dd>
        </div>
      </dl>
      <Tags tags={tags} canEdit={can('customers.manage')} onAdd={async (n) => { setError(await api.addTag(businessId, parent, n)); await d.refresh() }} onRemove={async (t) => { setError(await api.removeTag(businessId, parent, t)); await d.refresh() }} />
      {can('customers.manage') && <ActivityForms onNote={async (k, s) => { const e = await api.addInteraction(businessId, parent, k, s); setError(e); if (!e) await d.refresh(); return e }} onTask={async (t, due) => { const e = await api.addTask(businessId, parent, t, due); setError(e); if (!e) await d.refresh(); return e }} />}
      {tasks.some((t) => t.status === 'open') && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Open follow-ups</h3>
          <ul className="divide-y divide-ink/10 text-sm">
            {tasks.filter((t) => t.status === 'open').map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5"><span>{t.title}{t.dueAt && <span className="ml-2 text-xs text-ink/60">due {dateTime(t.dueAt)}</span>}</span>
                {can('customers.manage') && <Button variant="secondary" className="ml-auto" onClick={async () => { setError(await api.setTaskStatus(businessId, t.id, 'done')); await d.refresh() }}>Done</Button>}</li>
            ))}
          </ul>
        </div>
      )}
      <h3 className="mb-1 mt-4 text-sm font-semibold">History</h3>
      {history.length === 0 ? <p className="text-sm text-ink/60">Nothing recorded yet.</p> : (
        <ul className="divide-y divide-ink/10 text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 py-1.5">
              <Badge tone={h.kind === 'sale' ? 'success' : h.kind === 'task' ? 'warning' : 'neutral'}>{label(h.kind === 'interaction' ? h.label : h.kind)}</Badge>
              <span>{h.detail}</span>
              {h.amount !== undefined && <span className="tabular text-ink/70">{naira(h.amount)}{h.balance ? ` (owes ${naira(h.balance)})` : ''}</span>}
              <span className="ml-auto text-xs text-ink/50">{dateTime(h.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function Tags({ tags, canEdit, onAdd, onRemove }: { tags: { id: string; name: string }[]; canEdit: boolean; onAdd: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand-ink">{t.name}
          {canEdit && <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => void onRemove(t.id)}><X className="size-3" /></button>}</span>
      ))}
      {canEdit && (
        <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const v = String(new FormData(f).get('tag') ?? ''); if (v.trim()) { await onAdd(v); f.reset() } }}>
          <input name="tag" aria-label="New tag" placeholder="Add tag" className="w-28 rounded border border-ink/20 px-2 py-0.5 text-xs" />
        </form>
      )}
    </div>
  )
}

function ActivityForms({ onNote, onTask }: { onNote: (kind: string, summary: string) => Promise<string | null>; onTask: (title: string, due: string | null) => Promise<string | null> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <form className="space-y-2" noValidate onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); if (!(await onNote(String(d.get('kind')), String(d.get('summary'))))) f.reset() }}>
        <h3 className="text-sm font-semibold">Log an interaction</h3>
        <SelectField label="Type" name="kind"><option value="note">Note</option><option value="call">Call</option><option value="visit">Visit</option><option value="message">Message</option><option value="other">Other</option></SelectField>
        <TextField label="Summary" name="summary" />
        <Button type="submit" variant="secondary">Add</Button>
      </form>
      <form className="space-y-2" noValidate onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); const due = String(d.get('due') ?? ''); if (!(await onTask(String(d.get('title')), due ? new Date(due).toISOString() : null))) f.reset() }}>
        <h3 className="text-sm font-semibold">Schedule a follow-up</h3>
        <TextField label="What to do" name="title" />
        <TextField label="Due" name="due" type="datetime-local" />
        <Button type="submit" variant="secondary">Schedule</Button>
      </form>
    </div>
  )
}

// -------------------------------------------------------------------------------- leads
function Leads({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const query = useDebounced(q)
  const list = useAsync(() => api.searchLeads(businessId, { q: query, status, page, pageSize: PAGE }), [businessId, query, status, page])
  return (
    <>
      <div className="mb-3 grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
        <TextField label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Name, phone or email" />
        <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="">All</option>{api.LEAD_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </SelectField>
        {can('customers.manage') && <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add lead'}</Button>}
      </div>
      {adding && <AddLead businessId={businessId} onDone={async () => { setAdding(false); await list.refresh() }} />}
      {list.error && <ErrorState message={list.error} />}
      <DataTable<LeadRow>
        rows={list.data?.rows ?? []} total={list.data?.total ?? 0} page={page} pageSize={PAGE} onPage={setPage} loading={list.loading}
        rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} emptyTitle={q || status ? 'No leads match' : 'No leads yet'} emptyHint="Add prospects here and convert them to customers when they buy."
        columns={[
          { key: 'name', header: 'Lead', render: (r) => <><b>{r.name}</b><div className="text-xs text-ink/60">{r.phone ?? r.email ?? 'No contact'}</div></> },
          { key: 'source', header: 'Source', render: (r) => r.source ?? '–' },
          { key: 'status', header: 'Status', render: (r) => <Badge tone={LEAD_TONE[r.status]}>{label(r.status)}</Badge> },
          { key: 'added', header: 'Added', render: (r) => dateTime(r.createdAt) },
        ]}
      />
      {open && <LeadDialog businessId={businessId} id={open} can={can} onClose={() => setOpen(null)} onChanged={list.refresh} />}
    </>
  )
}

function AddLead({ businessId, onDone }: { businessId: string; onDone: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | undefined>()
  return (
    <Card className="mb-4">
      <form noValidate className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '')
        if (!s('name').trim()) return setNameErr('Enter the lead name.')
        setNameErr(undefined)
        const err = await api.createLead(businessId, { name: s('name'), phone: s('phone'), email: s('email'), source: s('source'), notes: s('notes') })
        setError(err); if (!err) await onDone()
      }}>
        <TextField label="Name" name="name" error={nameErr} /><TextField label="Phone" name="phone" /><TextField label="Email" name="email" type="email" />
        <TextField label="Source" name="source" placeholder="referral, instagram…" /><TextField label="Notes" name="notes" />
        <div className="flex items-end"><Button type="submit">Save lead</Button></div>
        {error && <div className="sm:col-span-3"><ErrorState message={error} /></div>}
      </form>
    </Card>
  )
}

function LeadDialog({ businessId, id, can, onClose, onChanged }: { businessId: string; id: string; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const d = useAsync(() => api.leadDetail(businessId, id), [businessId, id])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const key = useIdempotencyKey()
  if (!d.data) return <Dialog title="Lead" onClose={onClose}>{d.error ? <ErrorState message={d.error} /> : <Spinner />}</Dialog>
  const { lead, interactions, tasks, tags } = d.data
  const parent: Parent = { leadId: id }
  const reload = async () => { await Promise.all([d.refresh(), onChanged()]) }
  const converted = lead.status === 'converted'
  return (
    <Dialog title={lead.name} onClose={onClose} wide>
      {error && <ErrorState message={error} />}
      {result && <Notice>{result}</Notice>}
      <p className="mb-3 text-sm text-ink/70">{[lead.phone, lead.email, lead.source && `via ${lead.source}`].filter(Boolean).join(' · ') || 'No contact details'}</p>
      {lead.notes && <p className="mb-3 text-sm">{lead.notes}</p>}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Badge tone={LEAD_TONE[lead.status]}>{label(lead.status)}</Badge>
        {can('customers.manage') && !converted && (
          <>
            <SelectField label="Change status" value={lead.status} onChange={async (e) => { setError(await api.setLeadStatus(businessId, id, e.target.value as LeadStatus)); await reload() }}>
              {api.LEAD_STATUSES.filter((s) => s !== 'converted').map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </SelectField>
            <Button onClick={async () => {
              const r = await api.convertLead(businessId, id, key.current())
              setError(r.error)
              if (!r.error) { key.renew(); setResult(r.created ? 'Converted: a new customer was created.' : 'Converted: linked to the existing customer with the same email or phone (no duplicate created).'); await reload() }
            }}>Convert to customer</Button>
          </>
        )}
      </div>
      <Tags tags={tags} canEdit={can('customers.manage') && !converted} onAdd={async (n) => { setError(await api.addTag(businessId, parent, n)); await d.refresh() }} onRemove={async (t) => { setError(await api.removeTag(businessId, parent, t)); await d.refresh() }} />
      {can('customers.manage') && !converted && <ActivityForms onNote={async (k, s) => { const e = await api.addInteraction(businessId, parent, k, s); setError(e); if (!e) await d.refresh(); return e }} onTask={async (t, due) => { const e = await api.addTask(businessId, parent, t, due); setError(e); if (!e) await d.refresh(); return e }} />}
      {tasks.length > 0 && <ul className="mt-4 divide-y divide-ink/10 text-sm">{tasks.map((t) => <li key={t.id} className="py-1.5">{t.title} <Badge tone={t.status === 'done' ? 'success' : 'warning'}>{label(t.status)}</Badge></li>)}</ul>}
      <h3 className="mb-1 mt-4 text-sm font-semibold">Interactions</h3>
      {interactions.length === 0 ? <p className="text-sm text-ink/60">Nothing recorded yet.</p> : (
        <ul className="divide-y divide-ink/10 text-sm">{interactions.map((h, i) => <li key={i} className="flex gap-2 py-1.5"><Badge>{label(h.label)}</Badge>{h.detail}<span className="ml-auto text-xs text-ink/50">{dateTime(h.at)}</span></li>)}</ul>
      )}
    </Dialog>
  )
}

// ----------------------------------------------------------------------------- follow-ups
function FollowUps({ businessId, can }: { businessId: string; can: (p: string) => boolean }) {
  const tasks = useAsync(() => api.listOpenTasks(businessId), [businessId])
  const [error, setError] = useState<string | null>(null)
  if (tasks.loading) return <Spinner />
  if (tasks.error) return <ErrorState message={tasks.error} />
  if (!tasks.data?.length) return <EmptyState title="No open follow-ups" description="Schedule follow-ups from a customer or lead." />
  const now = Date.now()
  return (
    <>
      {error && <ErrorState message={error} />}
      <Card className="p-0">
        <ul className="divide-y divide-ink/10 text-sm">
          {tasks.data.map((t) => {
            const overdue = t.dueAt !== null && new Date(t.dueAt).getTime() < now
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 p-3">
                <span><b>{t.title}</b> <span className="text-ink/60">· {t.subject}</span></span>
                {t.dueAt && <Badge tone={overdue ? 'danger' : 'neutral'}>{overdue ? 'Overdue · ' : 'Due '}{dateTime(t.dueAt)}</Badge>}
                {can('customers.manage') && <Button variant="secondary" className="ml-auto" onClick={async () => { setError(await api.setTaskStatus(businessId, t.id, 'done')); await tasks.refresh() }}>Done</Button>}
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}
