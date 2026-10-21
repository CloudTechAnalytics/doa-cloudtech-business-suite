import { Settings } from 'lucide-react'
import { lazy } from 'react'
import type { SharedModule } from '@/core/module-registry/types'

export const settingsModule: SharedModule = {
  definition: {
    code: 'settings', name: 'Settings', description: 'Business profile, branches, modules, subscription and audit history.', path: 'settings',
    permission: 'settings.read', icon: Settings, navGroup: 'Administration', owner: 'platform',
  },
  page: lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage }))),
}
