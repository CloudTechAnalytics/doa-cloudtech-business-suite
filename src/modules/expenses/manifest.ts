import { Receipt } from 'lucide-react'
import type { SharedModule } from '@/core/module-registry/types'
import { placeholderPage } from '@/shared/components/widgets'
import type { ModuleDefinition } from '@/shared/types/domain'

const def: ModuleDefinition = {
  code: 'expenses', name: 'Expenses', description: 'Expense categories, records, approvals and summaries.', path: 'expenses',
  permission: 'expenses.read', icon: Receipt, navGroup: 'Finance', owner: 'platform', maturity: 'soon',
}

/** Registered, plan-gated and permission-checked; its tables and screens are not built yet. */
export const expensesModule: SharedModule = { definition: def, page: placeholderPage(def) }
