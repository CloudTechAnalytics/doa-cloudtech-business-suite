import { lazy } from 'react'
import { placeholderPage } from '@/shared/components/widgets'
import { farmModules } from '../modules'

// Each screen is loaded on demand, keeping the industry registry light and giving the farm its own bundle.
export const FarmOverviewPage = lazy(() => import('./FarmOverviewPage').then((m) => ({ default: m.FarmOverviewPage })))
export const FarmUnitsPage = lazy(() => import('./FarmUnitsPage').then((m) => ({ default: m.FarmUnitsPage })))
export const FarmBatchesPage = lazy(() => import('./FarmBatchesPage').then((m) => ({ default: m.FarmBatchesPage })))
export const FarmDailyPage = lazy(() => import('./FarmDailyPage').then((m) => ({ default: m.FarmDailyPage })))
export const FarmFeedingPage = lazy(() => import('./FarmFeedingPage').then((m) => ({ default: m.FarmFeedingPage })))
export const FarmMortalityPage = lazy(() => import('./FarmMortalityPage').then((m) => ({ default: m.FarmMortalityPage })))
export const FarmHarvestsPage = lazy(() => import('./FarmHarvestsPage').then((m) => ({ default: m.FarmHarvestsPage })))
export const FarmProductsPage = lazy(() => import('./FarmProductsPage').then((m) => ({ default: m.FarmProductsPage })))

// Money screens are shared with the platform's finance module; the farm lists them in its own sidebar groups.
export const FarmExpensesPage = lazy(() => import('@/modules/finance/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
export const FarmReceivablesPage = lazy(() => import('@/modules/finance/OwedPages').then((m) => ({ default: m.ReceivablesPage })))
export const FarmPayablesPage = lazy(() => import('@/modules/finance/OwedPages').then((m) => ({ default: m.PayablesPage })))
export const FarmWorkersPage = lazy(() => import('./FarmWorkersPage').then((m) => ({ default: m.FarmWorkersPage })))
export const FarmTasksPage = lazy(() => import('./FarmTasksPage').then((m) => ({ default: m.FarmTasksPage })))
export const FarmHealthPage = lazy(() => import('./FarmHealthPage').then((m) => ({ default: m.FarmHealthPage })))
export const FarmEquipmentPage = lazy(() => import('./FarmEquipmentPage').then((m) => ({ default: m.FarmEquipmentPage })))
export const FarmCropsPage = lazy(() => import('./FarmCropsPage').then((m) => ({ default: m.FarmCropsPage })))
export const FarmAlertsPage = lazy(() => import('./FarmAlertsPage').then((m) => ({ default: m.FarmAlertsPage })))
export const FarmPurchaseRequestsPage = lazy(() => import('@/modules/orders/PurchaseRequestsPage').then((m) => ({ default: m.PurchaseRequestsPage })))
export const FarmSupplierBillsPage = lazy(() => import('@/modules/orders/SupplierBillsPage').then((m) => ({ default: m.SupplierBillsPage })))
export const FarmSalesOrdersPage = lazy(() => import('@/modules/orders/SalesOrdersPage').then((m) => ({ default: m.SalesOrdersPage })))
export const FarmCashbookPage = lazy(() => import('@/modules/finance/CashbookPage').then((m) => ({ default: m.CashbookPage })))

/** Reference-system screens not built yet: one honest placeholder each, driven by the module list. */
export const farmPlaceholders = farmModules
  .filter((m) => m.maturity === 'soon')
  .map((m) => ({ module: m.code, component: placeholderPage(m) }))
