import type { IndustryRoute } from '@/core/industry-registry/types'
import { SchoolAdmissionsPage, SchoolAnnouncementsPage, SchoolAttendancePage, SchoolClassesPage, SchoolFeesPage, SchoolGuardiansPage, SchoolMyClassesPage, SchoolPaymentsPage, SchoolPortalPage, SchoolReportsPage, SchoolResultsPage, SchoolSettingsPage, SchoolStaffPage, SchoolStudentsPage, SchoolTimetablePage } from './lazyPages'

export const schoolRoutes: IndustryRoute[] = [
  { module: 'school-my-classes', component: SchoolMyClassesPage },
  { module: 'school-students', component: SchoolStudentsPage },
  { module: 'school-admissions', component: SchoolAdmissionsPage },
  { module: 'school-guardians', component: SchoolGuardiansPage },
  { module: 'school-classes', component: SchoolClassesPage },
  { module: 'school-staff', component: SchoolStaffPage },
  { module: 'school-timetable', component: SchoolTimetablePage },
  { module: 'school-attendance', component: SchoolAttendancePage },
  { module: 'school-results', component: SchoolResultsPage },
  { module: 'school-fees', component: SchoolFeesPage },
  { module: 'school-payments', component: SchoolPaymentsPage },
  { module: 'school-announcements', component: SchoolAnnouncementsPage },
  { module: 'school-reports', component: SchoolReportsPage },
  { module: 'school-settings', component: SchoolSettingsPage },
  { module: 'school-portal', component: SchoolPortalPage },
]
