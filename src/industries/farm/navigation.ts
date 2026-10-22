import type { NavSection } from '@/core/industry-registry/types'

/**
 * The farm's sidebar, grouped like the reference farm system, with selling and customers ahead of stock and procurement.
 * Shared modules (inventory, sales, staff...) are listed here so they sit in the right group; a module named here is not repeated
 * under the generic apps. Farm Overview is not listed: the Dashboard shows it.
 */
export const farmNavigation: NavSection[] = [
  { label: 'Overview', modules: ['farm-alerts'] },
  { label: 'Farm operations', modules: ['farm-daily', 'farm-tasks', 'farm-health', 'farm-equipment'] },
  { label: 'Production', modules: ['farm-units', 'farm-batches', 'farm-feeding', 'farm-mortality', 'farm-harvests', 'farm-crops'] },
  { label: 'Sales and customers', modules: ['customers', 'sales', 'farm-sales-orders', 'farm-products'] },
  { label: 'Stock and procurement', modules: ['inventory', 'suppliers', 'farm-purchase-requests', 'purchases', 'farm-supplier-bills'] },
  { label: 'Finance', modules: ['expenses', 'farm-expenses', 'farm-receivables', 'farm-payables', 'farm-cashbook', 'reports'] },
  { label: 'People and administration', modules: ['farm-workers', 'staff', 'settings'] },
]
