import { lazy } from 'react'

// Each screen is loaded on demand, keeping the industry registry light.
export const SchoolStudentsPage = lazy(() => import('./pages/SchoolStudentsPage').then((m) => ({ default: m.SchoolStudentsPage })))
export const SchoolAdmissionsPage = lazy(() => import('./pages/SchoolAdmissionsPage').then((m) => ({ default: m.SchoolAdmissionsPage })))
export const SchoolGuardiansPage = lazy(() => import('./pages/SchoolGuardiansPage').then((m) => ({ default: m.SchoolGuardiansPage })))
export const SchoolClassesPage = lazy(() => import('./pages/SchoolClassesPage').then((m) => ({ default: m.SchoolClassesPage })))
export const SchoolStaffPage = lazy(() => import('./pages/SchoolStaffPage').then((m) => ({ default: m.SchoolStaffPage })))
export const SchoolAttendancePage = lazy(() => import('./pages/SchoolAttendancePage').then((m) => ({ default: m.SchoolAttendancePage })))
export const SchoolResultsPage = lazy(() => import('./pages/SchoolResultsPage').then((m) => ({ default: m.SchoolResultsPage })))
export const SchoolFeesPage = lazy(() => import('./pages/SchoolFeesPage').then((m) => ({ default: m.SchoolFeesPage })))
export const SchoolPaymentsPage = lazy(() => import('./pages/SchoolPaymentsPage').then((m) => ({ default: m.SchoolPaymentsPage })))
export const SchoolAnnouncementsPage = lazy(() => import('./pages/SchoolAnnouncementsPage').then((m) => ({ default: m.SchoolAnnouncementsPage })))
export const SchoolReportsPage = lazy(() => import('./pages/SchoolReportsPage').then((m) => ({ default: m.SchoolReportsPage })))
export const SchoolSettingsPage = lazy(() => import('./pages/SchoolSettingsPage').then((m) => ({ default: m.SchoolSettingsPage })))
export const SchoolPortalPage = lazy(() => import('./pages/SchoolPortalPage').then((m) => ({ default: m.SchoolPortalPage })))
