import { Tractor } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

export const farmConfig = {
  id: 'farm' as const,
  name: 'Farm Management',
  description: 'Poultry, fishery, crops and livestock.',
  category: 'Farming & food',
  appName: 'Farm operations',
  icon: Tractor,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: ['inventory', 'sales'] as SharedModuleCode[],
  optionalSharedModules: ['purchases', 'suppliers', 'expenses', 'customers'] as SharedModuleCode[],
  defaultModules: [
    'farm-overview', 'farm-units', 'farm-batches', 'farm-daily', 'farm-feeding', 'farm-mortality', 'farm-harvests', 'farm-products', 'farm-expenses',
    'farm-alerts', 'farm-tasks', 'farm-health', 'farm-equipment', 'farm-crops', 'farm-purchase-requests', 'farm-supplier-bills', 'farm-sales-orders', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'farm-workers',
    'inventory', 'sales', 'reports',
  ] as ModuleCode[],
  optionalModules: ['purchases', 'suppliers', 'expenses', 'customers'] as ModuleCode[],
  requiredModules: ['farm-overview'] as ModuleCode[],
}
