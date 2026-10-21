import type { PermissionDefinition } from '@/core/industry-registry/types'

export const farmPermissions: PermissionDefinition[] = [
  { code: 'farm.read', description: 'View farm records' },
  { code: 'farm.record', description: 'Record farm activity' },
  { code: 'farm.manage', description: 'Start, close and correct batches; manage production units' },
]
