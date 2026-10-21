import { Bird, ClipboardList, HeartPulse, LayoutDashboard, MapPinned, Receipt, Utensils, Wheat } from 'lucide-react'
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
  { ...base, code: 'farm-expenses', name: 'Farm Expenses', description: 'Labour and operating costs by batch.', path: 'farm/expenses', permission: 'expenses.read', icon: Receipt, maturity: 'soon' },
]
