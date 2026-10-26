import { ALL_MODULES } from '@/core/module-registry/registry'
import type { RoleName } from '@/shared/types/domain'

// Module read permissions plus action permissions that are not tied to a module's visibility.
const ACTION_PERMS = [
  'inventory.adjust', 'sales.create', 'sales.discount', 'sales.refund', 'sales.void', 'customers.manage', 'customers.credit',
  'suppliers.manage', 'purchases.manage', 'purchases.receive', 'purchases.pay', 'audit.read', 'farm.manage',
  'expenses.record', 'procurement.request', 'procurement.approve', 'reports.read', 'bakery.manage', 'retail.manage',
  'pharmacy.manage', 'pharmacy.rx', 'pharmacy.dispense',
  'school.read', 'school.manage', 'school.students', 'school.teach', 'school.attendance', 'school.results.enter', 'school.results.approve', 'school.fees.read', 'school.fees.manage', 'school.fees.record', 'school.portal', 'school.guardians', 'school.delete',
]
const ALL_PERMS = [...new Set([...ALL_MODULES.map((m) => m.permission), ...ACTION_PERMS])]

/** The permissions demo roles model; the SQL role seed is compared against exactly this set. */
export const ROLE_MODELLED_PERMISSIONS: readonly string[] = ALL_PERMS

/** Demo-mode role permissions (mirrors the role_permissions seed for module-related permissions). */
export function rolePermissions(role: RoleName): Set<string> {
  const read = (p: string) => p.endsWith('.read')
  const sets: Record<RoleName, string[]> = {
    // the parent portal is for parents: the school's own staff see everything else
    owner: ALL_PERMS.filter((p) => p !== 'school.portal' && p !== 'school.teach'),
    business_admin: ALL_PERMS.filter((p) => p !== 'school.portal' && p !== 'school.teach'),
    manager: ALL_PERMS.filter((p) => !['staff.manage', 'settings.manage', 'audit.read', 'pharmacy.dispense', 'school.portal', 'school.delete', 'school.teach'].includes(p)),
    accountant: ['dashboard.read', 'expenses.read', 'reports.read', 'purchases.read', 'suppliers.read', 'sales.read', 'inventory.read', 'purchases.pay', 'customers.credit', 'reports.finance.read', 'expenses.record', 'procurement.approve'],
    cashier: ['dashboard.read', 'sales.read', 'sales.create', 'customers.read', 'customers.manage', 'inventory.read'],
    inventory_officer: ['dashboard.read', 'inventory.read', 'inventory.adjust', 'purchases.read', 'suppliers.read', 'purchases.manage', 'purchases.receive', 'suppliers.manage', 'procurement.request'],
    pharmacist: ['dashboard.read', 'inventory.read', 'inventory.adjust', 'sales.read', 'sales.create', 'customers.read', 'customers.manage', 'purchases.read', 'suppliers.read', 'pharmacy.rx', 'pharmacy.dispense'],
    pharmacy_technician: ['dashboard.read', 'inventory.read', 'sales.read', 'sales.create', 'customers.read', 'customers.manage', 'pharmacy.rx'],
    principal: ['dashboard.read', 'expenses.read', 'school.read', 'school.manage', 'school.students', 'school.attendance', 'school.results.enter', 'school.results.approve', 'school.fees.read', 'school.guardians'],
    teacher: ['dashboard.read', 'school.teach', 'school.attendance', 'school.results.enter', 'school.guardians'],
    bursar: ['dashboard.read', 'expenses.read', 'expenses.record', 'school.read', 'school.fees.read', 'school.fees.manage', 'school.fees.record', 'school.guardians'],
    admissions_officer: ['dashboard.read', 'school.read', 'school.students', 'school.fees.record', 'school.guardians'],
    parent: ['school.portal'],
    operations_staff: ['dashboard.read', 'farm.read', 'farm.record', 'bakery.read', 'bakery.record', 'inventory.read', 'procurement.request'],
    viewer: ALL_PERMS.filter((p) => read(p) && !['staff.read', 'settings.read', 'audit.read', 'reports.finance.read', 'school.read', 'school.fees.read'].includes(p)),
  }
  return new Set(sets[role])
}

