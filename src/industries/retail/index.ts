import { defineIndustry } from '@/core/industry-registry/define'
import { lazy } from 'react'
import { retailConfig } from './config'
import { retailModules } from './modules'
import { retailNavigation } from './navigation'
import { retailPermissions } from './permissions'
import { retailRoutes } from './routes'
import { retailSetupQuestions } from './setup'

// Loaded on demand so the registry never imports mart screens or data code.
const MartDashboardWidget = lazy(() => import('./components/MartOverview').then((m) => ({ default: m.MartOverview })))

const CreditSection = lazy(() => import('@/modules/crm/CustomerCredit').then((m) => ({ default: m.CustomerCredit })))

export const retail = defineIndustry({
  ...retailConfig,
  modules: retailModules,
  permissions: retailPermissions,
  navigation: retailNavigation,
  routes: retailRoutes,
  onboarding: { questions: retailSetupQuestions },
  dashboardWidgets: [{ id: 'retail-kpis', title: 'Mart overview', component: MartDashboardWidget }],
  customerSections: [{ id: 'credit', title: 'Credit account', component: CreditSection }],
  workflows: [
    { id: 'record-loss', label: 'Record damaged or expired stock', module: 'retail-losses', description: 'Write off damaged, expired or missing stock.' },
    { id: 'open-shift', label: 'Open cashier shift', module: 'retail-shifts', description: 'Start a cashier shift with opening cash.' },
  ],
})
