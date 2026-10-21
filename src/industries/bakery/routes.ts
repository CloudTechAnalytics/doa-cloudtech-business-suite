import type { IndustryRoute } from '@/core/industry-registry/types'
import { BakeryFinishedGoodsPage, BakeryIngredientsPage, BakeryProductionPage, BakeryRecipesPage } from './pages'

export const bakeryRoutes: IndustryRoute[] = [
  { module: 'bakery-ingredients', component: BakeryIngredientsPage },
  { module: 'bakery-recipes', component: BakeryRecipesPage },
  { module: 'bakery-production', component: BakeryProductionPage },
  { module: 'bakery-finished-goods', component: BakeryFinishedGoodsPage },
]
