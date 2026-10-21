import type { NavSection } from '@/core/industry-registry/types'

/** The pharmacy's sidebar in the order a pharmacy works. Shared modules named here are not repeated under the generic apps. */
export const pharmacyNavigation: NavSection[] = [
  { label: 'Sales', modules: ['sales', 'pharmacy-shifts'] },
  { label: 'Dispensing', modules: ['pharmacy-prescriptions'] },
  { label: 'Medicines', modules: ['pharmacy-products', 'pharmacy-categories'] },
  { label: 'Stock', modules: ['inventory', 'pharmacy-batches', 'pharmacy-counts', 'pharmacy-losses'] },
  { label: 'Purchases', modules: ['purchases', 'pharmacy-returns'] },
  { label: 'Suppliers', modules: ['suppliers'] },
  { label: 'Customers', modules: ['customers'] },
  { label: 'Expenses', modules: ['expenses'] },
  { label: 'Staff', modules: ['staff'] },
  { label: 'Reports', modules: ['pharmacy-reports', 'reports'] },
  { label: 'Settings', modules: ['settings'] },
]
