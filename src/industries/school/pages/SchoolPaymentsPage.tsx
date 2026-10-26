import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { ReceiptSheet, printReceipt, receiptData } from '../components/ReceiptSheet'
import { downloadCsv, useSchool } from '../components/schoolUi'
import { PAY_METHODS, loadBills, loadPayments, recordPayment, reversePayment } from '../services/schoolApi'
import type { BillRow } from '../services/schoolApi'

/** Record a payment against a bill. The amount can never be more than what is still owed. */
export function PaymentDialog({ ctx, bill, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; bill: BillRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [amount, setAmount] = useState(String(bill.balance)); const [method, setMethod] = useState('cash'); const [ref, setRef] = useState('')
  return (
    <Dialog title={`Record payment · ${bill.studentName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink/70">Bill {bill.number} · still owed <b>{naira(bill.balance)}</b></p>
        <TextField label="Amount (₦)" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <SelectField label="How was it paid?" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
        <TextField label="Reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transfer or teller number" />
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={runner.busy} onClick={() => void runner.run((k) => recordPayment(ctx.businessId, bill.id, Number(amount), method, ref, k), 'Recorded.')}>Record payment</Button></div>
      </div>
    </Dialog>
  )
}

/** Every payment received, with printable receipts and reversals (a reversal keeps the original line and gives the money back to the bill). */
export function SchoolPaymentsPage() {
  const ctx = useSchool()
  const { businessId, can, active } = ctx
  const pays = useAsync(() => loadPayments(businessId), [businessId])
  const bills = useAsync(() => loadBills(businessId), [businessId])
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [paying, setPaying] = useState(false); const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const list = (pays.data ?? []).filter((p) => (!q.trim() || (p.studentName + p.receipt + p.billNumber).toLowerCase().includes(q.trim().toLowerCase())) && (!from || p.paidOn >= from) && (!to || p.paidOn <= to))
  const total = list.filter((p) => p.status === 'posted').reduce((a, p) => a + p.amount, 0)
  const open = pays.data?.find((p) => p.id === openId) ?? null
  const refresh = async () => { await Promise.all([pays.refresh(), bills.refresh()]) }

  return (
    <>
      <PageHeader title="Payments" description="Money received for school fees. Each payment gets a receipt number that is never reused."
        actions={<div className="flex gap-2"><Button variant="secondary" disabled={!list.length} onClick={() => downloadCsv('payments', [['Receipt', 'Date', 'Student', 'Bill', 'Method', 'Reference', 'Amount', 'Status'], ...list.map((p) => [p.receipt, p.paidOn, p.studentName, p.billNumber, p.method, p.reference ?? '', p.amount, p.status])])}>Export CSV</Button>{can('school.fees.record') && <Button onClick={() => setPaying(true)}>Record payment</Button>}</div>} />
      {pays.error && <ErrorState message={pays.error} />}
      <div className="mb-3 flex flex-wrap items-end gap-3"><div className="w-56"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, receipt or bill" /></div><div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div><p className="pb-2 text-sm">Received: <b className="tabular">{naira(total)}</b></p></div>
      {pays.loading ? <Spinner /> : !list.length ? <Card><EmptyState title="No payments" description="Payments are recorded against a student's bill." /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Receipt</th><th className="p-3">Date</th><th className="p-3">Student</th><th className="p-3">Method</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{list.map((p) => <tr key={p.id} onClick={() => setOpenId(p.id)} className="cursor-pointer hover:bg-surface"><td className="p-3">{p.receipt}</td><td className="p-3">{p.paidOn}</td><td className="p-3 font-medium">{p.studentName}</td><td className="p-3">{label(p.method)}</td><td className="tabular p-3 text-right">{naira(p.amount)}</td><td className="p-3"><Badge tone={p.status === 'posted' ? 'success' : 'danger'}>{p.status === 'posted' ? 'Received' : 'Reversed'}</Badge></td></tr>)}</tbody></table></Card>
      )}
      {paying && <PickBill ctx={ctx} bills={(bills.data ?? []).filter((b) => b.balance > 0)} onClose={() => setPaying(false)} onSaved={async () => { setPaying(false); await refresh() }} />}
      {open && <Receipt ctx={ctx} payment={open} bill={(bills.data ?? []).find((b) => b.id === open.billId)} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  )
}

function PickBill({ ctx, bills, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; bills: BillRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [q, setQ] = useState(''); const [bill, setBill] = useState<BillRow | null>(null)
  if (bill) return <PaymentDialog ctx={ctx} bill={bill} onClose={onClose} onSaved={onSaved} />
  const list = bills.filter((b) => !q.trim() || (b.studentName + b.admissionNo + b.number).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30)
  return (
    <Dialog title="Which student is paying?" onClose={onClose}>
      <div className="space-y-3"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, admission number or bill" autoFocus />
        {list.length ? <ul className="max-h-72 divide-y divide-ink/10 overflow-auto rounded-md border border-line text-sm">{list.map((b) => <li key={b.id}><button className="flex w-full justify-between p-2 text-left hover:bg-surface" onClick={() => setBill(b)}><span>{b.studentName} <span className="text-ink/60">{b.number}</span></span><b className="tabular">owes {naira(b.balance)}</b></button></li>)}</ul> : <p className="text-sm text-ink/60">No unpaid bills match.</p>}</div>
    </Dialog>
  )
}

function Receipt({ ctx, payment: p, bill, onClose, onChanged }: { ctx: ReturnType<typeof useSchool>; payment: Awaited<ReturnType<typeof loadPayments>>[number]; bill: BillRow | undefined; onClose: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [reversing, setReversing] = useState(false); const [reason, setReason] = useState('')
  return (
    <DetailPage title={`Receipt ${p.receipt}`} onClose={onClose} actions={<Button variant="secondary" className="no-print" onClick={() => printReceipt(receiptData(ctx, p, bill))}><Printer className="size-4" aria-hidden /> Print receipt</Button>}>
      <ReceiptSheet r={receiptData(ctx, p, bill)} />
      {ctx.can('school.fees.manage') && p.status === 'posted' && <div className="no-print mt-4 border-t border-line pt-3">{reversing ? <div className="space-y-3"><Notice>Reversing keeps this receipt on record and puts the amount back on the bill as owed.</Notice><TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />{runner.error && <ErrorState title="Not reversed" message={runner.error} />}<div className="flex gap-2"><Button variant="secondary" onClick={() => setReversing(false)}>Cancel</Button><Button variant="secondary" disabled={reason.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => reversePayment(ctx.businessId, p.id, reason), 'Reversed.', () => setReversing(false))}>Reverse payment</Button></div></div> : <Button variant="secondary" onClick={() => setReversing(true)}>Reverse this payment</Button>}</div>}
    </DetailPage>
  )
}
