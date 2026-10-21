import { Pill } from 'lucide-react'
import { defineIndustry } from '@/core/industry-registry/define'

/**
 * Scaffold only. Pharmacy stays "coming soon" until its workflows (batch and expiry tracking, dispensing,
 * restricted permissions, prescription handling) are designed and the applicable Nigerian regulatory,
 * privacy and recordkeeping requirements are confirmed. The validator forbids a coming_soon industry from
 * defining modules or routes, so nothing here can reach users by accident.
 */
export const pharmacy = defineIndustry({
  id: 'pharmacy',
  name: 'Pharmacy',
  description: 'Planned for a later release after workflow and compliance review.',
  category: 'Shops & trade',
  icon: Pill,
  version: 1,
  status: 'coming_soon',
  modules: [],
  requiredSharedModules: [],
  optionalSharedModules: [],
  defaultModules: [],
  optionalModules: [],
  requiredModules: [],
  permissions: [],
  navigation: [],
  routes: [],
  onboarding: { questions: [] },
  dashboardWidgets: [],
  workflows: [],
})
