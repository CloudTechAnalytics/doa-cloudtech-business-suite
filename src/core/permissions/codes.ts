/**
 * Permission codes owned by the platform. Industry-specific codes are declared by each industry
 * (prefixed with the industry id). tests/integration/registry-consistency.test.ts checks this list
 * and the industry declarations against the permissions table seeded by the migrations.
 */
export const SHARED_PERMISSION_CODES = [
  'dashboard.read', 'settings.read', 'settings.manage', 'staff.read', 'staff.manage',
  'inventory.read', 'inventory.adjust',
  'sales.read', 'sales.create', 'sales.refund', 'sales.discount', 'sales.void',
  'purchases.read', 'purchases.manage', 'purchases.receive', 'purchases.pay',
  'suppliers.read', 'suppliers.manage',
  'customers.read', 'customers.manage', 'customers.credit',
  'expenses.read', 'expenses.approve', 'expenses.record', 'procurement.request', 'procurement.approve',
  'reports.read', 'reports.finance.read',
  'audit.read',
] as const

export type SharedPermissionCode = (typeof SHARED_PERMISSION_CODES)[number]
export const isSharedPermission = (code: string): boolean => (SHARED_PERMISSION_CODES as readonly string[]).includes(code)
