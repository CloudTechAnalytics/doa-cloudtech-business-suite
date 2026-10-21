import type { PermissionDefinition } from '@/core/industry-registry/types'

export const bakeryPermissions: PermissionDefinition[] = [
  { code: 'bakery.read', description: 'View bakery records' },
  { code: 'bakery.record', description: 'Record bakery production' },
  { code: 'bakery.manage', description: 'Define products, recipes and ingredients; reverse production and waste' },
]
