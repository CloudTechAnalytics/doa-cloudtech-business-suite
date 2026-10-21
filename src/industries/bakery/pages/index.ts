import { placeholderPage } from '@/shared/components/widgets'
import { bakeryModules } from '../modules'

const def = (code: string) => bakeryModules.find((m) => m.code === code)!

export const BakeryIngredientsPage = placeholderPage(def('bakery-ingredients'))
export const BakeryRecipesPage = placeholderPage(def('bakery-recipes'))
export const BakeryProductionPage = placeholderPage(def('bakery-production'))
export const BakeryFinishedGoodsPage = placeholderPage(def('bakery-finished-goods'))
