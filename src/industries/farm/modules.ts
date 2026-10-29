import { Bell, BookOpen, ClipboardCheck, ClipboardPen, FileText, HandCoins, ListChecks, Sprout, Stethoscope, UserRound, Wallet, Wrench, Bird, ClipboardList, PackageSearch, HeartPulse, LayoutDashboard, MapPinned, Receipt, Utensils, Wheat } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const GROUP = 'Farm operations'
const base = { navGroup: GROUP, owner: 'farm' as const }

/** Modules the farm industry owns. Their data tables arrive with the farm module build. */
export const farmModules: ModuleDefinition[] = [
  { ...base, code: 'farm-overview', name: 'Farm Overview', description: 'Farm profile and production summary.', path: 'farm/overview', permission: 'farm.read', icon: LayoutDashboard },
  { ...base, code: 'farm-units', name: 'Pens, Ponds & Fields', description: 'Where your animals and crops are kept: pens, houses, ponds, fields.', path: 'farm/units', permission: 'farm.read', icon: MapPinned },
  { ...base, code: 'farm-batches', name: 'Flocks & Batches', description: 'Each flock, fish stock, herd or crop, with its count, feed and harvests.', path: 'farm/batches', permission: 'farm.read', icon: Bird },
  { ...base, code: 'farm-daily', name: 'Record Today', description: 'Record feeding, deaths, eggs and harvests, and notes, all in one place.', path: 'farm/daily', permission: 'farm.record', icon: ClipboardList },
  { ...base, code: 'farm-feeding', name: 'Feeding', description: 'Feed given to each flock or pond.', path: 'farm/feeding', permission: 'farm.record', icon: Utensils },
  { ...base, code: 'farm-mortality', name: 'Deaths', description: 'Animals that died and the death rate.', path: 'farm/mortality', permission: 'farm.record', icon: HeartPulse },
  { ...base, code: 'farm-harvests', name: 'Harvests & Eggs', description: 'Eggs, fish, crops and other produce collected.', path: 'farm/harvests', permission: 'farm.record', icon: Wheat },
  { ...base, code: 'farm-products', name: 'Products & Prices', description: 'What the farm sells, in which unit and at what price.', path: 'farm/products', permission: 'farm.read', icon: PackageSearch },
  { ...base, code: 'farm-expenses', name: 'Expenses', description: 'Money spent on the farm, by flock or crop.', path: 'farm/expenses', permission: 'expenses.read', icon: Receipt },
  { ...base, code: 'farm-alerts', name: 'Alerts', description: 'Low stock, many deaths and overdue work in one place.', path: 'farm/alerts', permission: 'farm.read', icon: Bell },
  { ...base, code: 'farm-tasks', name: 'Tasks', description: 'Assign and track farm work.', path: 'farm/tasks', permission: 'farm.read', icon: ListChecks },
  { ...base, code: 'farm-health', name: 'Health & Treatments', description: 'Medicines and vaccines given, and how long to wait before selling.', path: 'farm/health', permission: 'farm.read', icon: Stethoscope },
  { ...base, code: 'farm-equipment', name: 'Equipment', description: 'Machines, maintenance and repairs.', path: 'farm/equipment', permission: 'farm.read', icon: Wrench },
  { ...base, code: 'farm-crops', name: 'Crops', description: 'Each crop from planting to harvest.', path: 'farm/crops', permission: 'farm.read', icon: Sprout },
  { ...base, code: 'farm-purchase-requests', name: 'Purchase Requests', description: 'Request and approve purchases before ordering.', path: 'farm/purchase-requests', permission: 'procurement.request', icon: ClipboardCheck },
  { ...base, code: 'farm-supplier-bills', name: 'Supplier Bills', description: 'Bills from suppliers and what is still owed.', path: 'farm/supplier-bills', permission: 'purchases.read', icon: FileText },
  { ...base, code: 'farm-sales-orders', name: 'Customer Orders', description: 'Orders customers place before they are delivered and billed.', path: 'farm/sales-orders', permission: 'sales.read', icon: ClipboardPen },
  { ...base, code: 'farm-receivables', name: 'Owed to You', description: 'What customers still owe the farm.', path: 'farm/receivables', permission: 'reports.finance.read', icon: HandCoins },
  { ...base, code: 'farm-payables', name: 'You Owe', description: 'What the farm still owes suppliers.', path: 'farm/payables', permission: 'reports.finance.read', icon: Wallet },
  { ...base, code: 'farm-cashbook', name: 'Cash & Bank', description: 'Money in and out of cash and bank, day by day.', path: 'farm/cashbook', permission: 'reports.finance.read', icon: BookOpen },
  { ...base, code: 'farm-workers', name: 'Farm Workers', description: 'Farm workers, their jobs and pay.', path: 'farm/workers', permission: 'farm.manage', icon: UserRound },
]
