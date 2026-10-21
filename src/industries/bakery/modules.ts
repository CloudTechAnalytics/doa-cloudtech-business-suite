import { BarChart3, BookOpen, CookingPot, PackageCheck, Trash2, Wheat } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const base = { navGroup: 'Bakery production', owner: 'bakery' as const }

/** Modules the bakery industry owns. Stock lives in the shared inventory ledger; these add recipes, production, expiry lots and waste. */
export const bakeryModules: ModuleDefinition[] = [
  { ...base, code: 'bakery-ingredients', name: 'Ingredients', description: 'Raw materials, stock levels and reorder alerts.', path: 'bakery/ingredients', permission: 'inventory.read', icon: Wheat },
  { ...base, code: 'bakery-recipes', name: 'Recipes', description: 'Versioned recipes with ingredient costs.', path: 'bakery/recipes', permission: 'bakery.read', icon: BookOpen },
  { ...base, code: 'bakery-production', name: 'Production', description: 'Plan batches, consume ingredients and add finished goods.', path: 'bakery/production', permission: 'bakery.record', icon: CookingPot },
  { ...base, code: 'bakery-finished-goods', name: 'Products', description: 'What you bake and sell, with shelf life and expiry.', path: 'bakery/finished-goods', permission: 'inventory.read', icon: PackageCheck },
  { ...base, code: 'bakery-waste', name: 'Waste', description: 'Waste, spoilage and expiry write-offs.', path: 'bakery/waste', permission: 'bakery.record', icon: Trash2 },
  { ...base, code: 'bakery-reports', name: 'Bakery Reports', description: 'Production, yield, waste and profit reports.', path: 'bakery/reports', permission: 'reports.finance.read', icon: BarChart3 },
]
