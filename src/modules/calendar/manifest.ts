import { CalendarDays, CalendarRange, LayoutList, Sun } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

/** DOA Calendar: a standalone app for appointments, meetings, deadlines and reminders. CRM follow-ups and invoices due show beside its own events. */
export const calendarModule: SharedModule = {
  definition: {
    code: 'calendar', name: 'Calendar', description: 'Appointments, meetings, deadlines and reminders, on your own or with the team.', path: 'calendar',
    permission: 'calendar.read', icon: CalendarDays, navGroup: 'Sales and customers', owner: 'platform',
    quickAction: { label: 'New event', query: 'new=1' },
    sections: [{ key: 'week', label: 'Week', icon: CalendarRange }, { key: 'month', label: 'Month', icon: CalendarDays }, { key: 'day', label: 'Day', icon: Sun }, { key: 'agenda', label: 'Agenda', icon: LayoutList }],
  },
  page: lazy(() => import('./CalendarPage').then((m) => ({ default: m.CalendarPage }))),
}
