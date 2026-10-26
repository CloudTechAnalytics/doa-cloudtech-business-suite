import { Banknote, BarChart3, BookOpen, CalendarCheck, ClipboardList, GraduationCap, HeartHandshake, LayoutList, Megaphone, Receipt, Settings2, UserCog, Users } from 'lucide-react'
import type { ModuleDefinition } from '@/shared/types/domain'

const base = { navGroup: 'School', owner: 'school' as const }

/** Modules the school industry owns. Expenses reuse the shared module. */
export const schoolModules: ModuleDefinition[] = [
  { ...base, code: 'school-my-classes', name: 'My Classes', description: 'The classes and subjects a teacher is responsible for: pupils, attendance and results at a glance.', path: 'school/my-classes', permission: 'school.teach', icon: LayoutList },
  { ...base, code: 'school-students', name: 'Students', description: 'Student records, profiles, promotion, transfers and withdrawals.', path: 'school/students', permission: 'school.read', icon: GraduationCap },
  { ...base, code: 'school-admissions', name: 'Admissions', description: 'Applications, decisions and admission numbers.', path: 'school/admissions', permission: 'school.students', icon: ClipboardList },
  { ...base, code: 'school-guardians', name: 'Parents & Guardians', description: 'Parents and guardians linked to students.', path: 'school/guardians', permission: 'school.read', icon: HeartHandshake },
  { ...base, code: 'school-classes', name: 'Classes & Subjects', description: 'Sessions, terms, classes and subjects.', path: 'school/classes', permission: 'school.read', icon: BookOpen },
  { ...base, code: 'school-staff', name: 'Teachers & Staff', description: 'Staff directory and class and subject assignments.', path: 'school/staff', permission: 'school.manage', icon: UserCog },
  { ...base, code: 'school-attendance', name: 'Attendance', description: 'Daily attendance by class.', path: 'school/attendance', permission: 'school.attendance', icon: CalendarCheck },
  { ...base, code: 'school-results', name: 'Results & Report Cards', description: 'Score entry, approval, publishing and report cards.', path: 'school/results', permission: 'school.results.enter', icon: ClipboardList },
  { ...base, code: 'school-fees', name: 'School Fees', description: 'Fee items and student fee bills.', path: 'school/fees', permission: 'school.fees.read', icon: Banknote },
  { ...base, code: 'school-payments', name: 'Payments & Receipts', description: 'Recording payments and printing receipts.', path: 'school/payments', permission: 'school.fees.read', icon: Receipt },
  { ...base, code: 'school-announcements', name: 'Announcements', description: 'Notices for parents, teachers and classes.', path: 'school/announcements', permission: 'dashboard.read', icon: Megaphone },
  { ...base, code: 'school-reports', name: 'Reports', description: 'Enrolment, attendance, results and fees reports.', path: 'school/reports', permission: 'school.read', icon: BarChart3 },
  { ...base, code: 'school-settings', name: 'School Settings', description: 'Grading, assessment marks and working days.', path: 'school/settings', permission: 'school.manage', icon: Settings2 },
  { ...base, code: 'school-portal', name: 'Parent Portal', description: 'Children, attendance, results, fees and announcements for parents.', path: 'school/portal', permission: 'school.portal', icon: Users },
]
