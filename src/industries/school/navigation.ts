import type { NavSection } from '@/core/industry-registry/types'

/** The school's sidebar: the children first, then the daily work, the money, and the people. Shared modules named here are not repeated under the generic apps. */
export const schoolNavigation: NavSection[] = [
  { label: 'Parent portal', modules: ['school-portal'] },
  { label: 'Students', modules: ['school-students', 'school-guardians'] },
  { label: 'Classroom', modules: ['school-attendance', 'school-results', 'school-classes'] },
  { label: 'Fees', modules: ['school-fees', 'school-payments', 'expenses'] },
  { label: 'Staff', modules: ['school-staff'] },
  { label: 'Announcements', modules: ['school-announcements'] },
  { label: 'Reports', modules: ['school-reports'] },
  { label: 'Settings', modules: ['school-settings'] },
]
