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
  // A new school is configured straight away for the kind of school chosen: its classes, departments, subjects, grading and terms.
  afterCreate: async (businessId, answers) => {
    const { setupSchool } = await import('./services/schoolApi')
    const picked = String(answers.school_type ?? '')
    const type = (['nursery', 'primary', 'secondary', 'combined', 'online'] as const).find((x) => x === picked) ?? 'combined'
    const y = new Date().getFullYear()
    const session = String(answers.session_name ?? '').trim() || `${y}/${y + 1}`
    const err = await setupSchool(businessId, type, session, new Date().toISOString().slice(0, 10))
    return err ? `The school was created, but its classes and subjects could not be set up (${err}). Open School Settings and use "Start from the standard structure".` : null
  },
  // An online school talks about courses, units and instructors.
  moduleLabels: async (businessId): Promise<Record<string, string>> => {
    const { loadSchoolKind } = await import('./services/schoolApi')
    return (await loadSchoolKind(businessId)) === 'online' ? { 'school-my-classes': 'My Courses', 'school-classes': 'Courses & Units', 'school-staff': 'Instructors & Staff' } : {}
  },
  dashboardWidgets: [{ id: 'school-kpis', title: 'School overview', component: SchoolDashboardWidget }],
  workflows: [
    { id: 'take-attendance', label: 'Take attendance', module: 'school-attendance', description: 'Mark attendance for a class.' },
    { id: 'record-payment', label: 'Record a fee payment', module: 'school-payments', description: 'Record a payment and print a receipt.' },
  ],
})
