import { INDUSTRIES } from '@/core/industry-registry'
import { SHARED_MODULES } from './shared-modules'
import { MODULES } from './registry'
import type { ModuleRouteEntry } from './types'

/** Every page the application can render, from shared modules and industries. Access is still decided per business. */
export function buildModuleRoutes(): ModuleRouteEntry[] {
  const shared = SHARED_MODULES.map((m) => ({ path: m.definition.path, code: m.definition.code, component: m.page }))
  const industry = Object.values(INDUSTRIES).flatMap((i) => i.routes.map((r) => ({ path: MODULES[r.module].path, code: r.module, component: r.component })))
  return [...shared, ...industry]
}
