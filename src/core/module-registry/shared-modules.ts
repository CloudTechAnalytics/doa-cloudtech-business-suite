import { settingsModule } from '@/core/businesses/manifest'
import { crmModule } from '@/modules/crm/manifest'
import { expensesModule } from '@/modules/expenses/manifest'
import { inventoryModule } from '@/modules/inventory/manifest'
import { invoicesModule } from '@/modules/invoices/manifest'
import { purchasesModule, suppliersModule } from '@/modules/purchasing/manifest'
import { dashboardModule, reportsModule } from '@/modules/reporting/manifest'
import { salesModule } from '@/modules/sales/manifest'
import { staffModule } from '@/modules/staff/manifest'
import { SHARED_MODULE_CODES } from '@/shared/types/domain'
import type { SharedModule } from './types'

/** Every module the platform itself provides. Order sets the order within a sidebar group. */
export const SHARED_MODULES: SharedModule[] = [
  dashboardModule, inventoryModule, salesModule, purchasesModule, suppliersModule, crmModule, invoicesModule, expensesModule, reportsModule, staffModule, settingsModule,
]

// Fail fast if a manifest and the SharedModuleCode list drift apart.
const declared = SHARED_MODULES.map((m) => m.definition.code as string).sort()
if (declared.join() !== [...SHARED_MODULE_CODES].sort().join()) {
  throw new Error(`Shared module manifests (${declared.join(', ')}) do not match SHARED_MODULE_CODES`)
}
