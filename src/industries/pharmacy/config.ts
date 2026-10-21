import { Pill } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

/** Pharmacy composes the shared modules (stock, sales, purchasing, expenses) and adds batches and expiry, prescriptions and dispensing. */
export const pharmacyConfig = {
  id: 'pharmacy' as const,
  name: 'Pharmacy & Medicine Store',
  description: 'Pharmacies and medicine stores: batches, expiry, prescriptions and dispensing.',
  appName: 'Pharmacy',
  category: 'Shops & trade',
  icon: Pill,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: ['sales'] as SharedModuleCode[],
  optionalSharedModules: [] as SharedModuleCode[],
  defaultModules: [
    'pharmacy-products', 'pharmacy-categories', 'pharmacy-batches', 'pharmacy-prescriptions', 'pharmacy-counts', 'pharmacy-losses', 'pharmacy-returns', 'pharmacy-shifts', 'pharmacy-reports',
    'inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports',
  ] as ModuleCode[],
  optionalModules: [] as ModuleCode[],
  requiredModules: ['sales'] as ModuleCode[],
}
