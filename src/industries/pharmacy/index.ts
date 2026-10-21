import { defineIndustry } from '@/core/industry-registry/define'
import { lazy } from 'react'
import { pharmacyConfig } from './config'
import { pharmacyModules } from './modules'
import { pharmacyNavigation } from './navigation'
import { pharmacyPermissions } from './permissions'
import { pharmacyRoutes } from './routes'
import { pharmacySetupQuestions } from './setup'

// Loaded on demand so the registry never imports pharmacy screens or data code.
const PharmacyDashboardWidget = lazy(() => import('./components/PharmacyOverview').then((m) => ({ default: m.PharmacyOverview })))

/**
 * Pharmacy & medicine store. The software records and enforces workflow (batches, expiry, quarantine, restricted-medicine dispensing,
 * pharmacist review). It does not diagnose, prescribe, or decide that a prescription is clinically safe, and the legal requirements
 * of the pharmacy's jurisdiction must be confirmed with qualified professionals before production use.
 */
export const pharmacy = defineIndustry({
  ...pharmacyConfig,
  modules: pharmacyModules,
  permissions: pharmacyPermissions,
  navigation: pharmacyNavigation,
  routes: pharmacyRoutes,
  onboarding: { questions: pharmacySetupQuestions },
  dashboardWidgets: [{ id: 'pharmacy-kpis', title: 'Pharmacy overview', component: PharmacyDashboardWidget }],
  workflows: [
    { id: 'receive-goods', label: 'Receive goods with batch and expiry', module: 'pharmacy-products', description: 'Record a delivery with batch numbers, expiry dates and rejected quantities.' },
    { id: 'review-prescription', label: 'Review prescriptions', module: 'pharmacy-prescriptions', description: 'Approve or reject prescriptions awaiting a pharmacist.' },
  ],
})
