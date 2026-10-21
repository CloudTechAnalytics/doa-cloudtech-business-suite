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

/** Farm expenses need the shared expenses module, which is not built yet, so this screen stays a placeholder. */
export const FarmExpensesPage = placeholderPage(farmModules.find((m) => m.code === 'farm-expenses')!)
