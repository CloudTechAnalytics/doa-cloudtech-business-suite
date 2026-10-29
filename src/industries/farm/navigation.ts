import type { NavSection } from '@/core/industry-registry/types'

/**
 * The farm's sidebar, in the order a farmer works: the day's work, the farm itself, selling, buying and stock, money.
 * Shared modules (inventory, sales, staff...) are listed here so they sit in the right group; a module named here is not repeated
 * under the generic apps. Farm Overview is not listed: the Dashboard shows it.
 */
export const farmNavigation: NavSection[] = [
  { label: 'Daily work', modules: ['farm-daily', 'farm-feeding', 'farm-mortality', 'farm-harvests', 'farm-tasks', 'farm-alerts'] },
  { label: 'My farm', modules: ['farm-batches', 'farm-crops', 'farm-units', 'farm-health', 'farm-equipment'] },
  { label: 'Selling', modules: ['customers', 'farm-sales-orders', 'sales', 'farm-products'] },
  { label: 'Buying and stock', modules: ['inventory', 'suppliers', 'farm-purchase-requests', 'purchases', 'farm-supplier-bills'] },
  // The shared Expenses page is the same page as the farm's Expenses, so it only shows when the farm's own is switched off.
  { label: 'Money', modules: ['farm-expenses', 'expenses', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'reports'], sameAs: { expenses: 'farm-expenses' } },
  { label: 'People and settings', modules: ['farm-workers', 'staff', 'settings'] },
]
