import type { NavSection } from '@/core/industry-registry/types'

/**
 * The bakery's sidebar, in the order a baker works: sales, products, production, recipes, stock, buying, money, people, reports.
 * Shared modules are listed here so they sit in the right place; a module named here is not repeated under the generic apps.
 */
export const bakeryNavigation: NavSection[] = [
  { label: 'Sales', modules: ['sales'] },
  { label: 'Products', modules: ['bakery-finished-goods'] },
  { label: 'Production', modules: ['bakery-production', 'bakery-waste'] },
  { label: 'Recipes', modules: ['bakery-recipes'] },
  { label: 'Inventory', modules: ['bakery-ingredients', 'inventory'] },
  { label: 'Purchases', modules: ['purchases'] },
  { label: 'Expenses', modules: ['expenses'] },
  { label: 'Customers', modules: ['customers'] },
  { label: 'Suppliers', modules: ['suppliers'] },
  { label: 'Staff', modules: ['staff'] },
  { label: 'Reports', modules: ['bakery-reports', 'reports'] },
  { label: 'Settings', modules: ['settings'] },
]
