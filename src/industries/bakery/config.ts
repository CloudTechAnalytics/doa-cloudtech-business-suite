import { Croissant } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

export const bakeryConfig = {
  id: 'bakery' as const,
  name: 'Bakery & Food Production',
  description: 'Recipes, production batches and finished goods.',
  appName: 'Bakery production',
  category: 'Farming & food',
  icon: Croissant,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: ['inventory', 'sales'] as SharedModuleCode[],
  optionalSharedModules: ['customers'] as SharedModuleCode[],
  defaultModules: [
    'bakery-ingredients', 'bakery-recipes', 'bakery-production', 'bakery-finished-goods', 'bakery-waste', 'bakery-reports',
    'inventory', 'sales', 'purchases', 'suppliers', 'expenses', 'reports',
  ] as ModuleCode[],
  optionalModules: ['customers'] as ModuleCode[],
  requiredModules: ['bakery-production'] as ModuleCode[],
}
