import { ALL_MODULES } from '@/core/module-registry/registry'
import type { RoleName } from '@/shared/types/domain'

// Module read permissions plus action permissions that are not tied to a module's visibility.
const ACTION_PERMS = [
  'inventory.adjust', 'sales.create', 'sales.discount', 'sales.refund', 'sales.void', 'customers.manage', 'customers.credit',
  'suppliers.manage', 'purchases.manage', 'purchases.receive', 'purchases.pay', 'audit.read', 'farm.manage',
  'expenses.record', 'procurement.request', 'procurement.approve', 'reports.read', 'bakery.manage',
]
const ALL_PERMS = [...new Set([...ALL_MODULES.map((m) => m.permission), ...ACTION_PERMS])]

/** The permissions demo roles model; the SQL role seed is compared against exactly this set. */
export const ROLE_MODELLED_PERMISSIONS: readonly string[] = ALL_PERMS

/** Demo-mode role permissions (mirrors the role_permissions seed for module-related permissions). */
export function rolePermissions(role: RoleName): Set<string> {
  const read = (p: string) => p.endsWith('.read')
  const sets: Record<RoleName, string[]> = {
    owner: ALL_PERMS,
    business_admin: ALL_PERMS,
    manager: ALL_PERMS.filter((p) => !['staff.manage', 'settings.manage', 'audit.read'].includes(p)),
    accountant: ['dashboard.read', 'expenses.read', 'reports.read', 'purchases.read', 'suppliers.read', 'sales.read', 'inventory.read', 'purchases.pay', 'customers.credit', 'reports.finance.read', 'expenses.record', 'procurement.approve'],
    cashier: ['dashboard.read', 'sales.read', 'sales.create', 'customers.read', 'customers.manage', 'inventory.read'],
    inventory_officer: ['dashboard.read', 'inventory.read', 'inventory.adjust', 'purchases.read', 'suppliers.read', 'purchases.manage', 'purchases.receive', 'suppliers.manage', 'procurement.request'],
    operations_staff: ['dashboard.read', 'farm.read', 'farm.record', 'bakery.read', 'bakery.record', 'inventory.read', 'procurement.request'],
    viewer: ALL_PERMS.filter((p) => read(p) && !['staff.read', 'settings.read', 'audit.read', 'reports.finance.read'].includes(p)),
  }
  return new Set(sets[role])
}

