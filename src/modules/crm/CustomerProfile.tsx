import clsx from 'clsx'
import { Pencil } from 'lucide-react'
import { Suspense, useState } from 'react'
import type { FormEvent } from 'react'
import { getIndustry } from '@/core/industry-registry'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, ErrorState, Notice, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { dateTime, label, naira } from '@/shared/utilities/format'
import { setCreditLimit } from '@/modules/sales/tradeApi'
import { ActivityForms, Tags } from './CrmParts'
import * as api from './crmApi'
import type { CustomerRow, Parent } from './crmApi'

const dayOf = (v: string | null) => (v ? v.slice(0, 10) : '–')

function Stat({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{title}</p>
      <p className={clsx('tabular mt-1 text-lg font-semibold', tone === 'warn' && 'text-warning')}>{value}</p>
      {note && <p className="text-xs text-ink/60">{note}</p>}
    </div>
  )
}

function Overview({ c, can, businessId, onSaved, setError, tags, addTag, removeTag }: { c: CustomerRow; can: (p: string) => boolean; businessId: string; onSaved: () => Promise<void>; setError: (e: string | null) => void; tags: { id: string; name: string }[]; addTag: (n: string) => Promise<void>; removeTag: (id: string) => Promise<void> }) {
  const [editingDetails, setEditingDetails] = useState(false)
  const edit = can('customers.manage')
  const s = c.summary
  const avg = s.orders ? s.lifetimeSpend / s.orders : null
  const used = c.creditLimit > 0 ? Math.min(c.outstanding / c.creditLimit, 1) : null
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const v = (k: string) => String(f.get(k) ?? '')
    if (!v('name').trim()) return setError('Enter the customer name.')
    const err = await api.updateCustomer(businessId, c.id, { name: v('name'), phone: v('phone'), email: v('email'), source: v('source'), category: v('category'), company: v('company'), contactPerson: v('contact'), city: v('city'), address: v('address'), notes: v('notes') })
    setError(err)
    if (!err) { setEditingDetails(false); await onSaved() }
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat title="Total spent" value={naira(s.lifetimeSpend)} note="After returns, excluding tax" />
        <Stat title="Orders" value={String(s.orders)} />
        <Stat title="Average order" value={avg === null ? '–' : naira(avg)} />
        <Stat title="Last purchase" value={dayOf(s.lastPurchaseAt)} />
        <Stat title="Customer since" value={dayOf(c.createdAt)} note={s.firstPurchaseAt ? `First sale ${dayOf(s.firstPurchaseAt)}` : undefined} />
        <Stat title="Owes you" value={naira(c.outstanding)} tone={c.outstanding > 0 ? 'warn' : undefined} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Credit</h3>
            <p className="text-xs text-ink/60">{c.creditLimit > 0 ? `${naira(Math.max(c.creditLimit - c.outstanding, 0))} available of ${naira(c.creditLimit)}` : 'No credit allowed: they must pay in full.'}</p>
          </div>
          <div className="text-sm">
            Limit{' '}
            {can('customers.credit') ? (
              <input aria-label="Credit limit" type="number" min="0" step="1" defaultValue={c.creditLimit} className="tabular w-32 rounded border border-ink/20 px-2 py-1"
                onBlur={async (e) => { const v = Number(e.target.value); if (v !== c.creditLimit) { setError(await setCreditLimit(businessId, c.id, v)); await onSaved() } }} />
            ) : <b className="tabular">{naira(c.creditLimit)}</b>}
          </div>
        </div>
        {used !== null && <div className="mt-2 h-2 rounded-full bg-canvas" role="img" aria-label={`${Math.round(used * 100)}% of the credit limit used`}><div className={clsx('h-2 rounded-full', used >= 0.9 ? 'bg-danger' : 'bg-amber')} style={{ width: `${Math.max(used * 100, 2)}%` }} /></div>}
      </Card>
      <Tags tags={tags} canEdit={edit} onAdd={addTag} onRemove={removeTag} />
      {!editingDetails ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Details</h3>
            {edit && <button type="button" onClick={() => setEditingDetails(true)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface"><Pencil className="size-4" aria-hidden /> Edit</button>}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-ink/60">Name</dt><dd className="whitespace-pre-wrap text-sm">{c.name || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Company</dt><dd className="whitespace-pre-wrap text-sm">{c.company || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Contact person</dt><dd className="whitespace-pre-wrap text-sm">{c.contactPerson || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Phone</dt><dd className="whitespace-pre-wrap text-sm">{c.phone || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Email</dt><dd className="whitespace-pre-wrap text-sm">{c.email || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">City</dt><dd className="whitespace-pre-wrap text-sm">{c.city || '–'}</dd></div>
            <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-ink/60">Address</dt><dd className="text-sm">{c.address || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Category</dt><dd className="whitespace-pre-wrap text-sm">{c.category || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">How they found you</dt><dd className="whitespace-pre-wrap text-sm">{c.source || '–'}</dd></div>
            <div><dt className="text-xs text-ink/60">Customer since</dt><dd className="whitespace-pre-wrap text-sm">{dayOf(c.createdAt) || '–'}</dd></div>
            <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-ink/60">Notes</dt><dd className="whitespace-pre-wrap text-sm">{c.notes || '–'}</dd></div>
          </dl>
          {!edit && <Notice>Your role can view customers but not change their details.</Notice>}
        </section>
      ) : (
      <form onSubmit={save} noValidate className="space-y-3" key={c.id + c.name + (c.notes ?? '')}>
        <h3 className="text-sm font-semibold">Edit details</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Name" name="name" defaultValue={c.name} />
          <TextField label="Company" name="company" defaultValue={c.company ?? ''} />
          <TextField label="Contact person" name="contact" defaultValue={c.contactPerson ?? ''} />
          <TextField label="Phone" name="phone" defaultValue={c.phone ?? ''} />
          <TextField label="Email" name="email" type="email" defaultValue={c.email ?? ''} />
          <TextField label="City" name="city" defaultValue={c.city ?? ''} />
          <div className="sm:col-span-3"><TextField label="Address" name="address" defaultValue={c.address ?? ''} /></div>
          <TextField label="Category" name="category" defaultValue={c.category ?? ''} placeholder="Retailer, Wholesale…" />
          <TextField label="How they found you" name="source" defaultValue={c.source ?? ''} placeholder="walk-in, referral…" />
          <div className="sm:col-span-3"><label className="block text-sm font-medium">Notes<textarea name="notes" defaultValue={c.notes ?? ''} maxLength={2000} rows={3} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" /></label></div>
        </div>
        <div className="flex items-center gap-3"><Button type="submit">Save changes</Button><Button type="button" variant="secondary" onClick={() => setEditingDetails(false)}>Cancel</Button></div>
      </form>
      )}
    </div>
  )
}

/** A customer's profile: details you can edit, what they spend, what they buy, what they owe, and the notes and follow-ups kept about them.
 *  Each industry may add its own tab (farm orders, pharmacy prescriptions, credit account) through its customerSections. */
export function CustomerProfile({ businessId, id, can, onClose, onChanged }: { businessId: string; id: string; can: (p: string) => boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { active } = useBusiness()
  const d = useAsync(() => api.customerDetail(businessId, id), [businessId, id])
  const top = useAsync(() => api.customerTopProducts(businessId, id), [businessId, id])
  const sections = active ? getIndustry(active.industry).customerSections ?? [] : []
  const [tab, setTab] = useState('overview')
  const [error, setError] = useState<string | null>(null)
  if (!d.data) return <DetailPage title="Customer" onClose={onClose}>{d.error ? <ErrorState message={d.error} /> : <Spinner />}</DetailPage>
  const { customer: c, history, tasks, tags } = d.data
  const parent: Parent = { customerId: id }
  const reload = async () => { await Promise.all([d.refresh(), onChanged()]) }
  const tabs = [{ id: 'overview', title: 'Overview' }, { id: 'purchases', title: 'Purchases' }, { id: 'activity', title: 'Activity' }, ...sections.map((s) => ({ id: s.id, title: s.title }))]
  const section = sections.find((s) => s.id === tab)

  return (
    <DetailPage title={c.name} onClose={onClose} wide>
      <div role="tablist" aria-label="Customer sections" className="mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', tab === t.id ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t.title}</button>
        ))}
      </div>
      {error && <ErrorState message={error} />}

      {tab === 'overview' && <Overview c={c} can={can} businessId={businessId} onSaved={reload} setError={setError} tags={tags} addTag={async (n) => { setError(await api.addTag(businessId, parent, n)); await d.refresh() }} removeTag={async (t) => { setError(await api.removeTag(businessId, parent, t)); await d.refresh() }} />}

      {tab === 'purchases' && (
        <div className="space-y-5">
          <div>
            <h3 className="mb-1 text-sm font-semibold">What they buy</h3>
            {top.loading ? <Spinner /> : !top.data?.length ? <p className="text-sm text-ink/60">No purchases yet.</p> : (
              <ul className="divide-y divide-ink/10 text-sm">{top.data.map((p) => <li key={p.product} className="flex justify-between py-1.5"><span>{p.product}</span><span className="tabular text-ink/70">{p.units} units · {naira(p.revenue)}</span></li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Sales</h3>
            {history.filter((h) => h.kind === 'sale').length === 0 ? <p className="text-sm text-ink/60">No sales recorded for this customer.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Sale</th><th className="py-1">Date</th><th className="py-1">Status</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Owing</th></tr></thead>
                <tbody className="divide-y divide-ink/10">
                  {history.filter((h) => h.kind === 'sale').map((h) => (
                    <tr key={h.detail}><td className="py-1.5 font-medium">{h.detail}</td><td className="py-1.5">{dayOf(h.at)}</td><td className="py-1.5"><Badge tone={h.label === 'voided' ? 'danger' : h.label === 'refunded' ? 'warning' : 'neutral'}>{label(h.label)}</Badge></td>
                      <td className="tabular py-1.5 text-right">{naira(h.amount ?? 0)}</td><td className="tabular py-1.5 text-right">{h.balance ? <span className="text-warning">{naira(h.balance)}</span> : '–'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-4">
          {can('customers.manage') && <ActivityForms onNote={async (k, s) => { const e = await api.addInteraction(businessId, parent, k, s); setError(e); if (!e) await d.refresh(); return e }} onTask={async (t, due) => { const e = await api.addTask(businessId, parent, t, due); setError(e); if (!e) await d.refresh(); return e }} />}
          {tasks.some((t) => t.status === 'open') && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Open follow-ups</h3>
              <ul className="divide-y divide-ink/10 text-sm">
                {tasks.filter((t) => t.status === 'open').map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5"><span>{t.title}{t.dueAt && <span className="ml-2 text-xs text-ink/60">due {dateTime(t.dueAt)}</span>}</span>
                    {can('customers.manage') && <Button variant="secondary" className="ml-auto" onClick={async () => { setError(await api.setTaskStatus(businessId, t.id, 'done')); await d.refresh() }}>Done</Button>}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-sm font-semibold">Timeline</h3>
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
          </div>
        </div>
      )}

      {section && <Suspense fallback={<Spinner />}><section.component businessId={businessId} customerId={id} customerName={c.name} /></Suspense>}
    </DetailPage>
  )

}
