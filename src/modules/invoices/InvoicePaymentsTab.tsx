import clsx from 'clsx'
import { Download, Plus, Printer } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { printSheets } from '@/shared/print/printSheets'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { label, naira } from '@/shared/utilities/format'
import { PaymentReceiptSheet, RecordPaymentDialog } from './InvoicePayments'
import { filterPayments, paymentLines, paymentsExport, payableInvoices, receiptNumber, receivedTotal } from './invoiceLogic'
import * as api from './invoicesApi'
import type { InvoiceRow } from './invoicesApi'

const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Record a payment without knowing which invoice screen to open: choose the invoice that was paid (the ones still owing, biggest first, with a search for the customer or
 * number), then fill in the payment. Anyone who can record payments can use it from the Payments page or the Invoices list.
 */
export function ChooseInvoiceDialog({ businessId, businessName, invoices, onClose, onChanged }: { businessId: string; businessName: string; invoices: InvoiceRow[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<InvoiceRow | null>(null)
  const open = payableInvoices(invoices)
  const term = q.trim().toLowerCase()
  const shown = open.filter((i) => !term || i.customer.toLowerCase().includes(term) || i.number.toLowerCase().includes(term))
  if (picked) return <RecordPaymentDialog businessId={businessId} businessName={businessName} invoice={picked} onClose={onClose} onChanged={onChanged} />
  return (
    <Dialog title="Record a payment" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {open.length === 0 ? (
          <EmptyState title="No invoice is waiting for payment" description="A payment is recorded against an invoice that has been sent. Create an invoice and mark it as sent first." />
        ) : (
          <>
            <p className="text-ink/70">Which invoice was paid?</p>
            <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer or invoice number" autoFocus />
            {shown.length === 0 ? <p className="py-4 text-center text-ink/60">No open invoice matches.</p> : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => setPicked(i)} className="flex w-full flex-wrap items-center gap-x-3 px-3 py-2.5 text-left hover:bg-surface">
                      <span className="font-medium">{i.customer || '–'}</span><span className="text-xs text-ink/60">{i.number}{i.dueOn ? ` · due ${i.dueOn}` : ''}{i.overdue ? ' · overdue' : ''}</span>
                      <span className="tabular ml-auto font-semibold">{naira(i.balance)} <span className="text-xs font-normal text-ink/60">owed</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  )
}

/** Every payment received on invoices, newest first: who paid, which invoice, how, the reference and a receipt to print. Reversed payments stay on the list, struck through. */
export function PaymentsTab({ businessId, businessName, canRecord, onOpenInvoice }: { businessId: string; businessName: string; canRecord: boolean; onOpenInvoice: (invoiceId: string) => void }) {
  const invoices = useAsync(() => api.listInvoices(businessId), [businessId])
  const payments = useAsync(() => api.listAllInvoicePayments(businessId, true), [businessId])
  const [q, setQ] = useState(''); const [method, setMethod] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [status, setStatus] = useState<'all' | 'successful' | 'reversed'>('all')
  const [recording, setRecording] = useState(false)
  const refresh = async () => { await Promise.all([invoices.refresh(), payments.refresh()]) }
  if (invoices.error || payments.error) return <ErrorState message={(invoices.error ?? payments.error)!} />
  if (!invoices.data || !payments.data) return <Spinner />
  const all = paymentLines(payments.data, invoices.data)
  const lines = filterPayments(all, { q, method, from, to, status })
  const waiting = payableInvoices(invoices.data)
  const owed = Math.round(waiting.reduce((a, i) => a + i.balance, 0) * 100) / 100

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="max-w-xl flex-1 text-sm text-ink/70">Every payment received on an invoice. To record a new one, press <b>Record payment</b> and choose the invoice that was paid, or use the button on the invoice itself.</p>
        {canRecord && <Button onClick={() => setRecording(true)}><Plus className="size-4" aria-hidden /> Record payment</Button>}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {([['Received (shown)', naira(receivedTotal(lines)), `${lines.filter((l) => l.payment.status === 'successful').length} payments`], ['Waiting to be paid', naira(owed), `${waiting.length} ${waiting.length === 1 ? 'invoice' : 'invoices'}`], ['Reversed (shown)', String(lines.filter((l) => l.payment.status === 'reversed').length), 'Not counted in what was received']] as const).map(([k, v, n]) => (
          <div key={k} className="rounded-lg border border-line bg-white p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{k}</p><p className="tabular mt-1 text-xl font-semibold">{v}</p><p className="text-xs text-ink/60">{n}</p></div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-60"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, invoice, reference, receipt" /></div>
        <div className="w-40"><SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Any way</option>{api.PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField></div>
        <div className="w-36"><TextField label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-36"><TextField label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="w-36"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All</option><option value="successful">Received</option><option value="reversed">Reversed</option></SelectField></div>
        {lines.length > 0 && <Button variant="secondary" className="ml-auto" onClick={() => downloadCsv('invoice-payments.csv', paymentsExport(lines))}><Download className="size-4" aria-hidden /> Export</Button>}
      </div>
      {lines.length === 0 ? (
        <Card><EmptyState title={all.length ? 'No payments match' : 'No payments yet'} description={all.length ? 'Try clearing the filters.' : 'When a customer pays an invoice and you record it, it shows here with a receipt.'} /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Invoice</th><th className="p-3">Paid by</th><th className="p-3 text-right">Amount</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {lines.map(({ payment: p, invoice: i }) => (
                <tr key={p.id} className={clsx(p.status === 'reversed' && 'text-ink/50')}>
                  <td className="whitespace-nowrap p-3">{date(p.paidOn)}</td>
                  <td className="p-3"><span className={clsx('font-medium', p.status === 'reversed' && 'line-through')}>{i.customer || '–'}</span><div className="text-xs text-ink/60">{receiptNumber(p)}{p.reference ? ` · ${p.reference}` : ''}{p.status === 'reversed' ? ` · reversed: ${p.reversalReason ?? ''}` : ''}</div></td>
                  <td className="p-3"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenInvoice(i.id)}>{i.number}</button></td>
                  <td className="p-3">{label(p.method)}{p.status === 'reversed' && <> <Badge tone="danger">Reversed</Badge></>}</td>
                  <td className={clsx('tabular p-3 text-right', p.status === 'reversed' && 'line-through')}>{naira(p.amount)}</td>
                  <td className="p-3 text-right">{p.status === 'successful' && <Button variant="ghost" onClick={() => printSheets(<PaymentReceiptSheet invoice={i} payment={p} business={businessName} />)}><Printer className="size-4" aria-hidden /> Receipt</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {recording && <ChooseInvoiceDialog businessId={businessId} businessName={businessName} invoices={invoices.data} onClose={() => setRecording(false)} onChanged={refresh} />}
    </>
  )
}
