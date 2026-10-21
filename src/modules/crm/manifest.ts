import { Users } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

/**
 * The CRM module. Its stable module code is "customers" (database policies and plan entitlements
 * reference that code); the user-facing name is CRM.
 */
export const crmModule: SharedModule = {
  definition: {
    code: 'customers', name: 'CRM', description: 'Leads, customers, notes, follow-ups and credit limits.', path: 'customers',
    permission: 'customers.read', icon: Users, navGroup: 'Sales and customers', owner: 'platform',
  },
  page: lazy(() => import('./CrmPage').then((m) => ({ default: m.CrmPage }))),
}
