import { Download } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { listCashbook, withRunningBalance } from './financeApi'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const KIND: Record<string, string> = { sale_receipt: 'Sale payment received', refund: 'Refund paid', purchase_payment: 'Supplier payment', expense: 'Expense', invoice_receipt: 'Invoice payment received' }

function csv(rows: (string | number)[][]) {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}

/** Every cash movement in date order: payments received and paid, and expenses, with a running balance per payment method. */
export function CashbookPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const all = useAsync(() => listCashbook(businessId), [businessId])
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(() => iso(new Date()))
  if (!active) return null

  // The balance runs over the whole history, then the chosen period is shown.
  const withBalance = withRunningBalance(all.data ?? [])
  const rows = withBalance.filter((e) => e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to)
  const cents = (xs: typeof rows) => xs.reduce((a, e) => a + Math.round(e.amount * 100), 0) / 100
  const cashIn = cents(rows.filter((e) => e.direction === 'in'))
  const cashOut = cents(rows.filter((e) => e.direction === 'out'))
  const methods = [...new Set(withBalance.map((e) => e.method))]
  const closing = (m: string) => [...withBalance].reverse().find((e) => e.method === m && e.at.slice(0, 10) <= to)?.balance ?? 0

  function download() {
    const body = csv([['Date', 'Type', 'Reference', 'Method', 'In', 'Out', 'Balance (method)'], ...rows.map((e) => [e.at.slice(0, 10), KIND[e.kind] ?? e.kind, e.reference, label(e.method), e.direction === 'in' ? e.amount : '', e.direction === 'out' ? e.amount : '', e.balance])])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = `cashbook-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <PageHeader title="Cashbook" description="Every recorded cash movement: payments received, supplier payments, refunds and expenses. Reversed payments and voided expenses are not cash movements and are left out."
        actions={<Button variant="secondary" onClick={download} disabled={!rows.length}><Download className="size-4" aria-hidden /> Export CSV</Button>} />
      {all.error && <ErrorState message={all.error} />}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44"><TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><TextField label="To" type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><p className="text-xs font-medium uppercase tracking-wide text-ink/60">Money in</p><p className="tabular mt-2 text-2xl font-semibold text-success">{naira(cashIn)}</p></Card>
        <Card><p className="text-xs font-medium uppercase tracking-wide text-ink/60">Money out</p><p className="tabular mt-2 text-2xl font-semibold text-danger">{naira(cashOut)}</p></Card>
        <Card><p className="text-xs font-medium uppercase tracking-wide text-ink/60">Net for the period</p><p className="tabular mt-2 text-2xl font-semibold">{naira(Math.round((cashIn - cashOut) * 100) / 100)}</p></Card>
      </div>
      {methods.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{methods.map((m) => <span key={m} className="rounded-full bg-canvas px-2.5 py-1">{label(m)} balance <b className="tabular">{naira(closing(m))}</b></span>)}</div>}
      {all.loading ? <Spinner /> : rows.length === 0 ? <Card><EmptyState title="No cash movements in this period" description="Payments and expenses appear here as they are recorded." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Entry</th><th className="p-3">Method</th><th className="p-3 text-right">In</th><th className="p-3 text-right">Out</th><th className="p-3 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((e) => (
                <tr key={`${e.kind}-${e.sourceId}`}>
                  <td className="whitespace-nowrap p-3">{e.at.slice(0, 10)}</td>
                  <td className="p-3">{KIND[e.kind] ?? e.kind}<div className="text-xs text-ink/60">{e.reference}</div></td>
                  <td className="p-3"><Badge>{label(e.method)}</Badge></td>
                  <td className="tabular p-3 text-right text-success">{e.direction === 'in' ? naira(e.amount) : ''}</td>
                  <td className="tabular p-3 text-right text-danger">{e.direction === 'out' ? naira(e.amount) : ''}</td>
                  <td className="tabular p-3 text-right text-ink/70">{naira(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
