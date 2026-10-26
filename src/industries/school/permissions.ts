import type { PermissionDefinition } from '@/core/industry-registry/types'

export const schoolPermissions: PermissionDefinition[] = [
  { code: 'school.read', description: 'View students, classes, attendance and results across the school' },
  { code: 'school.manage', description: 'Set up the academic year, classes, subjects, staff, assignments and announcements' },
  { code: 'school.students', description: 'Register and update students, decide admissions, manage parents and guardians' },
  { code: 'school.teach', description: 'Teacher access to the classes and subjects assigned to them' },
  { code: 'school.attendance', description: 'Take attendance' },
  { code: 'school.results.enter', description: 'Enter and submit examination scores' },
  { code: 'school.results.approve', description: 'Approve, publish and correct published results' },
  { code: 'school.fees.read', description: 'View fee bills, payments and balances' },
  { code: 'school.fees.manage', description: 'Set fees, generate bills, give discounts and reverse payments' },
  { code: 'school.fees.record', description: 'Record fee payments and print receipts' },
  { code: 'school.portal', description: 'Parent portal: see only the children linked to this account' },
  { code: 'school.guardians', description: 'Read the parents and guardians of the students you can see' },
  { code: 'school.delete', description: 'Permanently delete a student or a parent or guardian record' },
]
