import type { NavSection } from '@/core/industry-registry/types'

/**
 * The mart's sidebar in the order a shopkeeper works. Shared modules are listed here so they sit in the right place; a module
 * named here is not repeated under the generic apps.
 */
export const retailNavigation: NavSection[] = [
  { label: 'Sales', modules: ['sales', 'retail-shifts'] },
  { label: 'Products', modules: ['retail-products', 'retail-categories'] },
  { label: 'Inventory', modules: ['inventory', 'retail-counts', 'retail-losses'] },
  { label: 'Purchases', modules: ['purchases', 'retail-returns'] },
  { label: 'Suppliers', modules: ['suppliers'] },
  { label: 'Customers', modules: ['customers'] },
  { label: 'Expenses', modules: ['expenses'] },
  { label: 'Staff', modules: ['staff'] },
  { label: 'Reports', modules: ['retail-reports', 'reports'] },
  { label: 'Settings', modules: ['settings'] },
]
