import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { PayDialog } from '@/modules/finance/OwedPages'
import { myFinancePermissions } from '@/modules/finance/financeApi'
import { listPurchases, payPurchase } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { listBills, recordBill, voidBill } from './ordersApi'
import type { BillDto } from './ordersApi'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const round = (n: number) => Math.round(n * 100) / 100

/** Supplier invoices for purchase orders: number, dates and amount. Payment is made on the order, so it can never exceed what is owed. */
export function SupplierBillsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const bills = useAsync(() => listBills(businessId), [businessId])
  const purchases = useAsync(() => listPurchases(businessId).catch(() => []), [businessId])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<BillDto | null>(null)
  const [paying, setPaying] = useState<BillDto | null>(null)
  if (!active) return null
  const canManage = perms.data?.includes('purchases.pay') ?? false
  const list = bills.data ?? []
  const open = list.filter((b) => b.status === 'open')
  const owed = round(open.reduce((a, b) => a + Math.max(b.purchaseTotal - b.purchasePaid, 0) * (b.amount / (b.purchaseTotal || 1)), 0))
  const overdue = open.filter((b) => b.overdue).length

  return (
    <>
      <PageHeader title="Supplier bills" description="The invoices suppliers send for your purchase orders. Bills for an order can never add up to more than the order."
        actions={canManage ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record bill</Button> : undefined} />
      {bills.error && <ErrorState message={bills.error} />}
      {bills.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No supplier bills yet" description="Record a supplier's invoice against a purchase order to track its due date." /></Card> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-canvas px-2.5 py-1">Open bills <b>{open.length}</b></span>
            <span className="rounded-full bg-canvas px-2.5 py-1">Unpaid share of open bills <b className="tabular">{naira(owed)}</b></span>
            {overdue > 0 && <span className="rounded-full bg-danger-soft px-2.5 py-1 text-danger">Overdue <b>{overdue}</b></span>}
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Bill</th><th className="p-3">Supplier / order</th><th className="p-3">Due</th><th className="p-3 text-right">Amount</th><th className="p-3">Order payment</th>{canManage && <th className="p-3" />}</tr></thead>
              <tbody className="divide-y divide-ink/10">
                {list.map((b) => (
                  <tr key={b.id} className={b.status === 'voided' ? 'text-ink/45' : ''}>
                    <td className="p-3"><span className={b.status === 'voided' ? 'line-through' : 'font-medium'}>{b.number}</span><div className="text-xs text-ink/60">{b.billDate}</div>{b.status === 'voided' && <div className="text-xs">Voided: {b.voidReason}</div>}</td>
                    <td className="p-3">{b.supplierName}<div className="text-xs text-ink/60">{b.purchaseNumber}</div></td>
                    <td className="p-3 whitespace-nowrap">{b.dueDate}{b.overdue && <> <Badge tone="danger">Overdue</Badge></>}</td>
                    <td className="tabular p-3 text-right">{naira(b.amount)}</td>
                    <td className="p-3">{b.status === 'voided' ? '–' : <Badge tone={b.paymentStatus === 'paid' ? 'success' : b.paymentStatus === 'partially_paid' ? 'warning' : 'neutral'}>{label(b.paymentStatus)}</Badge>}</td>
                    {canManage && <td className="whitespace-nowrap p-3 text-right">{b.status === 'open' && <>{b.paymentStatus !== 'paid' && <Button variant="secondary" onClick={() => setPaying(b)}>Pay</Button>} <Button variant="ghost" onClick={() => setVoiding(b)}>Void</Button></>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {adding && <BillDialog businessId={businessId} purchases={purchases.data ?? []} bills={list} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await bills.refresh() }} />}
      {voiding && <VoidBill businessId={businessId} bill={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await bills.refresh() }} />}
      {paying && <PayDialog title="Pay supplier" due={round(paying.purchaseTotal - paying.purchasePaid)} subject={`${paying.purchaseNumber} · ${paying.supplierName} (bill ${paying.number})`} onClose={() => setPaying(null)}
        onPay={(method, amount, key) => payPurchase(businessId, paying.purchaseId, method, amount, paying.number, key)} onSaved={async () => { setPaying(null); await bills.refresh() }} />}
    </>
  )
}

function BillDialog({ businessId, purchases, bills, onClose, onSaved }: { businessId: string; purchases: { id: string; number: string; supplierId: string; total: number; status: string }[]; bills: BillDto[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [purchaseId, setPurchaseId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const billed = (id: string) => round(bills.filter((b) => b.purchaseId === id && b.status === 'open').reduce((a, b) => a + b.amount, 0))
  const choices = purchases.filter((p) => p.status !== 'cancelled' && round(p.total - billed(p.id)) > 0)
  const chosen = choices.find((p) => p.id === purchaseId)
  const room = chosen ? round(chosen.total - billed(chosen.id)) : 0

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!purchaseId) next.purchase = 'Choose the purchase order.'
    if (!s('number')) next.number = "Enter the supplier's bill number."
    if (!(Number(s('amount')) > 0) || Number(s('amount')) > room) next.amount = `Enter an amount up to ${naira(room)}.`
    if (!s('billDate') || !s('dueDate') || s('dueDate') < s('billDate')) next.dueDate = 'The due date cannot be before the bill date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordBill(businessId, { purchaseId, number: s('number'), billDate: s('billDate'), dueDate: s('dueDate'), amount: round(Number(s('amount'))) }, k), 'Bill recorded.')
  }
  return (
    <Dialog title="Record a supplier bill" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label="Purchase order" value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)} error={errors.purchase} hint={chosen ? `Not yet billed: ${naira(room)}` : 'Only orders with an unbilled amount are listed.'}>
          <option value="">Select…</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.number} · {naira(p.total)}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Supplier's bill number" name="number" error={errors.number} maxLength={60} />
          <TextField label="Amount" name="amount" type="number" min="0" step="0.01" key={purchaseId} defaultValue={room || ''} error={errors.amount} />
          <TextField label="Bill date" name="billDate" type="date" defaultValue={iso(new Date())} />
          <TextField label="Due date" name="dueDate" type="date" defaultValue={iso(new Date(Date.now() + 30 * 86400000))} error={errors.dueDate} />
        </div>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record bill</Button></div>
      </form>
    </Dialog>
  )
}

function VoidBill({ businessId, bill, onClose, onSaved }: { businessId: string; bill: BillDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Void bill ${bill.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidBill(businessId, bill.id, reason, k), 'Bill voided.') }} className="space-y-4">
        <p className="text-sm text-ink/80">Voiding a bill does not undo any payment already made on the purchase order.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not voided" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger hover:bg-danger/90">Void bill</Button></div>
      </form>
    </Dialog>
  )
}
