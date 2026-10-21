import type { IndustryRoute } from '@/core/industry-registry/types'
import { RetailCategoriesPage, RetailCountsPage, RetailLossesPage, RetailProductsPage, RetailReportsPage, RetailReturnsPage, RetailShiftsPage } from './lazyPages'

export const retailRoutes: IndustryRoute[] = [
  { module: 'retail-products', component: RetailProductsPage },
  { module: 'retail-categories', component: RetailCategoriesPage },
  { module: 'retail-counts', component: RetailCountsPage },
  { module: 'retail-losses', component: RetailLossesPage },
  { module: 'retail-returns', component: RetailReturnsPage },
  { module: 'retail-shifts', component: RetailShiftsPage },
  { module: 'retail-reports', component: RetailReportsPage },
]
