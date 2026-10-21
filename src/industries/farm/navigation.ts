import type { NavSection } from '@/core/industry-registry/types'

export const farmNavigation: NavSection[] = [
  {
    label: 'Farm operations',
    modules: ['farm-overview', 'farm-units', 'farm-batches', 'farm-daily', 'farm-feeding', 'farm-mortality', 'farm-harvests', 'farm-expenses'],
  },
]
