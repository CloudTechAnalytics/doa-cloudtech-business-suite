import type { IndustryRoute } from '@/core/industry-registry/types'
import {
  FarmBatchesPage, FarmDailyPage, FarmExpensesPage, FarmFeedingPage, FarmHarvestsPage, FarmMortalityPage, FarmOverviewPage, FarmProductsPage, FarmUnitsPage, FarmAlertsPage, FarmCropsPage, FarmEquipmentPage, FarmHealthPage, FarmTasksPage, FarmWorkersPage, FarmCashbookPage, FarmPayablesPage, FarmReceivablesPage, FarmPurchaseRequestsPage, FarmSalesOrdersPage, FarmSupplierBillsPage, farmPlaceholders,
} from './pages'

export const farmRoutes: IndustryRoute[] = [
  { module: 'farm-overview', component: FarmOverviewPage },
  { module: 'farm-units', component: FarmUnitsPage },
  { module: 'farm-batches', component: FarmBatchesPage },
  { module: 'farm-daily', component: FarmDailyPage },
  { module: 'farm-feeding', component: FarmFeedingPage },
  { module: 'farm-mortality', component: FarmMortalityPage },
  { module: 'farm-harvests', component: FarmHarvestsPage },
  { module: 'farm-products', component: FarmProductsPage },
  { module: 'farm-expenses', component: FarmExpensesPage },
  { module: 'farm-receivables', component: FarmReceivablesPage },
  { module: 'farm-payables', component: FarmPayablesPage },
  { module: 'farm-cashbook', component: FarmCashbookPage },
  { module: 'farm-purchase-requests', component: FarmPurchaseRequestsPage },
  { module: 'farm-supplier-bills', component: FarmSupplierBillsPage },
  { module: 'farm-sales-orders', component: FarmSalesOrdersPage },
  { module: 'farm-alerts', component: FarmAlertsPage },
  { module: 'farm-tasks', component: FarmTasksPage },
  { module: 'farm-health', component: FarmHealthPage },
  { module: 'farm-equipment', component: FarmEquipmentPage },
  { module: 'farm-crops', component: FarmCropsPage },
  { module: 'farm-workers', component: FarmWorkersPage },
  ...farmPlaceholders,
]
