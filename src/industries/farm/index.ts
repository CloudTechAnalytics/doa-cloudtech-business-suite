import { defineIndustry } from '@/core/industry-registry/define'
import { lazy } from 'react'
import { farmConfig } from './config'
import { farmModules } from './modules'
import { farmNavigation } from './navigation'
import { farmPermissions } from './permissions'
import { farmRoutes } from './routes'
import { farmSetupQuestions, validateFarmSetup } from './setup'

// Loaded on demand so the registry never imports farm screens or data hooks.
const FarmDashboardWidget = lazy(() => import('./components/FarmKpis').then((m) => ({ default: m.FarmDashboardWidget })))

const FARM_LABELS: Record<string, string> = { inventory: 'Stock', sales: 'Sell & Receipts', purchases: 'Purchase Orders' }

const OrdersSection = lazy(() => import('./components/FarmCustomerOrders').then((m) => ({ default: m.FarmCustomerOrders })))
const CreditSection = lazy(() => import('@/modules/crm/CustomerCredit').then((m) => ({ default: m.CustomerCredit })))

export const farm = defineIndustry({
  ...farmConfig,
  modules: farmModules,
  permissions: farmPermissions,
  navigation: farmNavigation,
  routes: farmRoutes,
  onboarding: { questions: farmSetupQuestions, validate: validateFarmSetup },
  // Shared screens in plain farm words.
  moduleLabels: async () => FARM_LABELS,
  dashboardWidgets: [{ id: 'farm-kpis', title: 'Farm overview', component: FarmDashboardWidget }],
  customerSections: [{ id: 'orders', title: 'Orders', component: OrdersSection }, { id: 'credit', title: 'Credit account', component: CreditSection }],
  workflows: [
    { id: 'record-feeding', label: 'Record feeding', module: 'farm-feeding', description: 'Record feed given to a batch.' },
    { id: 'record-mortality', label: 'Record deaths', module: 'farm-mortality', description: 'Record deaths in a batch.' },
    { id: 'record-harvest', label: 'Record eggs or harvest', module: 'farm-harvests', description: 'Record produce collected.' },
  ],
})
