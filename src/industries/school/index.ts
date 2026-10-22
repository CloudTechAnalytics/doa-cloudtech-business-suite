import { defineIndustry } from '@/core/industry-registry/define'
import { lazy } from 'react'
import { schoolConfig } from './config'
import { schoolModules } from './modules'
import { schoolNavigation } from './navigation'
import { schoolPermissions } from './permissions'
import { schoolRoutes } from './routes'
import { schoolSetupQuestions } from './setup'

// Loaded on demand so the registry never imports school screens or data code.
const SchoolDashboardWidget = lazy(() => import('./components/SchoolOverview').then((m) => ({ default: m.SchoolOverview })))

/**
 * A basic school. Records and rules are enforced by the database: teachers reach only their own classes and subjects, parents only their own
 * children and only published results, money only with the fees permission, and nothing about a student is ever deleted.
 */
export const school = defineIndustry({
  ...schoolConfig,
  modules: schoolModules,
  permissions: schoolPermissions,
  navigation: schoolNavigation,
  routes: schoolRoutes,
  onboarding: { questions: schoolSetupQuestions },
  dashboardWidgets: [{ id: 'school-kpis', title: 'School overview', component: SchoolDashboardWidget }],
  workflows: [
    { id: 'take-attendance', label: 'Take attendance', module: 'school-attendance', description: 'Mark attendance for a class.' },
    { id: 'record-payment', label: 'Record a fee payment', module: 'school-payments', description: 'Record a payment and print a receipt.' },
  ],
})
