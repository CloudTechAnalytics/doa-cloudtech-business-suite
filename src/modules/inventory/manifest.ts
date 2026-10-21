import { Package } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const inventoryModule: SharedModule = {
  definition: {
    code: 'inventory', name: 'Inventory', description: 'Products, units, locations, stock movements, transfers and counts.', path: 'inventory',
    permission: 'inventory.read', icon: Package, navGroup: 'Stock and purchasing', owner: 'platform',
    quickAction: { label: 'Receive stock', query: 'tab=Receive' },
  },
  page: lazy(() => import('./InventoryPage').then((m) => ({ default: m.InventoryPage }))),
}
