import clsx from 'clsx'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { useIdempotencyKey } from '@/shared/hooks/useIdempotencyKey'
import { DataTable } from '@/shared/tables/DataTable'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { myTradePermissions } from '@/modules/sales/tradeApi'
import { ActivityForms, Tags } from './CrmParts'
import { CustomerProfile } from './CustomerProfile'
import * as api from './crmApi'
import type { CustomerRow, LeadRow, LeadStatus, Parent } from './crmApi'
import { DeleteButton } from '@/shared/components/delete-button'

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
        <TextField label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Name, company, phone or email" />
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
          { key: 'name', header: 'Customer', render: (r) => <><b>{r.name}</b>{r.company && <span className="text-ink/70"> · {r.company}</span>}<div className="text-xs text-ink/60">{[r.phone ?? r.email, r.city].filter(Boolean).join(' · ') || 'No contact'}</div></> },
          { key: 'category', header: 'Category', render: (r) => r.category ?? '–' },
          { key: 'orders', header: 'Orders', align: 'right', render: (r) => r.summary.orders },
          { key: 'spent', header: 'Total spent', align: 'right', render: (r) => naira(r.summary.lifetimeSpend) },
          { key: 'owes', header: 'Owes', align: 'right', render: (r) => (r.outstanding > 0 ? <span className="text-warning">{naira(r.outstanding)}</span> : naira(0)) },
          { key: 'last', header: 'Last purchase', render: (r) => (r.summary.lastPurchaseAt ? r.summary.lastPurchaseAt.slice(0, 10) : '–') },
        ]}
      />
      {open && <CustomerProfile businessId={businessId} id={open} can={can} onClose={() => setOpen(null)} onChanged={list.refresh} />}
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
    const err = await api.createCustomer(businessId, { name: s('name'), phone: s('phone'), email: s('email'), source: s('source'), category: s('category'), company: s('company'), city: s('city'), address: s('address') })
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
        <TextField label="Company" name="company" />
        <TextField label="City" name="city" />
        <div className="sm:col-span-3"><TextField label="Address" name="address" /></div>
        <div className="flex items-end"><Button type="submit">Save customer</Button></div>
        {error && <div className="sm:col-span-3"><ErrorState message={error} /></div>}
      </form>
    </Card>
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
  if (!d.data) return <DetailPage title="Lead" onClose={onClose}>{d.error ? <ErrorState message={d.error} /> : <Spinner />}</DetailPage>
  const { lead, interactions, tasks, tags } = d.data
  const parent: Parent = { leadId: id }
  const reload = async () => { await Promise.all([d.refresh(), onChanged()]) }
  const converted = lead.status === 'converted'
  return (
    <DetailPage title={lead.name} onClose={onClose} wide actions={can('customers.manage') ? <DeleteButton businessId={businessId} kind="lead" id={id} label={lead.name} noun="lead" onDeleted={async () => { await onChanged(); onClose() }} /> : undefined}>
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
    </DetailPage>
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
