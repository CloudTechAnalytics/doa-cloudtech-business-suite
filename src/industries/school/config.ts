import { GraduationCap } from 'lucide-react'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

/** The school composes the shared expenses module and adds students, attendance, results, fees and a parent portal. */
export const schoolConfig = {
  id: 'school' as const,
  name: 'School',
  description: 'Nursery, primary and secondary schools: students, attendance, results, fees and parents.',
  appName: 'School',
  category: 'Education',
  icon: GraduationCap,
  version: 1,
  status: 'active' as const,
  requiredSharedModules: [] as SharedModuleCode[],
  optionalSharedModules: ['expenses'] as SharedModuleCode[],
  defaultModules: [
    'school-my-classes', 'school-students', 'school-admissions', 'school-guardians', 'school-classes', 'school-staff', 'school-attendance', 'school-results',
    'school-fees', 'school-payments', 'school-announcements', 'school-reports', 'school-settings', 'school-portal', 'expenses',
  ] as ModuleCode[],
  optionalModules: [] as ModuleCode[],
  requiredModules: ['school-students'] as ModuleCode[],
}
