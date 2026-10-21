import { Store } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

/** Retail composes shared modules only; it owns no modules of its own. */
export const retailConfig = {
  id: 'retail' as const,
  name: 'Retail & Supermarket',
  description: 'Shops, supermarkets and wholesalers.',
  category: 'Shops & trade',
  icon: Store,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: ['sales'] as SharedModuleCode[],
  optionalSharedModules: [] as SharedModuleCode[],
  defaultModules: ['inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports'] as ModuleCode[],
  optionalModules: [] as ModuleCode[],
  requiredModules: ['sales'] as ModuleCode[],
}
