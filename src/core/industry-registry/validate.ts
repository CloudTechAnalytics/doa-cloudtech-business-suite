import { CORE_MODULES } from '@/core/module-registry/core-modules'
import { isSharedPermission } from '@/core/permissions/codes'
import { SHARED_MODULE_CODES } from '@/shared/types/domain'
import type { ModuleCode } from '@/shared/types/domain'
import { IndustryDefinitionError } from './types'
import type { IndustryDefinition, SetupAnswerValue } from './types'

const KEBAB = /^[a-z]+(-[a-z]+)*$/
const PERMISSION = /^[a-z]+(\.[a-z]+)+$/
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i)
const core = CORE_MODULES as string[]

/** Returns every problem found; an empty list means the definition is valid. */
export function findIndustryProblems(d: IndustryDefinition): string[] {
  const p: string[] = []
  const shared = SHARED_MODULE_CODES as readonly string[]
  const owned = d.modules.map((m) => m.code as string)
  const ownedSet = new Set<string>(owned)
  const known = new Set<string>([...shared, ...owned])
  const allowedForNav = new Set<string>([...core, ...d.defaultModules, ...d.optionalModules])
  const declared = new Set(d.permissions.map((x) => x.code))

  if (!KEBAB.test(d.id)) p.push('id must be lowercase kebab-case')
  if (!d.name.trim()) p.push('name is required')
  if (!d.category.trim()) p.push('category is required')
  if (!Number.isInteger(d.version) || d.version < 1) p.push('version must be a positive integer')

  for (const m of d.modules) {
    if (!KEBAB.test(m.code) || !m.code.startsWith(`${d.id}-`)) p.push(`module "${m.code}" must be kebab-case and start with "${d.id}-"`)
    if (m.owner !== d.id) p.push(`module "${m.code}" must declare owner "${d.id}"`)
    if (!m.path.startsWith(`${d.id}/`)) p.push(`module "${m.code}" path must start with "${d.id}/"`)
    if (!declared.has(m.permission) && !isSharedPermission(m.permission)) {
      p.push(`module "${m.code}" requires permission "${m.permission}" which is neither shared nor declared by the industry`)
    }
  }
  for (const c of dupes(owned)) p.push(`duplicate module code "${c}"`)
  for (const c of dupes(d.modules.map((m) => m.path))) p.push(`duplicate module path "${c}"`)

  for (const x of d.permissions) {
    if (!PERMISSION.test(x.code)) p.push(`permission "${x.code}" has an invalid format`)
    else if (!x.code.startsWith(`${d.id}.`)) p.push(`industry permission "${x.code}" must start with "${d.id}."`)
    if (!x.description.trim()) p.push(`permission "${x.code}" needs a description`)
  }
  for (const c of dupes(d.permissions.map((x) => x.code))) p.push(`duplicate permission "${c}"`)

  const mentioned = [...d.requiredSharedModules, ...d.optionalSharedModules, ...d.defaultModules, ...d.optionalModules, ...d.requiredModules]
  for (const c of mentioned) if (!known.has(c)) p.push(`unknown module "${c}"`)
  for (const c of d.requiredSharedModules) if (!shared.includes(c)) p.push(`requiredSharedModules lists non-shared module "${c}"`)
  for (const c of d.optionalSharedModules) if (!shared.includes(c)) p.push(`optionalSharedModules lists non-shared module "${c}"`)
  for (const c of d.requiredSharedModules) if (!d.defaultModules.includes(c) && !core.includes(c)) p.push(`required shared module "${c}" must be a default module`)
  for (const c of d.requiredModules) if (!d.defaultModules.includes(c)) p.push(`required module "${c}" must also be a default module`)
  for (const c of d.optionalModules) if (d.defaultModules.includes(c)) p.push(`module "${c}" cannot be both default and optional`)
  for (const c of dupes(d.defaultModules)) p.push(`duplicate default module "${c}"`)
  for (const c of [...d.defaultModules, ...d.optionalModules]) if (core.includes(c)) p.push(`core module "${c}" is always on and must not be listed`)
  for (const c of owned) if (!d.defaultModules.includes(c) && !d.optionalModules.includes(c)) p.push(`owned module "${c}" is neither default nor optional, so it can never be enabled`)

  for (const r of d.routes) if (!ownedSet.has(r.module)) p.push(`route for "${r.module}" does not match a module owned by this industry`)
  for (const c of owned) if (!d.routes.some((r) => r.module === c)) p.push(`owned module "${c}" has no route, so its page would be unreachable`)
  for (const c of dupes(d.routes.map((r) => r.module as string))) p.push(`duplicate route for "${c}"`)
  for (const s of d.navigation) for (const c of s.modules) if (!allowedForNav.has(c)) p.push(`navigation section "${s.label}" lists "${c}", which this industry does not enable`)
  for (const w of d.workflows) if (!allowedForNav.has(w.module)) p.push(`workflow "${w.id}" targets "${w.module}", which this industry does not enable`)
  for (const c of dupes(d.workflows.map((w) => w.id))) p.push(`duplicate workflow "${c}"`)
  for (const c of dupes(d.dashboardWidgets.map((w) => w.id))) p.push(`duplicate dashboard widget "${c}"`)

  for (const q of d.onboarding.questions) {
    if (!KEBAB.test(q.id.replace(/_/g, '-'))) p.push(`setup question "${q.id}" has an invalid id`)
    if (q.type === 'select' && !q.options?.length) p.push(`setup question "${q.id}" is a select without options`)
    if (q.type !== 'select' && q.options) p.push(`setup question "${q.id}" has options but is not a select`)
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) p.push(`setup question "${q.id}" has min greater than max`)
  }
  for (const c of dupes(d.onboarding.questions.map((q) => q.id))) p.push(`duplicate setup question "${c}"`)

  if (d.status === 'coming_soon' && (d.routes.length || d.defaultModules.length || d.modules.length)) {
    p.push('a coming_soon industry must not define modules, defaults or routes')
  }
  return p
}

/** Throws so an invalid industry fails the build and the tests rather than reaching users. */
export function validateIndustry(d: IndustryDefinition): IndustryDefinition {
  const problems = findIndustryProblems(d)
  if (problems.length) throw new IndustryDefinitionError(d.id, problems)
  return d
}

/** Generic per-question checks, then the industry's own rules. */
export function validateSetupAnswers(d: IndustryDefinition, answers: Record<string, SetupAnswerValue>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const q of d.onboarding.questions) {
    const v = answers[q.id]
    if (v === undefined || v === '') {
      if (q.required) errors[q.id] = 'This is required.'
      continue
    }
    if (q.type === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) errors[q.id] = 'Enter a number.'
      else if (q.min !== undefined && n < q.min) errors[q.id] = `Must be at least ${q.min}.`
      else if (q.max !== undefined && n > q.max) errors[q.id] = `Must be at most ${q.max}.`
    }
    if (q.type === 'select' && !q.options?.some((o) => o.value === v)) errors[q.id] = 'Choose one of the options.'
  }
  return { ...errors, ...(d.onboarding.validate?.(answers) ?? {}) }
}

export const ownedModuleCodes = (d: IndustryDefinition): ModuleCode[] => d.modules.map((m) => m.code)
