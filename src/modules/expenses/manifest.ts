import { Receipt } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'
import type { ModuleDefinition } from '@/shared/types/domain'

const def: ModuleDefinition = {
  code: 'expenses', name: 'Expenses', description: 'Expense categories, records, approvals and summaries.', path: 'expenses',
  permission: 'expenses.read', icon: Receipt, navGroup: 'Finance', owner: 'platform',
}

export const expensesModule: SharedModule = { definition: def, page: lazy(() => import('@/modules/finance/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))) }
