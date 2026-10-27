import { Plus, Printer, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { UsageNotice } from '@/core/subscriptions/UsageViews'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { printSheets } from '@/shared/print/printSheets'
import { label, naira, qty } from '@/shared/utilities/format'
import * as api from './invoicesApi'
import type { InvoiceLine, InvoiceRow, InvoiceStatus } from './invoicesApi'

const TONE: Record<InvoiceStatus | 'overdue', 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { draft: 'neutral', sent: 'info', partially_paid: 'warning', paid: 'success', cancelled: 'danger', overdue: 'danger' }
const FILTERS = ['all', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'] as const
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
const shown = (i: InvoiceRow): InvoiceStatus | 'overdue' => (i.overdue ? 'overdue' : i.status)
const money = (n: number) => Math.round(n * 100) / 100

/** The invoice as the customer receives it: business, number and dates, who it is for, the lines, tax and total, what has been paid and what is left. */
export function InvoiceSheet({ invoice, business }: { invoice: InvoiceRow; business: string }) {
  const stamp = invoice.status === 'paid' ? 'Paid' : invoice.status === 'cancelled' ? 'Cancelled' : null
  return (
    <article className="receipt-sheet relative mx-auto max-w-[190mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Invoice ${invoice.number}`}>
      {stamp && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center"><span className="-rotate-12 rounded-md border-4 border-ink/20 px-6 py-2 text-5xl font-extrabold uppercase tracking-widest text-ink/10">{stamp}</span></div>}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-4 border-double border-ink/70 pb-3">
        <h1 className="text-2xl font-extrabold uppercase tracking-wide">{business}</h1>
        <div className="text-right"><p className="text-lg font-bold uppercase tracking-[0.2em]">Invoice</p><p className="font-semibold">{invoice.number}</p></div>
      </header>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {([['Billed to', invoice.customer || '–'], ['Invoice date', date(invoice.issuedOn)], ['Due date', invoice.dueOn ? date(invoice.dueOn) : 'On receipt']] as const).map(([k, v]) => (
          <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
      <table data-keep-table className="mt-4 w-full border-collapse text-left">
        <thead><tr className="border-b-2 border-ink/60 text-[11px] uppercase tracking-wide"><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{invoice.lines.map((l, i) => <tr key={i} className="border-b border-ink/15"><td className="py-1.5">{l.description}</td><td className="py-1.5 text-right">{qty(l.quantity)}</td><td className="py-1.5 text-right">{naira(l.unitPrice)}</td><td className="py-1.5 text-right">{naira(money(l.quantity * l.unitPrice))}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 ml-auto w-full max-w-[17rem] space-y-0.5 text-right">
        <p>Subtotal <b className="ml-3">{naira(invoice.subtotal)}</b></p>
        {invoice.discount > 0 && <p>Discount <b className="ml-3">− {naira(invoice.discount)}</b></p>}
        {invoice.taxPercent > 0 && <p>Tax ({invoice.taxPercent}%) <b className="ml-3">{naira(invoice.taxAmount)}</b></p>}
        <p className="border-t-2 border-ink/60 pt-1 text-base font-extrabold">Total <span className="ml-3">{naira(invoice.total)}</span></p>
        {invoice.amountPaid > 0 && <p>Paid <b className="ml-3">− {naira(invoice.amountPaid)}</b></p>}
        <p className="text-base font-extrabold">Balance due <span className="ml-3">{naira(invoice.balance)}</span></p>
      </div>
      {invoice.notes && <p className="mt-4 whitespace-pre-line rounded border border-ink/30 p-2.5 text-[12px]"><b>Notes: </b>{invoice.notes}</p>}
    </article>
  )
}
export const printInvoice = (invoice: InvoiceRow, business: string) => printSheets(<InvoiceSheet invoice={invoice} business={business} />)

export function InvoicesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const perms = usePermissions(businessId)
  const list = useAsync(() => api.listInvoices(businessId), [businessId])
  const summary = useAsync(() => api.invoiceSummary(businessId), [businessId])
  const ready = useAsync(async () => api.quotesReadyToInvoice(businessId, await api.listInvoices(businessId)), [businessId])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<InvoiceRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!active) return null
  const manage = perms.can('invoices.manage')
  const refresh = async () => { await Promise.all([list.refresh(), summary.refresh(), ready.refresh()]) }
  const rows = (list.data ?? []).filter((i) => (filter === 'all' || (filter === 'overdue' ? i.overdue : i.status === filter)) && (!q.trim() || [i.number, i.customer].some((v) => v.toLowerCase().includes(q.trim().toLowerCase()))))
  const s = summary.data
  return (
    <>
      <PageHeader title="Invoices" description="Bill your customers, record what they pay and see what is still owed. Payments appear in Finance without being entered again." />
      <UsageNotice keys={['invoices_per_month', 'customers']} />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([['Outstanding', naira(s.outstanding), 'Sent and not fully paid'], ['Overdue', naira(s.overdue), `${s.overdueCount} ${s.overdueCount === 1 ? 'invoice' : 'invoices'} past due`], ['Received this month', naira(s.paidThisMonth), 'Invoice payments'], ['Drafts', String(s.drafts), 'Not sent yet']] as const).map(([t, v, h]) => (
            <div key={t} className="rounded-lg border border-line bg-white p-3"><p className="text-xs uppercase tracking-wide text-ink/60">{t}</p><p className="mt-0.5 text-xl font-bold">{v}</p><p className="text-xs text-ink/60">{h}</p></div>
          ))}
        </div>
      )}
      {(error || list.error) && <ErrorState message={error ?? list.error!} />}
      {manage && (ready.data?.length ?? 0) > 0 && (
        <Card className="mb-4"><p className="mb-2 text-sm font-semibold">Accepted quotes ready to invoice</p>
          <ul className="divide-y divide-ink/10 text-sm">{ready.data!.map((qt) => (
            <li key={qt.id} className="flex flex-wrap items-center gap-2 py-2"><span><b>{qt.number}</b> <span className="text-ink/70">· {qt.contact || '–'} · {naira(qt.total)}</span></span>
              <Button variant="secondary" className="ml-auto" onClick={async () => { setError(await api.invoiceFromQuote(businessId, qt.id)); await refresh() }}>Create invoice</Button></li>
          ))}</ul>
        </Card>
      )}
      <div className="mb-3 grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice number or customer" />
        <SelectField label="Show" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>{FILTERS.map((f) => <option key={f} value={f}>{f === 'all' ? 'All invoices' : label(f)}</option>)}</SelectField>
        {manage && <Button onClick={() => setOpen('new')}>New invoice</Button>}
      </div>
      {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <EmptyState title={list.data?.length ? 'No invoices match' : 'No invoices yet'} description="Create an invoice for a customer, or turn an accepted CRM quote into one." /> : (
        <ul className="divide-y divide-ink/10 rounded-lg border border-line bg-white text-sm">
          {rows.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 p-3">
              <button className="text-left" onClick={() => setOpen(i)}><b>{i.number}</b> <span className="text-ink/70">· {i.customer || '–'}</span><span className="block text-xs text-ink/60">{naira(i.total)}{i.status !== 'draft' && i.status !== 'cancelled' ? ` · owes ${naira(i.balance)}` : ''}{i.dueOn ? ` · due ${i.dueOn}` : ''}</span></button>
              <Badge tone={TONE[shown(i)]}>{label(shown(i))}</Badge>
            </li>
          ))}
        </ul>
      )}
      {open && <InvoiceDialog businessId={businessId} businessName={active.name} invoice={open === 'new' ? null : open} manage={manage} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  )
}

const blank = () => ({ description: '', quantity: '1', unitPrice: '' })

function InvoiceDialog({ businessId, businessName, invoice, manage, onClose, onChanged }: { businessId: string; businessName: string; invoice: InvoiceRow | null; manage: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  // The dialog keeps its own copy so it can show the new status after an action without closing.
  const fresh = useAsync(async () => (invoice ? (await api.listInvoices(businessId)).find((x) => x.id === invoice.id) ?? invoice : null), [businessId, invoice?.id])
  const cur = fresh.data ?? invoice
  const reload = async () => { await fresh.refresh(); await onChanged() }
  if (!cur) return <EditDraft businessId={businessId} invoice={null} onClose={onClose} onSaved={async () => { await onChanged(); onClose() }} />
  if (cur.status === 'draft') return <EditDraft businessId={businessId} businessName={businessName} invoice={cur} manage={manage} onClose={onClose} onSaved={async () => { await reload() }} onSent={async () => { await reload() }} />
  return <ViewInvoice businessId={businessId} businessName={businessName} invoice={cur} manage={manage} onClose={onClose} onChanged={reload} />
}

function EditDraft({ businessId, businessName, invoice, manage = true, onClose, onSaved, onSent }: { businessId: string; businessName?: string; invoice: InvoiceRow | null; manage?: boolean; onClose: () => void; onSaved: () => Promise<void>; onSent?: () => Promise<void> }) {
  const customers = useAsync(() => api.listInvoiceCustomers(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState(''); const [newPhone, setNewPhone] = useState(''); const [newEmail, setNewEmail] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? '')
  const [due, setDue] = useState(invoice?.dueOn ?? '')
  const [lines, setLines] = useState(invoice ? invoice.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) : [blank()])
  const [discount, setDiscount] = useState(invoice && invoice.discount ? String(invoice.discount) : '')
  const [tax, setTax] = useState(invoice && invoice.taxPercent ? String(invoice.taxPercent) : '')
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const runner = useFormRunner(onSaved)
  const parsed: InvoiceLine[] = lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
  const subtotal = parsed.reduce((a, l) => a + (l.quantity > 0 && l.unitPrice >= 0 ? money(l.quantity * l.unitPrice) : 0), 0)
  const afterDiscount = Math.max(0, subtotal - Number(discount || 0))
  const total = money(afterDiscount + (afterDiscount * Number(tax || 0)) / 100)
  const set = (i: number, k: 'description' | 'quantity' | 'unitPrice', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const input = { id: invoice?.id ?? null, customerId, dueOn: due || null, lines: parsed, discount: Number(discount || 0), taxPercent: Number(tax || 0), notes }
  const sender = useFormRunner(async () => { await onSent?.() })
  return (
    <Dialog title={invoice ? `Draft ${invoice.number}` : 'New invoice'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!manage}>
            <option value="">Choose a customer</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <TextField label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={!manage} />
        </div>
        {manage && !adding && <button type="button" className="text-xs font-semibold text-accent underline" onClick={() => setAdding(true)}>Customer not in the list? Add a new customer</button>}
        {manage && adding && (
          <div className="rounded-lg border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-3"><TextField label="Customer name" value={newName} onChange={(e) => setNewName(e.target.value)} /><TextField label="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} /><TextField label="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
            {addError && <div className="mt-2"><ErrorState title="Not added" message={addError} /></div>}
            <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => { setAdding(false); setAddError(null) }}>Cancel</Button>
              <Button onClick={async () => { const r = await api.addInvoiceCustomer(businessId, { name: newName, phone: newPhone, email: newEmail }); setAddError(r.error); if (!r.error && r.id) { await customers.refresh(); setCustomerId(r.id); setAdding(false); setNewName(''); setNewPhone(''); setNewEmail('') } }}>Add customer</Button></div>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Lines</p>
          <ul className="space-y-2">{lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2 max-sm:grid-cols-2">
              <input aria-label={`Line ${i + 1} description`} placeholder="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} disabled={!manage} className="rounded-md border border-line px-2 py-1.5 max-sm:col-span-2" />
              <input aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} disabled={!manage} className="rounded-md border border-line px-2 py-1.5" />
              <input aria-label={`Line ${i + 1} unit price`} type="number" min={0} step="any" placeholder="Price" value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} disabled={!manage} className="rounded-md border border-line px-2 py-1.5" />
              {manage && lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1.5 text-ink/50 hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>}
            </li>
          ))}</ul>
          {manage && <Button variant="secondary" className="mt-2" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" aria-hidden /> Add line</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3"><TextField label="Discount (₦)" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={!manage} /><TextField label="Tax (%)" type="number" min={0} max={100} value={tax} onChange={(e) => setTax(e.target.value)} disabled={!manage} /><p className="self-end text-right">Total <b className="text-base">{naira(total)}</b></p></div>
        <TextField label="Notes shown on the invoice" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!manage} />
        {(runner.error || sender.error) && <ErrorState title="Not saved" message={(runner.error || sender.error)!} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {manage && <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => api.saveInvoice(businessId, input), 'Saved.')}>Save draft</Button>}
          {manage && invoice && <Button loading={sender.busy} onClick={() => void sender.run(async () => (await api.saveInvoice(businessId, input)) ?? (await api.sendInvoice(businessId, invoice.id)), 'Sent.')}>Save and mark as sent</Button>}
          {invoice && businessName && <Button variant="secondary" onClick={() => printInvoice(invoice, businessName)}><Printer className="size-4" aria-hidden /> Print</Button>}
        </div>
      </div>
    </Dialog>
  )
}

