import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ModuleCode } from '@/shared/types/domain'
import { EmptyState, Spinner } from '@/shared/components'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { MODULES } from '@/core/module-registry/registry'

const REASONS = {
  disabled: 'This module is turned off for this business. Its existing records are kept.',
  needs_plan: "This module isn't included in this business's current plan (or the subscription has lapsed).",
  no_permission: "Your role doesn't include access to this module.",
  not_compatible: "This module isn't available for this business's industry.",
} as const

/** UI route guard. Not a security boundary: the database enforces the same rules. */
export function ModuleRoute({ code, children }: { code: ModuleCode; children: ReactNode }) {
  const { statuses, loading } = useModules()
  if (loading) return <Spinner />
  const status = statuses.find((s) => s.code === code)
  if (status?.usable) return children
  const reason = REASONS[status && status.availability !== 'available' ? status.availability : 'not_compatible']
  return (
    <EmptyState
      title={`${MODULES[code].name} is not available`}
      description={reason}
      action={<Link to="/app/dashboard" className="underline">Back to dashboard</Link>}
    />
  )
}
