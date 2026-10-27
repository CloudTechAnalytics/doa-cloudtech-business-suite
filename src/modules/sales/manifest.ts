import { BarChart3, History, ShoppingBasket } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const salesModule: SharedModule = {
  definition: {
    code: 'sales', name: 'Sales / POS', description: 'Point of sale, payments, receipts, returns and sales history.', path: 'sales',
    permission: 'sales.read', icon: ShoppingBasket, navGroup: 'Sales and customers', owner: 'platform',
    quickAction: { label: 'New sale' },
    sections: [{ key: 'new', label: 'New sale', icon: ShoppingBasket }, { key: 'history', label: 'History', icon: History }, { key: 'today', label: 'Today', icon: BarChart3 }],
  },
  page: lazy(() => import('./SalesPage').then((m) => ({ default: m.SalesPage }))),
}
