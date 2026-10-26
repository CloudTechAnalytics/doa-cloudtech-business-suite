import { describe, expect, it } from 'vitest'
import { assignableRoles, roleName } from '@/modules/staff/assignableRoles'

describe('the roles offered when inviting staff', () => {
  it('are the school roles for a school, and nothing from pharmacy or retail', () => {
    const r = assignableRoles('school')
    expect(r).toEqual(expect.arrayContaining(['principal', 'teacher', 'bursar', 'admissions_officer', 'parent']))
    expect(r).not.toEqual(expect.arrayContaining(['pharmacist']))
    for (const x of ['cashier', 'inventory_officer', 'pharmacist', 'pharmacy_technician', 'operations_staff', 'accountant']) expect(r).not.toContain(x)
  })
  it('keep school roles out of every other kind of business, and never offer the owner', () => {
    for (const ind of ['retail', 'bakery', 'farm', 'pharmacy'] as const) {
      const r = assignableRoles(ind)
      for (const x of ['principal', 'teacher', 'bursar', 'admissions_officer', 'parent', 'owner']) expect(r).not.toContain(x)
    }
    expect(assignableRoles('pharmacy')).toEqual(expect.arrayContaining(['pharmacist', 'pharmacy_technician']))
    expect(assignableRoles('retail')).not.toContain('pharmacist')
  })
  it('read as plain words', () => { expect(roleName('inventory_officer')).toBe('Inventory officer'); expect(roleName('admissions_officer')).toBe('Admissions officer') })
})
