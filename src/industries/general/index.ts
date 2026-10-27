import { Boxes } from 'lucide-react'
import { defineIndustry } from '@/core/industry-registry/define'
import { TAX_QUESTION } from '@/core/industry-registry/common'
import type { ModuleCode, SharedModuleCode } from '@/shared/types/domain'

/**
 * "Business apps": a business with no industry. It owns no modules of its own; it is the shared apps (CRM, Sales, Inventory, Purchases,
 * Finance) on their own, for a business that is not a shop, farm, bakery, pharmacy or school.
 */
export const general = defineIndustry({
  id: 'general',
  name: 'Business apps',
  description: 'No industry: pick the apps you need, such as CRM, sales and invoicing, stock, purchasing and finance.',
  appName: 'Business apps',
  category: 'Any business',
  icon: Boxes,
  version: 1,
  status: 'active',
  modules: [],
  requiredSharedModules: [] as SharedModuleCode[],
  optionalSharedModules: [] as SharedModuleCode[],
  defaultModules: ['inventory', 'sales', 'purchases', 'suppliers', 'customers', 'expenses', 'reports'] as ModuleCode[],
  optionalModules: [],
  requiredModules: [],
  permissions: [],
  navigation: [],
  routes: [],
  onboarding: { questions: [TAX_QUESTION] },
  dashboardWidgets: [],
  workflows: [],
})
