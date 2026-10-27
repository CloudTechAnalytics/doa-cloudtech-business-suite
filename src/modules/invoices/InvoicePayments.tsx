import { Copy, Printer } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { printSheets } from '@/shared/print/printSheets'
import { label, naira } from '@/shared/utilities/format'
import { amountChoices, paymentReceiptLinks, receiptNumber } from './invoiceLogic'
import * as api from './invoicesApi'
import type { InvoicePayment, InvoiceRow } from './invoicesApi'

const today = () => new Date().toISOString().slice(0, 10)
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })

/** A payment receipt as the customer receives it: who paid, how much, how, against which invoice, and what is still owed. */
export function PaymentReceiptSheet({ invoice, payment, business }: { invoice: InvoiceRow; payment: InvoicePayment; business: string }) {
  return (
    <article className="receipt-sheet mx-auto max-w-[190mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Payment receipt ${receiptNumber(payment)}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-4 border-double border-ink/70 pb-3">
        <h1 className="text-2xl font-extrabold uppercase tracking-wide">{business}</h1>
        <div className="text-right"><p className="text-lg font-bold uppercase tracking-[0.2em]">Payment receipt</p><p className="font-semibold">{receiptNumber(payment)}</p></div>
      </header>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {([['Received from', invoice.customer || '–'], ['Date received', date(payment.paidOn)], ['Paid by', label(payment.method)], ['For invoice', invoice.number], ['Reference', payment.reference || '–']] as const).map(([k, v]) => (
          <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-5 ml-auto w-full max-w-[17rem] space-y-0.5 text-right">
        <p className="border-t-2 border-ink/60 pt-1 text-base font-extrabold">Amount received <span className="ml-3">{naira(payment.amount)}</span></p>
        <p>Invoice total <b className="ml-3">{naira(invoice.total)}</b></p>
        {invoice.credited > 0 && <p>Credit notes <b className="ml-3">− {naira(invoice.credited)}</b></p>}
        <p>Paid so far <b className="ml-3">{naira(invoice.amountPaid)}</b></p>
        <p className="text-base font-extrabold">{invoice.balance > 0 ? 'Balance still due' : 'Balance'} <span className="ml-3">{naira(invoice.balance)}</span></p>
      </div>
      <p className="mt-6 text-xs text-ink/60">Thank you for your payment.</p>
    </article>
  )
}

/** After a payment is recorded: print the receipt, or send it by WhatsApp or email (your own app opens; DOA sends nothing itself). */
function ReceiptActions({ invoice, payment, business, phone, email }: { invoice: InvoiceRow; payment: InvoicePayment; business: string; phone: string | null; email: string | null }) {
  const links = paymentReceiptLinks(invoice, payment, business, naira, phone, email)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm">
      <p className="mr-auto font-semibold text-success">Payment of {naira(payment.amount)} recorded. {invoice.balance > 0 ? `${naira(invoice.balance)} still due.` : 'The invoice is settled.'}</p>
      <Button variant="secondary" onClick={() => printSheets(<PaymentReceiptSheet invoice={invoice} payment={payment} business={business} />)}><Printer className="size-4" aria-hidden /> Receipt</Button>
      {links.whatsapp && <a className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 font-semibold hover:bg-surface" href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
      {links.mail && <a className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 font-semibold hover:bg-surface" href={links.mail}>Email</a>}
      <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(links.text)}><Copy className="size-4" aria-hidden /> Copy</Button>
    </div>
  )
}

/**
 * Record a payment on a sent invoice: the amount (with one-tap choices: the full balance, half, or what a customer usually pays in a part), how it was paid, the date and a
 * reference. A repeat of the same submit never records twice. When it is saved the receipt is offered straight away.
 */
export function PaymentPanel({ businessId, businessName, invoice, onChanged, onPaid, customer }: { businessId: string; businessName: string; invoice: InvoiceRow; onChanged: () => Promise<void>; onPaid?: () => void; customer?: { phone: string | null; email: string | null } }) {
  const [amount, setAmount] = useState(String(invoice.balance))
  const [method, setMethod] = useState<(typeof api.PAY_METHODS)[number]>('bank_transfer')
  const [paidOn, setPaidOn] = useState(today())
  const [ref, setRef] = useState('')
  const [done, setDone] = useState<InvoicePayment | null>(null)
  const runner = useFormRunner(async () => { setRef(''); await onChanged() })

  async function record() {
    const before = new Set((await api.listInvoicePayments(businessId, invoice.id)).map((p) => p.id))
    const err = await runner.run((key) => api.recordInvoicePayment(businessId, invoice.id, { amount: Number(amount), method, paidOn: paidOn || null, reference: ref }, key), 'Recorded.')
    if (err) return
    const latest = (await api.listInvoicePayments(businessId, invoice.id)).find((p) => !before.has(p.id))
    if (latest) { setDone(latest); onPaid?.() }
  }

  if (done) {
    // The invoice prop is the one from before the payment; re-read it so the receipt shows the new balance.
    return <PaidNotice businessId={businessId} businessName={businessName} invoiceId={invoice.id} fallback={invoice} payment={done} customer={customer} onAnother={() => { setDone(null); runner.clear() }} />
  }
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-2 font-semibold">Record a payment</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <TextField label="Amount (₦)" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Quick amounts">
            {amountChoices(invoice.balance).map((c) => <button key={c.label} type="button" onClick={() => setAmount(String(c.amount))} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-surface">{c.label}</button>)}
          </div>
        </div>
        <div><span className="mb-1 block text-sm font-medium">Paid by</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Paid by">{api.PAY_METHODS.map((m) => <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`rounded-full border px-2.5 py-1 text-xs ${method === m ? 'border-ink bg-ink text-white' : 'border-line hover:bg-surface'}`}>{label(m)}</button>)}</div>
        </div>
        <TextField label="Date received" type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
        <TextField label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" />
      </div>
      {runner.error && <div className="mt-2"><ErrorState title="Not recorded" message={runner.error} /></div>}
      <Button className="mt-3" loading={runner.busy} onClick={() => void record()}>Record payment</Button>
    </div>
  )
}

function PaidNotice({ businessId, businessName, invoiceId, fallback, payment, customer, onAnother }: { businessId: string; businessName: string; invoiceId: string; fallback: InvoiceRow; payment: InvoicePayment; customer?: { phone: string | null; email: string | null }; onAnother: () => void }) {
  const fresh = useAsync(async () => (await api.listInvoices(businessId)).find((i) => i.id === invoiceId) ?? fallback, [businessId, invoiceId])
  const inv = fresh.data ?? fallback
  return (
    <div className="space-y-2">
      <ReceiptActions invoice={inv} payment={payment} business={businessName} phone={customer?.phone ?? null} email={customer?.email ?? null} />
      {inv.balance > 0 && <Button variant="ghost" onClick={onAnother}>Record another payment</Button>}
    </div>
  )
}

/** Record a payment straight from the invoice list, without opening the invoice first. */
export function RecordPaymentDialog({ businessId, businessName, invoice, onClose, onChanged }: { businessId: string; businessName: string; invoice: InvoiceRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const people = useAsync(() => api.listInvoiceCustomers(businessId), [businessId])
  return (
    <Dialog title={`Payment for ${invoice.number}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-ink/70">{invoice.customer} · total {naira(invoice.total)}{invoice.credited > 0 ? ` · credit notes ${naira(invoice.credited)}` : ''}{invoice.amountPaid > 0 ? ` · paid ${naira(invoice.amountPaid)}` : ''} · <b className="text-ink">owes {naira(invoice.balance)}</b></p>
        <PaymentPanel businessId={businessId} businessName={businessName} invoice={invoice} onChanged={onChanged} customer={people.data?.find((p) => p.id === invoice.customerId)} />
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  )
}
