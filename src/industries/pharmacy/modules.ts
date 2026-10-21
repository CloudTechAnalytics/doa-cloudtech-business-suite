import { BarChart3, Banknote, CalendarClock, ClipboardCheck, FileText, PackageX, Pill, Tags, Undo2 } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const base = { navGroup: 'Pharmacy', owner: 'pharmacy' as const }

/** Modules the pharmacy industry owns. Stock, sales, purchasing and money use the shared modules; these add the pharmacy's own screens. */
export const pharmacyModules: ModuleDefinition[] = [
  { ...base, code: 'pharmacy-products', name: 'Medicines', description: 'Medicine catalogue with classification, units and barcodes.', path: 'pharmacy/medicines', permission: 'inventory.read', icon: Pill },
  { ...base, code: 'pharmacy-categories', name: 'Categories', description: 'Medicine categories.', path: 'pharmacy/categories', permission: 'inventory.read', icon: Tags },
  { ...base, code: 'pharmacy-batches', name: 'Batches & Expiry', description: 'Batch balances, expiry, quarantine and disposal.', path: 'pharmacy/batches', permission: 'inventory.read', icon: CalendarClock },
  { ...base, code: 'pharmacy-prescriptions', name: 'Prescriptions', description: 'Prescription records, pharmacist review and dispensing.', path: 'pharmacy/prescriptions', permission: 'pharmacy.rx', icon: FileText },
  { ...base, code: 'pharmacy-counts', name: 'Stock Counts', description: 'Physical counts with manager approval.', path: 'pharmacy/counts', permission: 'inventory.read', icon: ClipboardCheck },
  { ...base, code: 'pharmacy-losses', name: 'Damaged & Expired', description: 'Damaged, expired and missing stock.', path: 'pharmacy/losses', permission: 'inventory.read', icon: PackageX },
  { ...base, code: 'pharmacy-returns', name: 'Supplier Returns', description: 'Goods sent back to suppliers.', path: 'pharmacy/returns', permission: 'purchases.read', icon: Undo2 },
  { ...base, code: 'pharmacy-shifts', name: 'Cashier Shifts', description: 'Opening cash, cash movements and closing variance.', path: 'pharmacy/shifts', permission: 'sales.create', icon: Banknote },
  { ...base, code: 'pharmacy-reports', name: 'Pharmacy Reports', description: 'Sales, stock, expiry and profit reports.', path: 'pharmacy/reports', permission: 'reports.finance.read', icon: BarChart3 },
]
