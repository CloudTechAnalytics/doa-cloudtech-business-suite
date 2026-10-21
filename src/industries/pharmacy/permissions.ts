import type { PermissionDefinition } from '@/core/industry-registry/types'

export const pharmacyPermissions: PermissionDefinition[] = [
  { code: 'pharmacy.manage', description: 'Define medicines, quarantine and dispose of batches, change pharmacy settings' },
  { code: 'pharmacy.rx', description: 'View and enter prescriptions and patient prescription history' },
  { code: 'pharmacy.dispense', description: 'Review and approve prescriptions and dispense restricted medicines (professional authorisation)' },
]
