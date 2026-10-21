import { UserRound } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const staffModule: SharedModule = {
  definition: {
    code: 'staff', name: 'Staff & Roles', description: 'Invitations, roles, permissions and branch access.', path: 'staff',
    permission: 'staff.read', icon: UserRound, navGroup: 'Administration', owner: 'platform',
  },
  page: lazy(() => import('./StaffPage').then((m) => ({ default: m.StaffPage }))),
}
