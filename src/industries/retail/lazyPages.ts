import { lazy } from 'react'

// Each screen is loaded on demand, keeping the industry registry light and giving the mart its own bundle.
export const RetailProductsPage = lazy(() => import('./pages/RetailProductsPage').then((m) => ({ default: m.RetailProductsPage })))
export const RetailCategoriesPage = lazy(() => import('./pages/RetailCategoriesPage').then((m) => ({ default: m.RetailCategoriesPage })))
export const RetailCountsPage = lazy(() => import('./pages/RetailCountsPage').then((m) => ({ default: m.RetailCountsPage })))
export const RetailLossesPage = lazy(() => import('./pages/RetailLossesPage').then((m) => ({ default: m.RetailLossesPage })))
export const RetailReturnsPage = lazy(() => import('./pages/RetailReturnsPage').then((m) => ({ default: m.RetailReturnsPage })))
export const RetailShiftsPage = lazy(() => import('./pages/RetailShiftsPage').then((m) => ({ default: m.RetailShiftsPage })))
export const RetailReportsPage = lazy(() => import('./pages/RetailReportsPage').then((m) => ({ default: m.RetailReportsPage })))
