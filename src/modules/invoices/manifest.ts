import { Clock, FileText, ScrollText } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

/** DOA Invoices: a standalone app. Customers come from the CRM; payments feed Finance through the shared cashbook and receivables. */
export const invoicesModule: SharedModule = {
  definition: {
    code: 'invoices', name: 'Invoices', description: 'Invoices from accepted quotes, payments and what is owed.', path: 'invoices',
    permission: 'invoices.read', icon: FileText, navGroup: 'Sales and customers', owner: 'platform',
    quickAction: { label: 'New invoice' },
    sections: [{ key: 'invoices', label: 'Invoices', icon: FileText }, { key: 'statements', label: 'Statements', icon: ScrollText }, { key: 'ageing', label: 'Ageing', icon: Clock }],
  },
  page: lazy(() => import('./InvoicesPage').then((m) => ({ default: m.InvoicesPage }))),
}
