import { ShoppingBasket } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const salesModule: SharedModule = {
  definition: {
    code: 'sales', name: 'Sales / POS', description: 'Point of sale, payments, receipts, returns and sales history.', path: 'sales',
    permission: 'sales.read', icon: ShoppingBasket, navGroup: 'Sales and customers', owner: 'platform',
    quickAction: { label: 'New sale' },
  },
  page: lazy(() => import('./SalesPage').then((m) => ({ default: m.SalesPage }))),
}
