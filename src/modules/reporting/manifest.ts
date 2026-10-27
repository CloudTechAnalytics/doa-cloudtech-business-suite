import { BarChart3, BookOpen, HandCoins, LayoutDashboard, Landmark, TrendingUp } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'
import type { ModuleDefinition } from '@/shared/types/domain'

const dashboard: ModuleDefinition = {
  code: 'dashboard', name: 'Dashboard', description: 'Indicators for the selected period, with industry widgets.', path: 'dashboard',
  permission: 'dashboard.read', icon: LayoutDashboard, navGroup: 'Overview', owner: 'platform',
}
const reports: ModuleDefinition = {
  code: 'reports', name: 'Reports', description: 'Sales, purchases, stock, expense and margin reports.', path: 'reports',
  permission: 'reports.finance.read', icon: BarChart3, navGroup: 'Finance', owner: 'platform',
  sections: [
    { key: 'overview', label: 'Overview', icon: BarChart3 }, { key: 'cashflow', label: 'Cash flow', icon: TrendingUp }, { key: 'cashbook', label: 'Cashbook', icon: BookOpen },
    { key: 'owed', label: 'Owed to you', icon: HandCoins }, { key: 'bills', label: 'You owe', icon: Landmark },
  ],
}

export const dashboardModule: SharedModule = { definition: dashboard, page: lazy(() => import('./DashboardPage').then((m) => ({ default: m.DashboardPage }))) }
export const reportsModule: SharedModule = { definition: reports, page: lazy(() => import('@/modules/finance/ReportsPage').then((m) => ({ default: m.ReportsPage }))) }
