import type { IndustryRoute } from '@/core/industry-registry/types'
import {
  FarmBatchesPage, FarmDailyPage, FarmExpensesPage, FarmFeedingPage, FarmHarvestsPage, FarmMortalityPage, FarmOverviewPage, FarmUnitsPage,
} from './pages'

export const farmRoutes: IndustryRoute[] = [
  { module: 'farm-overview', component: FarmOverviewPage },
  { module: 'farm-units', component: FarmUnitsPage },
  { module: 'farm-batches', component: FarmBatchesPage },
  { module: 'farm-daily', component: FarmDailyPage },
  { module: 'farm-feeding', component: FarmFeedingPage },
  { module: 'farm-mortality', component: FarmMortalityPage },
  { module: 'farm-harvests', component: FarmHarvestsPage },
  { module: 'farm-expenses', component: FarmExpensesPage },
]
