import { ArrowLeftRight, ClipboardCheck, History, MapPin, Package, PackagePlus, SlidersHorizontal, Tags, Warehouse } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const inventoryModule: SharedModule = {
  definition: {
    code: 'inventory', name: 'Inventory', description: 'Products, units, locations, stock movements, transfers and counts.', path: 'inventory',
    permission: 'inventory.read', icon: Package, navGroup: 'Stock and purchasing', owner: 'platform',
    quickAction: { label: 'Receive stock', query: 'tab=receive' },
    sections: [
      { key: 'stock', label: 'Stock', icon: Warehouse }, { key: 'products', label: 'Products', icon: Tags }, { key: 'counts', label: 'Counts', icon: ClipboardCheck },
      { key: 'movements', label: 'Movements', icon: History }, { key: 'receive', label: 'Receive', icon: PackagePlus }, { key: 'adjust', label: 'Adjust / issue', icon: SlidersHorizontal },
      { key: 'transfer', label: 'Transfer', icon: ArrowLeftRight }, { key: 'locations', label: 'Locations', icon: MapPin },
    ],
  },
  page: lazy(() => import('./InventoryPage').then((m) => ({ default: m.InventoryPage }))),
}
