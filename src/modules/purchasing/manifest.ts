import { FileInput, Truck } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const purchasesModule: SharedModule = {
  definition: {
    code: 'purchases', name: 'Purchases', description: 'Purchase orders, goods received and supplier payments.', path: 'purchases',
    permission: 'purchases.read', icon: FileInput, navGroup: 'Stock and purchasing', owner: 'platform',
    quickAction: { label: 'New purchase order' },
  },
  page: lazy(() => import('./PurchasesPage').then((m) => ({ default: m.PurchasesPage }))),
}

export const suppliersModule: SharedModule = {
  definition: {
    code: 'suppliers', name: 'Suppliers', description: 'Supplier records and purchase history.', path: 'suppliers',
    permission: 'suppliers.read', icon: Truck, navGroup: 'Stock and purchasing', owner: 'platform',
  },
  page: lazy(() => import('./SuppliersPage').then((m) => ({ default: m.SuppliersPage }))),
}
