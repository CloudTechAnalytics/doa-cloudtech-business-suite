import { BarChart3, Briefcase, CalendarCheck, FileText, KanbanSquare, UserPlus, Users } from 'lucide-react'
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
    // The same parts as the tabs on the page; the sidebar lists them so every part is one click away.
    sections: [
      { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare }, { key: 'deals', label: 'Deals', icon: Briefcase }, { key: 'activities', label: 'Activities', icon: CalendarCheck }, { key: 'customers', label: 'Customers', icon: Users },
      { key: 'leads', label: 'Leads', icon: UserPlus }, { key: 'quotes', label: 'Quotes', icon: FileText }, { key: 'reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  page: lazy(() => import('./CrmPage').then((m) => ({ default: m.CrmPage }))),
}
