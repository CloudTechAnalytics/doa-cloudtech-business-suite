import { Store } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

/** Retail composes the shared modules and adds the mart's own: products and packs, stock counts, losses, supplier returns and cashier shifts. */
export const retailConfig = {
  id: 'retail' as const,
  name: 'Retail & Supermarket',
  description: 'Shops, supermarkets and wholesalers.',
  appName: 'Mart',
  category: 'Shops & trade',
  icon: Store,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: ['sales'] as SharedModuleCode[],
  optionalSharedModules: [] as SharedModuleCode[],
  defaultModules: [
    'retail-products', 'retail-categories', 'retail-counts', 'retail-losses', 'retail-returns', 'retail-shifts', 'retail-reports',
    'inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports',
  ] as ModuleCode[],
  optionalModules: ['invoices'] as ModuleCode[],
  requiredModules: ['sales'] as ModuleCode[],
}
