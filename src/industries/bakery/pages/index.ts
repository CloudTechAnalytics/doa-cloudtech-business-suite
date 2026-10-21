import { lazy } from 'react'

// Each screen is loaded on demand, keeping the industry registry light and giving the bakery its own bundle.
export const BakeryIngredientsPage = lazy(() => import('./BakeryIngredientsPage').then((m) => ({ default: m.BakeryIngredientsPage })))
export const BakeryRecipesPage = lazy(() => import('./BakeryRecipesPage').then((m) => ({ default: m.BakeryRecipesPage })))
export const BakeryProductionPage = lazy(() => import('./BakeryProductionPage').then((m) => ({ default: m.BakeryProductionPage })))
export const BakeryFinishedGoodsPage = lazy(() => import('./BakeryProductsPage').then((m) => ({ default: m.BakeryProductsPage })))
export const BakeryWastePage = lazy(() => import('./BakeryWastePage').then((m) => ({ default: m.BakeryWastePage })))
export const BakeryReportsPage = lazy(() => import('./BakeryReportsPage').then((m) => ({ default: m.BakeryReportsPage })))
