import type { NavSection } from '@/core/industry-registry/types'

/**
 * The bakery's sidebar, in the order a baker works: sales, customers, products, production, inventory, purchases, expenses, staff.
 * Shared modules are listed here so they sit in the right place; a module named here is not repeated under the generic apps.
 */
export const bakeryNavigation: NavSection[] = [
  { label: 'Sales', modules: ['sales'] },
  { label: 'Customers', modules: ['customers'] },
  { label: 'Products', modules: ['bakery-finished-goods'] },
  { label: 'Production', modules: ['bakery-production', 'bakery-recipes', 'bakery-waste'] },
  { label: 'Inventory', modules: ['bakery-ingredients', 'inventory'] },
  { label: 'Purchases', modules: ['purchases', 'suppliers'] },
  { label: 'Expenses', modules: ['expenses'] },
  { label: 'Staff', modules: ['staff'] },
  { label: 'Reports', modules: ['bakery-reports', 'reports'] },
  { label: 'Settings', modules: ['settings'] },
]
