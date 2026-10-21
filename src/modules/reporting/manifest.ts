import { BarChart3, LayoutDashboard } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'
import { placeholderPage } from '@/shared/components/widgets'
import type { ModuleDefinition } from '@/shared/types/domain'

const dashboard: ModuleDefinition = {
  code: 'dashboard', name: 'Dashboard', description: 'Indicators for the selected period, with industry widgets.', path: 'dashboard',
  permission: 'dashboard.read', icon: LayoutDashboard, navGroup: 'Overview', owner: 'platform',
}
const reports: ModuleDefinition = {
  code: 'reports', name: 'Reports', description: 'Sales, purchases, stock, expense and margin reports.', path: 'reports',
  permission: 'reports.read', icon: BarChart3, navGroup: 'Finance', owner: 'platform',
}

export const dashboardModule: SharedModule = { definition: dashboard, page: lazy(() => import('./DashboardPage').then((m) => ({ default: m.DashboardPage }))) }
/** Reports are registered and permission-checked; the report screens are not built yet. */
export const reportsModule: SharedModule = { definition: reports, page: placeholderPage(reports) }