function ViewInvoice({ businessId, businessName, invoice, manage, onClose, onChanged }: { businessId: string; businessName: string; invoice: InvoiceRow; manage: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const payments = useAsync(() => api.listInvoicePayments(businessId, invoice.id), [businessId, invoice.id, invoice.amountPaid, invoice.status])
  const [amount, setAmount] = useState(String(invoice.balance))
  const [method, setMethod] = useState<(typeof api.PAY_METHODS)[number]>('bank_transfer')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const [reversing, setReversing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const payRunner = useFormRunner(async () => { setRef(''); await onChanged() })
  const otherRunner = useFormRunner(onChanged)
  const canPay = manage && (invoice.status === 'sent' || invoice.status === 'partially_paid')
  return (
    <Dialog title={`Invoice ${invoice.number}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[shown(invoice)]}>{label(shown(invoice))}</Badge><span className="text-ink/70">{invoice.customer} · {naira(invoice.total)}{invoice.dueOn ? ` · due ${invoice.dueOn}` : ''}</span></div>
        <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-md bg-surface p-2"><p className="text-[11px] uppercase text-ink/60">Total</p><b>{naira(invoice.total)}</b></div><div className="rounded-md bg-surface p-2"><p className="text-[11px] uppercase text-ink/60">Paid</p><b>{naira(invoice.amountPaid)}</b></div><div className="rounded-md bg-surface p-2"><p className="text-[11px] uppercase text-ink/60">Balance</p><b>{naira(invoice.balance)}</b></div></div>
        {invoice.status === 'cancelled' && <p className="rounded-md bg-surface px-3 py-2 text-xs">Cancelled: {invoice.cancelReason}</p>}
        {canPay && (
          <div className="rounded-lg border border-line p-3">
            <p className="mb-2 font-semibold">Record a payment</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <TextField label="Amount (₦)" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value as (typeof api.PAY_METHODS)[number])}>{api.PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
              <TextField label="Date received" type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} />
              <TextField label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" />
            </div>
            {payRunner.error && <div className="mt-2"><ErrorState title="Not recorded" message={payRunner.error} /></div>}
            <Button className="mt-2" loading={payRunner.busy} onClick={() => void payRunner.run((key) => api.recordInvoicePayment(businessId, invoice.id, { amount: Number(amount), method, paidOn: paidOn || null, reference: ref }, key), 'Recorded.')}>Record payment</Button>
          </div>
        )}
        {(payments.data?.length ?? 0) > 0 && (
          <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Payments</p>
            <ul className="divide-y divide-ink/10">{payments.data!.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className={p.status === 'reversed' ? 'text-ink/50 line-through' : ''}>{naira(p.amount)} · {label(p.method)} · {p.paidOn}{p.reference ? ` · ${p.reference}` : ''}</span>
                {p.status === 'reversed' ? <Badge tone="danger">Reversed: {p.reversalReason}</Badge> : manage && <Button variant="secondary" className="ml-auto" onClick={() => { setReversing(p.id); setReason('') }}>Reverse</Button>}</li>
            ))}</ul></div>
        )}
        {(reversing || cancelling) && (
          <div className="rounded-lg border border-line p-3"><TextField label={reversing ? 'Why is this payment being reversed?' : 'Why is this invoice being cancelled?'} value={reason} onChange={(e) => setReason(e.target.value)} />
            {otherRunner.error && <div className="mt-2"><ErrorState title="Not done" message={otherRunner.error} /></div>}
            <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => { setReversing(null); setCancelling(false) }}>Back</Button>
              <Button loading={otherRunner.busy} onClick={() => void otherRunner.run(async () => (reversing ? api.reverseInvoicePayment(businessId, reversing, reason) : api.cancelInvoice(businessId, invoice.id, reason)), 'Done.', () => { setReversing(null); setCancelling(false) })}>{reversing ? 'Reverse payment' : 'Cancel invoice'}</Button></div></div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {manage && invoice.status !== 'cancelled' && invoice.status !== 'paid' && !cancelling && <Button variant="secondary" onClick={() => { setCancelling(true); setReversing(null); setReason('') }}>Cancel invoice</Button>}
          <Button variant="secondary" onClick={() => printInvoice(invoice, businessName)}><Printer className="size-4" aria-hidden /> Print or save as PDF</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  )
}
