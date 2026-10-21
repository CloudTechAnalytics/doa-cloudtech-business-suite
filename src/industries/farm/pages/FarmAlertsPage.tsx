import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { MODULES } from '@/core/module-registry/registry'
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { listAlerts } from '../services/opsApi'
import type { AlertRow } from '../services/opsApi'

const ORDER: AlertRow['severity'][] = ['critical', 'warning', 'info']
const STYLE = {
  critical: { Icon: AlertOctagon, text: 'text-danger', bg: 'bg-danger-soft', title: 'Needs attention now' },
  warning: { Icon: AlertTriangle, text: 'text-warning', bg: 'bg-warning-soft', title: 'Worth a look' },
  info: { Icon: Info, text: 'text-accent', bg: 'bg-accent-soft', title: 'For your information' },
} as const

/** What needs attention, worked out from the records each time you open this page: low stock, mortality, overdue work, withdrawals, harvests and bills. */
export function FarmAlertsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const alerts = useAsync(() => listAlerts(businessId), [businessId])
  if (!active) return null
  const rows = alerts.data ?? []
  const where = (code: string) => { const m = MODULES[code]; return m ? `/app/${m.path}` : '/app' }

  return (
    <>
      <PageHeader title="Alerts" description="Worked out from your records each time you open this page, so nothing here can be out of date. Weekly mortality above 2% and harvests due within 7 days are flagged." />
      {alerts.error && <ErrorState message={alerts.error} />}
      {alerts.loading ? <Spinner /> : rows.length === 0 ? <Card><EmptyState title="All clear" description="No low stock, high mortality, overdue work or overdue bills right now." /></Card> : (
        <div className="space-y-5">
          {ORDER.map((sev) => {
            const group = rows.filter((a) => a.severity === sev)
            if (!group.length) return null
            const { Icon, text, bg, title } = STYLE[sev]
            return (
              <section key={sev} aria-label={title}>
                <h2 className="mb-2 text-sm font-semibold text-ink/80">{title} ({group.length})</h2>
                <div className="space-y-2">
                  {group.map((a) => (
                    <Link key={`${a.kind}-${a.refId}`} to={where(a.module)} className="block">
                      <Card className="flex items-start gap-3 transition-colors hover:bg-surface">
                        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${bg} ${text}`}><Icon className="size-4" aria-hidden /></span>
                        <span><span className="block text-sm font-medium">{a.title}</span><span className="block text-xs text-ink/60">{a.detail}</span></span>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
