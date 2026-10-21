import { Card, EmptyState, ErrorState, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { dateTime, label } from '@/shared/utilities/format'
import { isDemoMode } from '@/shared/utilities/env'
import { listAudit } from './auditApi'

/** Recent changes to this business. Written by database triggers; users can read (audit.read) but never edit it. */
export function AuditPanel({ businessId }: { businessId: string }) {
  const log = useAsync(() => listAudit(businessId), [businessId])
  return (
    <Card className="mt-4">
      <h2 className="mb-2 text-sm font-semibold">Audit history</h2>
      {isDemoMode ? <p className="text-sm text-navy/60">The audit log is recorded by the database. Demo mode runs in the browser and does not keep one.</p>
        : log.loading ? <Spinner />
        : log.error ? <ErrorState message={log.error} />
        : !log.data?.length ? <EmptyState title="No audit records yet" />
        : (
          <ul className="divide-y divide-navy/10 text-sm">
            {log.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
                <b>{label(a.action.replace('.', ' '))}</b>
                <span className="text-xs text-navy/60">{Object.keys(a.metadata).slice(0, 4).join(', ')}</span>
                <span className="ml-auto text-xs text-navy/50">{dateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}
