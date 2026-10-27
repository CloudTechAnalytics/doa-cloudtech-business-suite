import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { addPayment, payPurchase } from '@/modules/sales/tradeApi'
import { Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { PAY_METHODS, listPayables, listReceivables, myFinancePermissions } from './financeApi'

const BUCKETS = [['Current (0 to 30 days)', 0, 30], ['31 to 60 days', 31, 60], ['61 to 90 days', 61, 90], ['Over 90 days', 91, Infinity]] as const
const bucketTotals = (rows: { ageDays: number; balanceDue: number }[]) => BUCKETS.map(([name, lo, hi]) => ({ name, total: rows.filter((r) => r.ageDays >= lo && r.ageDays <= hi).reduce((a, r) => a + Math.round(r.balanceDue * 100), 0) / 100 }))

function Aging({ buckets, total, noun }: { buckets: { name: string; total: number }[]; total: number; noun: string }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-5">
      <Card className="sm:col-span-1"><p className="text-xs font-medium uppercase tracking-wide text-ink/60">Total {noun}</p><p className="tabular mt-2 text-2xl font-semibold">{naira(total)}</p></Card>
      {buckets.map((b) => <Card key={b.name}><p className="text-xs font-medium text-ink/60">{b.name}</p><p className="tabular mt-2 text-lg font-semibold">{naira(b.total)}</p></Card>)}
    </div>
  )
}

