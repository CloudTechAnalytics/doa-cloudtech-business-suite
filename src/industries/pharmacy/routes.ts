import type { IndustryRoute } from '@/core/industry-registry/types'
import { PharmacyBatchesPage, PharmacyCategoriesPage, PharmacyCountsPage, PharmacyLossesPage, PharmacyMedicinesPage, PharmacyPrescriptionsPage, PharmacyReportsPage, PharmacyReturnsPage, PharmacyShiftsPage } from './lazyPages'

export const pharmacyRoutes: IndustryRoute[] = [
  { module: 'pharmacy-products', component: PharmacyMedicinesPage },
  { module: 'pharmacy-categories', component: PharmacyCategoriesPage },
  { module: 'pharmacy-batches', component: PharmacyBatchesPage },
  { module: 'pharmacy-prescriptions', component: PharmacyPrescriptionsPage },
  { module: 'pharmacy-counts', component: PharmacyCountsPage },
  { module: 'pharmacy-losses', component: PharmacyLossesPage },
  { module: 'pharmacy-returns', component: PharmacyReturnsPage },
  { module: 'pharmacy-shifts', component: PharmacyShiftsPage },
  { module: 'pharmacy-reports', component: PharmacyReportsPage },
]
