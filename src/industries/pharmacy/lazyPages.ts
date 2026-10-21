import { lazy } from 'react'

// Each screen is loaded on demand. Categories, counts, losses, supplier returns, shifts and reports are the mart's screens: they run on
// the same stock ledger and functions, which a pharmacy business reaches through its own pharmacy-* modules.
export const PharmacyMedicinesPage = lazy(() => import('./pages/PharmacyMedicinesPage').then((m) => ({ default: m.PharmacyMedicinesPage })))
export const PharmacyBatchesPage = lazy(() => import('./pages/PharmacyBatchesPage').then((m) => ({ default: m.PharmacyBatchesPage })))
export const PharmacyPrescriptionsPage = lazy(() => import('./pages/PharmacyPrescriptionsPage').then((m) => ({ default: m.PharmacyPrescriptionsPage })))
export const PharmacyCategoriesPage = lazy(() => import('../retail/pages/RetailCategoriesPage').then((m) => ({ default: m.RetailCategoriesPage })))
export const PharmacyCountsPage = lazy(() => import('../retail/pages/RetailCountsPage').then((m) => ({ default: m.RetailCountsPage })))
export const PharmacyLossesPage = lazy(() => import('../retail/pages/RetailLossesPage').then((m) => ({ default: m.RetailLossesPage })))
export const PharmacyReturnsPage = lazy(() => import('../retail/pages/RetailReturnsPage').then((m) => ({ default: m.RetailReturnsPage })))
export const PharmacyShiftsPage = lazy(() => import('../retail/pages/RetailShiftsPage').then((m) => ({ default: m.RetailShiftsPage })))
export const PharmacyReportsPage = lazy(() => import('../retail/pages/RetailReportsPage').then((m) => ({ default: m.RetailReportsPage })))