export function PayDialog({ title, due, subject, onPay, onClose, onSaved }: { title: string; due: number; subject: string; onPay: (method: string, amount: number, key: string) => Promise<string | null>; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [err, setErr] = useState<string | undefined>()
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const amount = Math.round(Number(f.get('amount')) * 100) / 100
    if (!(amount > 0) || amount > due) return setErr(`Enter an amount from 0.01 to ${naira(due)}.`)
    setErr(undefined)
    await runner.run((k) => onPay(String(f.get('method')), amount, k), 'Payment recorded.')
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-ink/80">{subject}. Still due: <b>{naira(due)}</b>. A payment can never be more than what is due.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Amount" name="amount" type="number" min="0" step="0.01" defaultValue={due} error={err} autoFocus />
          <SelectField label="Method" name="method" defaultValue="bank_transfer">{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
        </div>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record payment</Button></div>
      </form>
    </Dialog>
  )
}

/** What customers still owe: open invoices, oldest first, with ageing. Money received is recorded against the invoice. */
export function ReceivablesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const rows = useAsync(() => listReceivables(businessId), [businessId])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [paying, setPaying] = useState<NonNullable<typeof rows.data>[number] | null>(null)
  if (!active) return null
  const canCollect = perms.data?.includes('sales.create') ?? false
  const data = [...(rows.data ?? [])].sort((a, b) => b.ageDays - a.ageDays)
  const total = data.reduce((a, r) => a + Math.round(r.balanceDue * 100), 0) / 100
  const byCustomer = new Map<string, number>()
  for (const r of data) byCustomer.set(r.customerName, (byCustomer.get(r.customerName) ?? 0) + Math.round(r.balanceDue * 100))
  return (
    <>
      <PageHeader title="Receivables" description="What customers still owe you, from open invoices. Age counts from the sale date." />
      {rows.error && <ErrorState message={rows.error} />}
      {rows.loading ? <Spinner /> : data.length === 0 ? <Card><EmptyState title="Nothing is owed to you" description="Credit sales with a balance appear here until they are paid." /></Card> : (
        <>
          <Aging buckets={bucketTotals(data)} total={total} noun="owed to you" />
          <div className="mb-3 flex flex-wrap gap-2 text-xs">{[...byCustomer].sort((a, b) => b[1] - a[1]).map(([n, v]) => <span key={n} className="rounded-full bg-canvas px-2.5 py-1">{n} <b className="tabular">{naira(v / 100)}</b></span>)}</div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3 text-right">Age</th><th className="p-3 text-right">Invoice total</th><th className="p-3 text-right">Still owed</th>{canCollect && <th className="p-3" />}</tr></thead>
              <tbody className="divide-y divide-ink/10">
                {data.map((r) => (
                  <tr key={r.saleId}>
                    <td className="p-3 font-medium">{r.number}<div className="text-xs font-normal text-ink/60">{r.soldAt.slice(0, 10)}</div></td>
                    <td className="p-3">{r.customerName}</td>
                    <td className="tabular p-3 text-right">{r.ageDays} d</td>
                    <td className="tabular p-3 text-right">{naira(r.grandTotal)}</td>
                    <td className="tabular p-3 text-right font-medium">{naira(r.balanceDue)}</td>
                    {canCollect && <td className="p-3 text-right">{r.source === 'invoice' ? <span className="text-xs text-ink/60">Record it under Invoices</span> : <Button variant="secondary" onClick={() => setPaying(r)}>Record payment</Button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {paying && <PayDialog title="Record payment received" due={paying.balanceDue} subject={`${paying.number} · ${paying.customerName}`} onClose={() => setPaying(null)}
        onPay={(method, amount, key) => addPayment(businessId, paying.saleId, { method, amount }, key)} onSaved={async () => { setPaying(null); await rows.refresh() }} />}
    </>
  )
}

/** What you still owe suppliers, from purchase orders. Paying a supplier is recorded against the order. */
export function PayablesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const rows = useAsync(() => listPayables(businessId), [businessId])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [paying, setPaying] = useState<NonNullable<typeof rows.data>[number] | null>(null)
  if (!active) return null
  const canPay = perms.data?.includes('purchases.pay') ?? false
  const data = [...(rows.data ?? [])].sort((a, b) => b.ageDays - a.ageDays)
  const total = data.reduce((a, r) => a + Math.round(r.balanceDue * 100), 0) / 100
  const bySupplier = new Map<string, number>()
  for (const r of data) bySupplier.set(r.supplierName, (bySupplier.get(r.supplierName) ?? 0) + Math.round(r.balanceDue * 100))
  return (
    <>
      <PageHeader title="Payables" description="What you still owe suppliers, from purchase orders. Age counts from the order date." />
      {rows.error && <ErrorState message={rows.error} />}
      {rows.loading ? <Spinner /> : data.length === 0 ? <Card><EmptyState title="You owe no supplier" description="Purchase orders with an unpaid balance appear here." /></Card> : (
        <>
          <Aging buckets={bucketTotals(data)} total={total} noun="you owe" />
          <div className="mb-3 flex flex-wrap gap-2 text-xs">{[...bySupplier].sort((a, b) => b[1] - a[1]).map(([n, v]) => <span key={n} className="rounded-full bg-canvas px-2.5 py-1">{n} <b className="tabular">{naira(v / 100)}</b></span>)}</div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Order</th><th className="p-3">Supplier</th><th className="p-3 text-right">Age</th><th className="p-3 text-right">Order total</th><th className="p-3 text-right">Still owed</th>{canPay && <th className="p-3" />}</tr></thead>
              <tbody className="divide-y divide-ink/10">
                {data.map((r) => (
                  <tr key={r.purchaseId}>
                    <td className="p-3 font-medium">{r.number}<div className="text-xs font-normal text-ink/60">{r.at.slice(0, 10)}</div></td>
                    <td className="p-3">{r.supplierName}</td>
                    <td className="tabular p-3 text-right">{r.ageDays} d</td>
                    <td className="tabular p-3 text-right">{naira(r.total)}</td>
                    <td className="tabular p-3 text-right font-medium">{naira(r.balanceDue)}</td>
                    {canPay && <td className="p-3 text-right"><Button variant="secondary" onClick={() => setPaying(r)}>Pay supplier</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {paying && <PayDialog title="Pay supplier" due={paying.balanceDue} subject={`${paying.number} · ${paying.supplierName}`} onClose={() => setPaying(null)}
        onPay={(method, amount, key) => payPurchase(businessId, paying.purchaseId, method, amount, '', key)} onSaved={async () => { setPaying(null); await rows.refresh() }} />}
    </>
  )
}
