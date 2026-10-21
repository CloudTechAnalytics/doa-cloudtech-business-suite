import { planIncludes } from '@/core/subscriptions/plans'
import { INDUSTRY_TEMPLATES, MODULES, compatibleModules } from '@/core/module-registry/registry'
import { CORE_MODULES } from '@/core/module-registry/core-modules'
import type { IndustryCode, ModuleCode, PlanCode } from '@/shared/types/domain'

export type ModuleAvailability = 'available' | 'disabled' | 'needs_plan' | 'no_permission' | 'not_compatible'

export interface ModuleStatus {
  code: ModuleCode
  isCore: boolean
  isRequired: boolean
  enabled: boolean
  entitled: boolean
  permitted: boolean
  usable: boolean
  availability: ModuleAvailability
}

export function availabilityOf(s: Pick<ModuleStatus, 'enabled' | 'entitled' | 'permitted'>): ModuleAvailability {
  if (!s.enabled) return 'disabled'
  if (!s.entitled) return 'needs_plan'
  if (!s.permitted) return 'no_permission'
  return 'available'
}

/** Pure computation of module state; same rules as my_modules() in SQL. */
export function computeModuleStatuses(input: {
  industry: IndustryCode
  enabled: ModuleCode[]
  plan: PlanCode | null // null = no valid subscription
  permissions: Set<string>
}): ModuleStatus[] {
  const required = INDUSTRY_TEMPLATES[input.industry].requiredModules
  return compatibleModules(input.industry).map((code) => {
    const isCore = CORE_MODULES.includes(code)
    const enabled = isCore || input.enabled.includes(code)
    const entitled = isCore || (input.plan !== null && planIncludes(input.plan, code))
    const permitted = input.permissions.has(MODULES[code].permission)
    const base = { enabled, entitled, permitted }
    return {
      code,
      isCore,
      isRequired: isCore || required.includes(code),
      ...base,
      usable: enabled && entitled && permitted,
      availability: availabilityOf(base),
    }
  })
}

