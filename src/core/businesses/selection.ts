import type { IndustryDefinition } from '@/core/industry-registry/types'
import { CORE_MODULES } from '@/core/module-registry/core-modules'
import { MODULES } from '@/core/module-registry/registry'
import type { IndustryCode } from '@/shared/types/domain'

/** Groups industries under their category heading, in registry order. */
export function groupByCategory(industries: IndustryDefinition[]): { category: string; items: IndustryDefinition[] }[] {
  const groups: { category: string; items: IndustryDefinition[] }[] = []
  for (const d of industries) {
    const g = groups.find((x) => x.category === d.category)
    if (g) g.items.push(d)
    else groups.push({ category: d.category, items: [d] })
  }
  return groups
}

/** Adds or removes an id, keeping the selection free of duplicates. */
export function toggleSelection(selected: readonly IndustryCode[], id: IndustryCode): IndustryCode[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}

/** Names of everything a business of this type starts with (core modules plus the industry's defaults). */
export const includedModuleNames = (d: IndustryDefinition): string[] =>
  d.status !== 'active' ? [] : [...new Set([...CORE_MODULES, ...d.defaultModules].map((c) => MODULES[c]?.name).filter((n): n is string => !!n))]

