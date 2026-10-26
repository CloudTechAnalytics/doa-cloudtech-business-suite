import type { IndustryCode } from '@/shared/types/domain'

const COMMON = ['business_admin', 'manager']
const BY_INDUSTRY: Record<IndustryCode, string[]> = {
  retail: [...COMMON, 'accountant', 'cashier', 'inventory_officer', 'viewer'],
  bakery: [...COMMON, 'accountant', 'cashier', 'inventory_officer', 'operations_staff', 'viewer'],
  farm: [...COMMON, 'accountant', 'inventory_officer', 'operations_staff', 'viewer'],
  pharmacy: [...COMMON, 'accountant', 'cashier', 'inventory_officer', 'pharmacist', 'pharmacy_technician', 'viewer'],
  school: ['business_admin', 'principal', 'teacher', 'bursar', 'admissions_officer', 'parent', 'viewer'],
}

/** The roles that make sense to hand out in a business of this kind (a school has no pharmacists, a pharmacy has no teachers). */
export const assignableRoles = (industry: IndustryCode | undefined): string[] => BY_INDUSTRY[industry ?? 'retail'] ?? BY_INDUSTRY.retail

/** "inventory_officer" as "Inventory officer". */
export const roleName = (r: string) => { const s = r.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
