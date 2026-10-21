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

export const farm = defineIndustry({
  ...farmConfig,
  modules: farmModules,
  permissions: farmPermissions,
  navigation: farmNavigation,
  routes: farmRoutes,
  onboarding: { questions: farmSetupQuestions, validate: validateFarmSetup },
  dashboardWidgets: [{ id: 'farm-kpis', title: 'Farm overview', component: FarmDashboardWidget }],
  workflows: [
    { id: 'record-mortality', label: 'Record mortality', module: 'farm-mortality', description: 'Record deaths in a batch.' },
    { id: 'record-feeding', label: 'Record feeding', module: 'farm-feeding', description: 'Record feed given to a batch.' },
    { id: 'record-harvest', label: 'Record harvest', module: 'farm-harvests', description: 'Record produce harvested.' },
  ],
})
