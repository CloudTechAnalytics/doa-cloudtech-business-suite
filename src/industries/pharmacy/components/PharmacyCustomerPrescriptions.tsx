import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, EmptyState, ErrorState, Notice, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, qty } from '@/shared/utilities/format'
import type { CustomerSectionProps } from '@/core/industry-registry/types'
import { loadMedicines, loadPrescriptions } from '../services/pharmacyApi'

const TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { draft: 'neutral', awaiting_review: 'warning', approved: 'info', partially_dispensed: 'info', dispensed: 'success', rejected: 'danger', cancelled: 'neutral', expired: 'danger' }

/** Prescriptions linked to this customer. Health-related, so only staff with prescription access see anything here. */
export function PharmacyCustomerPrescriptions({ businessId, customerId }: CustomerSectionProps) {
  const { can } = usePermissions(businessId)
  const allowed = can('pharmacy.rx')
  const rxs = useAsync(() => (allowed ? loadPrescriptions(businessId) : Promise.resolve([])), [businessId, allowed])
  const meds = useAsync(() => (allowed ? loadMedicines(businessId) : Promise.resolve([])), [businessId, allowed])
  if (!allowed) return <Notice>Prescription records are only visible to staff with prescription access.</Notice>
  if (rxs.loading) return <Spinner />
  if (rxs.error) return <ErrorState message={rxs.error} />
  const mine = (rxs.data ?? []).filter((r) => r.customerId === customerId)
  if (!mine.length) return <EmptyState title="No prescriptions linked" description="Choose this customer's record when entering a prescription to see it here." />
  const name = (id: string) => meds.data?.find((m) => m.id === id)?.name ?? 'Medicine'
  return (
    <ul className="divide-y divide-ink/10 text-sm">
      {mine.map((r) => (
        <li key={r.id} className="py-2">
          <div className="flex flex-wrap items-baseline gap-2"><b>{r.number}</b><Badge tone={TONE[r.effectiveStatus]}>{label(r.effectiveStatus)}</Badge><span className="text-ink/70">{r.prescriber} · {r.prescribedOn}, valid until {r.validUntil}</span></div>
          <div className="text-xs text-ink/70">{r.items.map((i) => `${name(i.productId)}: ${qty(i.dispensed)} of ${qty(i.prescribed)} dispensed`).join('; ')}</div>
        </li>
      ))}
    </ul>
  )
}
