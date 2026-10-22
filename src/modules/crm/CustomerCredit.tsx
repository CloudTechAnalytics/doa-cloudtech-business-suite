import { Card, EmptyState, ErrorState, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { listSales } from '@/modules/sales/tradeApi'
import type { CustomerSectionProps } from '@/core/industry-registry/types'

/** A customer's credit account: what they owe, sale by sale. Taken from the sales records, so it always matches the till. */
export function CustomerCredit({ businessId, customerId }: CustomerSectionProps) {
  const sales = useAsync(() => listSales(businessId), [businessId])
  if (sales.loading) return <Spinner />
  if (sales.error) return <ErrorState message={sales.error} />
  const mine = (sales.data ?? []).filter((s) => s.customerId === customerId && s.status !== 'voided')
  const open = mine.filter((s) => s.balanceDue > 0)
  const owed = Math.round(open.reduce((a, s) => a + s.balanceDue * 100, 0)) / 100
  return (
    <div className="space-y-3">
      <Card><p className="text-sm">Owes <b className="tabular">{naira(owed)}</b> across {open.length} unpaid sale{open.length === 1 ? '' : 's'}. Record payments from the sale in Sales &rarr; History.</p></Card>
      {open.length === 0 ? <EmptyState title="Nothing owing" description="Every sale to this customer has been paid in full." /> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Sale</th><th className="py-1">Date</th><th className="py-1">Payment</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Owing</th></tr></thead>
          <tbody className="divide-y divide-ink/10">
            {open.map((s) => <tr key={s.id}><td className="py-1.5 font-medium">{s.number}</td><td className="py-1.5">{s.soldAt.slice(0, 10)}</td><td className="py-1.5">{label(s.paymentStatus)}</td><td className="tabular py-1.5 text-right">{naira(s.grandTotal)}</td><td className="tabular py-1.5 text-right">{naira(s.amountPaid)}</td><td className="tabular py-1.5 text-right text-warning">{naira(s.balanceDue)}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  )
}
