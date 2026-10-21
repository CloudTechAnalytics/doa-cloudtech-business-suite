import { BookOpen, CookingPot, PackageCheck, Wheat } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const base = { navGroup: 'Bakery production', owner: 'bakery' as const, maturity: 'preview' as const }

/** Modules the bakery industry owns. Recipes, production batches and their tables arrive with the bakery build. */
export const bakeryModules: ModuleDefinition[] = [
  { ...base, code: 'bakery-ingredients', name: 'Ingredients', description: 'Ingredient inventory and unit conversions.', path: 'bakery/ingredients', permission: 'inventory.read', icon: Wheat },
  { ...base, code: 'bakery-recipes', name: 'Recipes', description: 'Versioned recipes and bills of materials.', path: 'bakery/recipes', permission: 'bakery.read', icon: BookOpen },
  { ...base, code: 'bakery-production', name: 'Production', description: 'Production batches, consumption and wastage.', path: 'bakery/production', permission: 'bakery.record', icon: CookingPot },
  { ...base, code: 'bakery-finished-goods', name: 'Finished Goods', description: 'Finished-goods stock from production.', path: 'bakery/finished-goods', permission: 'inventory.read', icon: PackageCheck },
]
