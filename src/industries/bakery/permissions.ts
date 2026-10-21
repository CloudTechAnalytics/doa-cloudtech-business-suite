import type { PermissionDefinition } from '@/core/industry-registry/types'

export const bakeryPermissions: PermissionDefinition[] = [
  { code: 'bakery.read', description: 'View bakery records' },
  { code: 'bakery.record', description: 'Record bakery production' },
]
