import { getIndustry } from '@/core/industry-registry'
import { ALL_MODULES, MODULES } from '@/core/module-registry/registry'
import type { IndustryCode, ModuleCode, ModuleDefinition } from '@/shared/types/domain'

export interface NavGroup { label: string; items: ModuleDefinition[] }
export interface QuickAction { label: string; to: string; module: ModuleCode }

/** Shared sections after the industry's own, in this order. "Overview" always comes first. */
const SHARED_GROUP_ORDER = ['Stock and purchasing', 'Sales and customers', 'Finance', 'Administration']

/**
 * Sidebar sections for a business: Overview, the industry's sections, then shared sections.
 * Only modules that are usable (enabled, entitled, permitted) appear; this is presentation only.
 */
export function buildNavigation(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): NavGroup[] {
  const pick = (codes: ModuleCode[]) => codes.filter((c) => usable.has(c)).map((c) => MODULES[c])
  const platform = ALL_MODULES.filter((m) => m.owner === 'platform')
  const groups: NavGroup[] = [{ label: 'Overview', items: pick(['dashboard']) }]
  for (const s of getIndustry(industry).navigation) groups.push({ label: s.label, items: pick(s.modules) })
  for (const label of SHARED_GROUP_ORDER) {
    groups.push({ label, items: pick(platform.filter((m) => m.navGroup === label).map((m) => m.code)) })
  }
  return groups.filter((g) => g.items.length)
}

/** Record-menu entries: shared module quick actions plus the industry's workflows. */
export function buildQuickActions(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): QuickAction[] {
  const shared = ALL_MODULES.filter((m) => m.owner === 'platform' && m.quickAction && usable.has(m.code)).map((m) => ({
    label: m.quickAction!.label, module: m.code, to: `/app/${m.path}${m.quickAction!.query ? `?${m.quickAction!.query}` : ''}`,
  }))
  const own = getIndustry(industry).workflows.filter((w) => usable.has(w.module)).map((w) => ({ label: w.label, module: w.module, to: `/app/${MODULES[w.module].path}` }))
  return [...own, ...shared]
}
