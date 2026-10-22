import { bakery } from '@/industries/bakery'
import { farm } from '@/industries/farm'
import { pharmacy } from '@/industries/pharmacy'
import { retail } from '@/industries/retail'
import { school } from '@/industries/school'
import { SHARED_MODULE_CODES } from '@/shared/types/domain'
import type { IndustryCode } from '@/shared/types/domain'
import { IndustryDefinitionError } from './types'
import type { IndustryDefinition } from './types'

/**
 * The central industry registry: trusted, build-time definitions only. Registering an industry means
 * adding it here (and to the IndustryCode union); see docs/adding-an-industry.md.
 */
export const INDUSTRIES: Record<IndustryCode, IndustryDefinition> = { retail, farm, bakery, pharmacy, school }

/** Cross-industry rules that a single definition cannot check on its own. */
export function findRegistryProblems(registry: Record<string, IndustryDefinition>): string[] {
  const problems: string[] = []
  const shared = new Set<string>(SHARED_MODULE_CODES)
  const codes = new Map<string, string>()
  const paths = new Map<string, string>()
  const perms = new Map<string, string>()
  for (const [key, d] of Object.entries(registry)) {
    if (key !== d.id) problems.push(`registry key "${key}" does not match industry id "${d.id}"`)
    for (const m of d.modules) {
      if (shared.has(m.code)) problems.push(`${d.id}: module "${m.code}" collides with a shared module`)
      if (codes.has(m.code)) problems.push(`${d.id}: module "${m.code}" is already owned by ${codes.get(m.code)}`)
      if (paths.has(m.path)) problems.push(`${d.id}: path "${m.path}" is already used by ${paths.get(m.path)}`)
      codes.set(m.code, d.id)
      paths.set(m.path, d.id)
    }
    for (const x of d.permissions) {
      if (perms.has(x.code)) problems.push(`${d.id}: permission "${x.code}" is already declared by ${perms.get(x.code)}`)
      perms.set(x.code, d.id)
    }
  }
  return problems
}

const registryProblems = findRegistryProblems(INDUSTRIES)
if (registryProblems.length) throw new IndustryDefinitionError('registry', registryProblems)

export const getIndustry = (code: IndustryCode): IndustryDefinition => INDUSTRIES[code]
export const listIndustries = (): IndustryDefinition[] => Object.values(INDUSTRIES)
export const listAvailableIndustries = (): IndustryDefinition[] => listIndustries().filter((d) => d.status === 'active')
