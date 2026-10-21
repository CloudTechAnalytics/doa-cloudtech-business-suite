import { BarChart3, Banknote, ClipboardCheck, PackageSearch, PackageX, Tags, Undo2 } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const base = { navGroup: 'Mart', owner: 'retail' as const }

/** Modules the retail industry owns. Stock, sales, purchasing and money use the shared modules; these add the mart's own screens. */
export const retailModules: ModuleDefinition[] = [
  { ...base, code: 'retail-products', name: 'Products', description: 'Products with categories, packs, barcodes and expiry tracking.', path: 'retail/products', permission: 'inventory.read', icon: PackageSearch },
  { ...base, code: 'retail-categories', name: 'Categories', description: 'Product categories.', path: 'retail/categories', permission: 'inventory.read', icon: Tags },
  { ...base, code: 'retail-counts', name: 'Stock Counts', description: 'Physical counts with manager approval.', path: 'retail/counts', permission: 'inventory.read', icon: ClipboardCheck },
  { ...base, code: 'retail-losses', name: 'Damaged & Expired', description: 'Damaged, expired and missing stock.', path: 'retail/losses', permission: 'inventory.read', icon: PackageX },
  { ...base, code: 'retail-returns', name: 'Supplier Returns', description: 'Goods sent back to suppliers.', path: 'retail/returns', permission: 'purchases.read', icon: Undo2 },
  { ...base, code: 'retail-shifts', name: 'Cashier Shifts', description: 'Opening cash, cash movements and closing variance.', path: 'retail/shifts', permission: 'sales.create', icon: Banknote },
  { ...base, code: 'retail-reports', name: 'Mart Reports', description: 'Sales, stock and profit reports.', path: 'retail/reports', permission: 'reports.finance.read', icon: BarChart3 },
]
