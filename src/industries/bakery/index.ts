import { defineIndustry } from '@/core/industry-registry/define'
import { lazy } from 'react'
import { bakeryConfig } from './config'
import { bakeryModules } from './modules'
import { bakeryNavigation } from './navigation'
import { bakeryPermissions } from './permissions'
import { bakeryRoutes } from './routes'
import { bakerySetupQuestions } from './setup'

// Loaded on demand so the registry never imports bakery screens or data code.
const BakeryDashboardWidget = lazy(() => import('./components/BakeryOverview').then((m) => ({ default: m.BakeryOverview })))

export const bakery = defineIndustry({
  ...bakeryConfig,
  modules: bakeryModules,
  permissions: bakeryPermissions,
  navigation: bakeryNavigation,
  routes: bakeryRoutes,
  onboarding: { questions: bakerySetupQuestions },
  dashboardWidgets: [{ id: 'bakery-kpis', title: 'Bakery overview', component: BakeryDashboardWidget }],
  workflows: [
    { id: 'start-production', label: 'Plan production', module: 'bakery-production', description: 'Plan a production batch.' },
    { id: 'record-waste', label: 'Record waste', module: 'bakery-waste', description: 'Record waste or spoilage.' },
  ],
})
