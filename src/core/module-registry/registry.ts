import { INDUSTRIES } from '@/core/industry-registry'
import type { IndustryCode, IndustryTemplate, ModuleCode, ModuleDefinition } from '@/shared/types/domain'
import { CORE_MODULES } from './core-modules'
import { SHARED_MODULES } from './shared-modules'

/**
 * The module registry is assembled, not hand-maintained: shared modules come from their manifests and
 * industry-owned modules from the industry registry. Navigation, routes and availability read from here.
 */
export { CORE_MODULES }

export const ALL_MODULES: ModuleDefinition[] = [
  ...SHARED_MODULES.map((m) => m.definition),
  ...Object.values(INDUSTRIES).flatMap((i) => i.modules),
]

export const MODULES = Object.fromEntries(ALL_MODULES.map((m) => [m.code, m])) as Record<ModuleCode, ModuleDefinition>

/** Industry templates in the shape the database mirrors (defaults exclude core modules). */
export const INDUSTRY_TEMPLATES: Record<IndustryCode, IndustryTemplate> = Object.fromEntries(
  Object.values(INDUSTRIES).map((i) => [
    i.id,
    {
      code: i.id, name: i.name, description: i.description, available: i.status === 'active',
      modules: i.defaultModules, optionalModules: i.optionalModules, requiredModules: i.requiredModules,
    } satisfies IndustryTemplate,
  ]),
) as Record<IndustryCode, IndustryTemplate>

/** Modules a business of this industry may use (core + defaults + optional). */
export function compatibleModules(code: IndustryCode): ModuleCode[] {
  const t = INDUSTRY_TEMPLATES[code]
  return t.available ? [...CORE_MODULES, ...t.modules, ...t.optionalModules] : []
}

/** Modules enabled when a business of this industry is created. */
export function defaultModules(code: IndustryCode): ModuleCode[] {
  const t = INDUSTRY_TEMPLATES[code]
  return t.available ? [...CORE_MODULES, ...t.modules] : []
}
