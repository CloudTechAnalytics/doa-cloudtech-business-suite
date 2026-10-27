import { Button, ErrorState } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { naira } from '@/shared/utilities/format'
import { invoiceSummary } from '@/modules/invoices/invoicesApi'
import { SWITCH_OFF_EFFECTS } from './apps'
import type { StandaloneApp } from './apps'

interface Props {
  app: StandaloneApp
  on: boolean
  businessId: string
  businessName: string
  /** Modules that will really be switched off (an app another app still needs keeps its modules). */
  keepsOn?: string[]
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Asks before an app is switched on or off, because either one changes what everyone in the business sees. Off says what stops, what is kept and what still
 * works, and for Invoices how much is still owed; on says what it adds. Nothing is deleted either way, and the choice is recorded in the audit log.
 */
export function ConfirmSwitch({ app, on, businessId, businessName, keepsOn = [], busy, error, onCancel, onConfirm }: Props) {
  const owed = useAsync(() => (!on && app.id === 'invoices' ? invoiceSummary(businessId).catch(() => null) : Promise.resolve(null)), [businessId, app.id, on])
  const outstanding = owed.data
  return (
    <Dialog title={on ? `Switch on ${app.name}?` : `Switch off ${app.name}?`} onClose={onCancel}>
      <div className="space-y-3 text-sm">
        {on ? (
          <>
            <p>{app.description}</p>
            {app.modules.length > 1 && <p className="rounded-md bg-surface px-3 py-2 text-xs">It also switches on the products and stock list it sells from, so Inventory will show as on too.</p>}
            <p className="text-ink/70">Everyone in {businessName} who has access will see it in their menu. You can switch it off later: nothing is deleted.</p>
          </>
        ) : (
          <>
            <p className="font-medium">This changes what everyone in {businessName} can do:</p>
            <ul className="list-disc space-y-1 pl-5 text-ink/80">{SWITCH_OFF_EFFECTS[app.id].map((e) => <li key={e}>{e}</li>)}</ul>
            {outstanding && outstanding.outstanding > 0 && (
              <p role="alert" className="rounded-md border border-amber/50 bg-amber/10 px-3 py-2">
                You have {naira(outstanding.outstanding)} still owed on invoices{outstanding.overdueCount > 0 ? `, ${outstanding.overdueCount} of them overdue` : ''}. You will not be able to record payments on them until you switch Invoices back on.
              </p>
            )}
            {keepsOn.length > 0 && <p className="rounded-md bg-surface px-3 py-2 text-xs">Part of this app stays on because another app you use needs it.</p>}
            <p className="text-ink/70">Nothing is deleted. Switch it on again and everything is back exactly as it was.</p>
          </>
        )}
        {error && <ErrorState title="Not changed" message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button loading={busy} onClick={onConfirm}>{on ? 'Yes, switch on' : 'Yes, switch off'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
