import { Badge, EmptyState, ErrorState, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { listOrders } from '@/modules/orders/ordersApi'
import type { CustomerSectionProps } from '@/core/industry-registry/types'

const TONE = { open: 'info', partially_fulfilled: 'warning', fulfilled: 'success', cancelled: 'neutral' } as const

/** The customer's farm sales orders: what they ordered, what has been delivered and what is still to come. */
export function FarmCustomerOrders({ businessId, customerId }: CustomerSectionProps) {
  const orders = useAsync(() => listOrders(businessId), [businessId])
  if (orders.loading) return <Spinner />
  if (orders.error) return <ErrorState message={orders.error} />
  const mine = (orders.data ?? []).filter((o) => o.customerId === customerId)
  if (!mine.length) return <EmptyState title="No orders yet" description="Orders you take from this customer under Sales Orders appear here with what has been delivered." />
  return (
    <ul className="divide-y divide-ink/10 text-sm">
      {mine.map((o) => {
        const ordered = o.lines.reduce((a, l) => a + l.quantity, 0); const done = o.lines.reduce((a, l) => a + l.fulfilled, 0)
        return (
          <li key={o.id} className="flex flex-wrap items-baseline gap-2 py-2">
            <b>{o.number}</b><Badge tone={TONE[o.status]}>{label(o.status)}</Badge>
            <span className="text-ink/70">{done} of {ordered} delivered{o.expected ? ` · expected ${o.expected}` : ''}</span>
            <span className="tabular ml-auto">{naira(o.quotedTotal)}</span>
          </li>
        )
      })}
    </ul>
  )
}
