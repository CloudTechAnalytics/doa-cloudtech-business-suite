import { Download, Printer } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { printSheets } from '@/shared/print/printSheets'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { naira } from '@/shared/utilities/format'
import { BUCKETS, ageing, reminderLinks, statement } from './invoiceLogic'
import type { Statement } from './invoiceLogic'
import * as api from './invoicesApi'

const today = () => new Date().toISOString().slice(0, 10)
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

// ---------------------------------------------------------------------------------------------------- ageing
/** Who owes you, and for how long. Open invoices by customer, grouped by how far past the due date they are. */
export function AgeingTab({ businessId, businessName }: { businessId: string; businessName: string }) {
  const list = useAsync(() => api.listInvoices(businessId), [businessId])
  const people = useAsync(() => api.listInvoiceCustomers(businessId), [businessId])
  if (list.error) return <ErrorState message={list.error} />
  if (!list.data) return <Spinner />
  const a = ageing(list.data, today())
  if (!a.rows.length) return <EmptyState title="Nobody owes you anything" description="When an invoice is sent and not yet paid, it shows here by how late it is." />
  const contact = (id: string) => people.data?.find((p) => p.id === id)
  const remind = (customerId: string) => {
    const open = list.data!.filter((i) => i.customerId === customerId && (i.status === 'sent' || i.status === 'partially_paid') && i.balance > 0)
    const who = contact(customerId)
    const sorted = [...open].sort((x, z) => (x.dueOn ?? x.issuedOn).localeCompare(z.dueOn ?? z.issuedOn))
    return { first: sorted[0], who }
  }
  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-ink/70">Open invoices (sent and not fully paid), counted from their due date; an invoice with no due date counts from the day it was issued. Credit notes and payments are already taken off.</p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Customer</th>{BUCKETS.map(([k, l]) => <th key={k} className="p-3 text-right">{l}</th>)}<th className="p-3 text-right">Total owed</th><th className="p-3" /></tr></thead>
          <tbody className="divide-y divide-ink/10">
            {a.rows.map((r) => {
              const { first, who } = remind(r.customerId)
              const links = first ? reminderLinks(first, businessName, today(), naira, who?.phone ?? null, who?.email ?? null) : null
              return (
                <tr key={r.customerId}>
                  <td className="p-3"><b>{r.customer}</b><div className="text-xs text-ink/60">{r.invoices} {r.invoices === 1 ? 'invoice' : 'invoices'}</div></td>
                  {BUCKETS.map(([k]) => <td key={k} className={`p-3 text-right tabular-nums ${k !== 'current' && r.buckets[k] > 0 ? 'text-danger' : ''}`}>{r.buckets[k] ? naira(r.buckets[k]) : '–'}</td>)}
                  <td className="p-3 text-right font-semibold tabular-nums">{naira(r.total)}</td>
                  <td className="p-3 text-right whitespace-nowrap">{links?.whatsapp && <a className="mr-3 text-xs font-semibold underline" href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}{links?.mail && <a className="text-xs font-semibold underline" href={links.mail}>Email</a>}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-ink/20 bg-surface font-semibold"><tr><td className="p-3">All customers</td>{BUCKETS.map(([k]) => <td key={k} className="p-3 text-right tabular-nums">{a.totals[k] ? naira(a.totals[k]) : '–'}</td>)}<td className="p-3 text-right tabular-nums">{naira(a.total)}</td><td /></tr></tfoot>
        </table>
        <div className="flex justify-end border-t border-ink/10 p-2"><Button variant="ghost" onClick={() => downloadCsv('receivables-ageing.csv', [['Customer', ...BUCKETS.map(([, l]) => l), 'Total owed'], ...a.rows.map((r) => [r.customer, ...BUCKETS.map(([k]) => r.buckets[k]), r.total])])}><Download className="size-4" aria-hidden /> Export (CSV)</Button></div>
      </Card>
      <p className="mt-2 text-xs text-ink/60">WhatsApp and Email open your own app with a reminder for the customer's oldest open invoice. DOA sends nothing itself.</p>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------- statements
export function StatementSheet({ business, customer, s, from, to }: { business: string; customer: string; s: Statement; from: string; to: string }) {
  return (
    <article className="receipt-sheet mx-auto max-w-[190mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Statement for ${customer}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-4 border-double border-ink/70 pb-3">
        <h1 className="text-2xl font-extrabold uppercase tracking-wide">{business}</h1>
        <div className="text-right"><p className="text-lg font-bold uppercase tracking-[0.2em]">Statement</p><p className="text-xs">{from || to ? `${from ? date(from) : 'Start'} to ${to ? date(to) : date(today())}` : `As at ${date(today())}`}</p></div>
      </header>
      <p className="mt-3"><span className="text-[10px] uppercase tracking-wide text-ink/55">Account of</span><br /><b className="text-base">{customer}</b></p>
      <table data-keep-table className="mt-4 w-full border-collapse text-left">
        <thead><tr className="border-b-2 border-ink/60 text-[11px] uppercase tracking-wide"><th className="py-1">Date</th><th className="py-1">Document</th><th className="py-1">Details</th><th className="py-1 text-right">Billed</th><th className="py-1 text-right">Paid / credited</th><th className="py-1 text-right">Balance</th></tr></thead>
        <tbody>
          {from && <tr className="border-b border-ink/15 italic"><td className="py-1.5" colSpan={5}>Balance brought forward</td><td className="py-1.5 text-right">{naira(s.opening)}</td></tr>}
          {s.lines.map((l, i) => <tr key={i} className="border-b border-ink/15"><td className="py-1.5 whitespace-nowrap">{date(l.date)}</td><td className="py-1.5">{l.reference}</td><td className="py-1.5">{l.detail}</td><td className="py-1.5 text-right">{l.charge ? naira(l.charge) : ''}</td><td className="py-1.5 text-right">{l.credit ? naira(l.credit) : ''}</td><td className="py-1.5 text-right">{naira(l.balance)}</td></tr>)}
        </tbody>
      </table>
      <p className="mt-3 text-right text-base font-extrabold">Balance owing <span className="ml-3">{naira(s.closing)}</span></p>
    </article>
  )
}

/** What one customer has been billed and has paid, with a running balance. Print it or save it as a PDF to send. */
export function StatementsTab({ businessId, businessName }: { businessId: string; businessName: string }) {
  const people = useAsync(() => api.listInvoiceCustomers(businessId), [businessId])
  const data = useAsync(async () => { const [invoices, payments, notes] = await Promise.all([api.listInvoices(businessId), api.listAllInvoicePayments(businessId), api.listCreditNotes(businessId)]); return { invoices, payments, notes } }, [businessId])
  const [customerId, setCustomerId] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  if (data.error) return <ErrorState message={data.error} />
  if (!data.data || !people.data) return <Spinner />
  const billed = new Set(data.data.invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled').map((i) => i.customerId))
  const choices = people.data.filter((p) => billed.has(p.id))
  const who = choices.find((p) => p.id === customerId)
  const s = who ? statement(data.data.invoices, data.data.payments, data.data.notes, who.id, from, to) : null
  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-ink/70">A customer's account: every invoice sent to them, every payment and credit note, and what is owed now. Draft and cancelled invoices are left out.</p>
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <SelectField label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose a customer</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <TextField label="From (optional)" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To (optional)" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {choices.length === 0 && <EmptyState title="No customers billed yet" description="Once an invoice has been sent to a customer, their statement is available here." />}
      {who && s && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button onClick={() => printSheets(<StatementSheet business={businessName} customer={who.name} s={s} from={from} to={to} />)}><Printer className="size-4" aria-hidden /> Print or save as PDF</Button>
            <Button variant="secondary" onClick={() => downloadCsv(`statement-${who.name.replace(/\W+/g, '-').toLowerCase()}.csv`, [['Date', 'Document', 'Details', 'Billed', 'Paid or credited', 'Balance'], ...s.lines.map((l) => [l.date, l.reference, l.detail, l.charge || null, l.credit || null, l.balance])])}><Download className="size-4" aria-hidden /> Export (CSV)</Button>
          </div>
          <StatementSheet business={businessName} customer={who.name} s={s} from={from} to={to} />
        </>
      )}
    </>
  )
}
