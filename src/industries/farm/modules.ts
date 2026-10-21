import { Bell, BookOpen, ClipboardCheck, ClipboardPen, FileText, HandCoins, ListChecks, Sprout, Stethoscope, UserRound, Wallet, Wrench, Bird, ClipboardList, PackageSearch, HeartPulse, LayoutDashboard, MapPinned, Receipt, Utensils, Wheat } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const GROUP = 'Farm operations'
const base = { navGroup: GROUP, owner: 'farm' as const }

/** Modules the farm industry owns. Their data tables arrive with the farm module build. */
export const farmModules: ModuleDefinition[] = [
  { ...base, code: 'farm-overview', name: 'Farm Overview', description: 'Farm profile and production summary.', path: 'farm/overview', permission: 'farm.read', icon: LayoutDashboard },
  { ...base, code: 'farm-units', name: 'Production Units', description: 'Pens, ponds, plots and other farm units.', path: 'farm/units', permission: 'farm.read', icon: MapPinned },
  { ...base, code: 'farm-batches', name: 'Farm Batches', description: 'Production cycles and batches.', path: 'farm/batches', permission: 'farm.read', icon: Bird },
  { ...base, code: 'farm-daily', name: 'Daily Operations', description: 'Daily activity records per batch.', path: 'farm/daily', permission: 'farm.record', icon: ClipboardList },
  { ...base, code: 'farm-feeding', name: 'Feeding', description: 'Feeding records and feed consumption.', path: 'farm/feeding', permission: 'farm.record', icon: Utensils },
  { ...base, code: 'farm-mortality', name: 'Mortality', description: 'Mortality records and rates.', path: 'farm/mortality', permission: 'farm.record', icon: HeartPulse },
  { ...base, code: 'farm-harvests', name: 'Harvests', description: 'Harvest and production output records.', path: 'farm/harvests', permission: 'farm.record', icon: Wheat },
  { ...base, code: 'farm-products', name: 'Farm Products', description: 'What the farm sells, in which unit and at what price.', path: 'farm/products', permission: 'farm.read', icon: PackageSearch },
  { ...base, code: 'farm-expenses', name: 'Farm Expenses', description: 'Labour and operating costs by batch.', path: 'farm/expenses', permission: 'expenses.read', icon: Receipt },
  // Screens from the reference farm system that are not built here yet. They show an honest placeholder.
  { ...base, code: 'farm-alerts', name: 'Alerts', description: 'Low stock, high mortality and overdue work in one place.', path: 'farm/alerts', permission: 'farm.read', icon: Bell },
  { ...base, code: 'farm-tasks', name: 'Tasks', description: 'Assign and track farm work.', path: 'farm/tasks', permission: 'farm.read', icon: ListChecks },
  { ...base, code: 'farm-health', name: 'Health & Biosecurity', description: 'Treatments, vaccinations and withdrawal periods.', path: 'farm/health', permission: 'farm.read', icon: Stethoscope },
  { ...base, code: 'farm-equipment', name: 'Equipment', description: 'Machines, maintenance and repairs.', path: 'farm/equipment', permission: 'farm.read', icon: Wrench },
  { ...base, code: 'farm-crops', name: 'Crops', description: 'Crop cycles from planting to harvest.', path: 'farm/crops', permission: 'farm.read', icon: Sprout },
  { ...base, code: 'farm-purchase-requests', name: 'Purchase Requests', description: 'Request and approve purchases before ordering.', path: 'farm/purchase-requests', permission: 'procurement.request', icon: ClipboardCheck },
  { ...base, code: 'farm-supplier-bills', name: 'Supplier Bills', description: 'Bills from suppliers and what is still owed.', path: 'farm/supplier-bills', permission: 'purchases.read', icon: FileText },
  { ...base, code: 'farm-sales-orders', name: 'Sales Orders', description: 'Customer orders before they are invoiced.', path: 'farm/sales-orders', permission: 'sales.read', icon: ClipboardPen },
  { ...base, code: 'farm-receivables', name: 'Receivables', description: 'What customers still owe the farm.', path: 'farm/receivables', permission: 'reports.finance.read', icon: HandCoins },
  { ...base, code: 'farm-payables', name: 'Payables', description: 'What the farm still owes suppliers.', path: 'farm/payables', permission: 'reports.finance.read', icon: Wallet },
  { ...base, code: 'farm-cashbook', name: 'Cashbook', description: 'Cash and bank movements in date order.', path: 'farm/cashbook', permission: 'reports.finance.read', icon: BookOpen },
  { ...base, code: 'farm-workers', name: 'Workers', description: 'Farm workers, roles and pay.', path: 'farm/workers', permission: 'farm.manage', icon: UserRound },
]
