import { BookOpen } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { buildNavigation, buildQuickActions } from '@/app/navigation/navigation'
import { INDUSTRIES, findRegistryProblems, getIndustry, listAvailableIndustries } from '@/core/industry-registry'
import { defineIndustry } from '@/core/industry-registry/define'
import { answersToSettings } from '@/core/industry-registry/settings'
import { IndustryDefinitionError } from '@/core/industry-registry/types'
import type { IndustryDefinition } from '@/core/industry-registry/types'
import { findIndustryProblems, validateSetupAnswers } from '@/core/industry-registry/validate'
import { ALL_MODULES, MODULES, compatibleModules, defaultModules } from '@/core/module-registry/registry'
import { buildModuleRoutes } from '@/core/module-registry/routes'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'

const clone = (d: IndustryDefinition, patch: Partial<IndustryDefinition>): IndustryDefinition => ({ ...d, ...patch })

describe('the industry registry', () => {
  it('exposes retail, farm and bakery as available and pharmacy as coming soon', () => {
    expect(listAvailableIndustries().map((d) => d.id).sort()).toEqual(['bakery', 'farm', 'retail'])
    expect(getIndustry('pharmacy').status).toBe('coming_soon')
    expect(Object.keys(INDUSTRIES).sort()).toEqual(['bakery', 'farm', 'pharmacy', 'retail'])
  })

  it('gives every industry its own module set and permissions without duplication', () => {
    expect(findRegistryProblems(INDUSTRIES)).toEqual([])
    const owned = (id: IndustryCode) => INDUSTRIES[id].modules.map((m) => m.code)
    expect(owned('retail')).toEqual([])
    expect(owned('farm').every((c) => c.startsWith('farm-'))).toBe(true)
    expect(owned('bakery').every((c) => c.startsWith('bakery-'))).toBe(true)
    expect(new Set(ALL_MODULES.map((m) => m.code)).size).toBe(ALL_MODULES.length)
  })

  it('keeps industry modules out of other industries', () => {
    const farmOnly = compatibleModules('farm').filter((c) => c.startsWith('farm-'))
    expect(compatibleModules('retail').some((c) => farmOnly.includes(c))).toBe(false)
    expect(compatibleModules('bakery').some((c) => farmOnly.includes(c))).toBe(false)
    expect(compatibleModules('pharmacy')).toEqual([])
    expect(defaultModules('pharmacy')).toEqual([])
  })

  it('builds routes for shared modules and every industry-owned module, with no duplicates', () => {
    const routes = buildModuleRoutes()
    const paths = routes.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const m of ALL_MODULES) expect(paths, m.code).toContain(m.path)
  })
})

describe('navigation and the Record menu follow the industry and the usable modules', () => {
  const usableFor = (id: IndustryCode) => new Set<ModuleCode>(compatibleModules(id))
  const labels = (id: IndustryCode, usable = usableFor(id)) => buildNavigation(id, usable).flatMap((g) => g.items.map((m) => m.code))

  it('shows farm sections only for farms, bakery sections only for bakeries', () => {
    expect(labels('farm')).toContain('farm-batches')
    expect(labels('farm')).not.toContain('bakery-recipes')
    expect(labels('bakery')).toContain('bakery-recipes')
    expect(labels('bakery')).not.toContain('farm-batches')
    expect(labels('retail').some((c) => c.startsWith('farm-') || c.startsWith('bakery-'))).toBe(false)
  })

  it('hides modules that are not usable', () => {
    const usable = usableFor('farm'); usable.delete('sales'); usable.delete('farm-batches')
    const codes = labels('farm', usable)
    expect(codes).not.toContain('sales')
    expect(codes).not.toContain('farm-batches')
    expect(codes).toContain('inventory')
  })

  it('orders sections: overview, industry, then shared', () => {
    const groups = buildNavigation('farm', usableFor('farm')).map((g) => g.label)
    expect(groups[0]).toBe('Overview')
    expect(groups[1]).toBe('Farm operations')
    expect(groups.at(-1)).toBe('Administration')
  })

  it('offers industry workflows in the Record menu only when their module is usable', () => {
    const all = buildQuickActions('farm', usableFor('farm')).map((a) => a.label)
    expect(all).toContain('Record mortality')
    expect(all).toContain('New sale')
    const usable = usableFor('farm'); usable.delete('farm-mortality')
    expect(buildQuickActions('farm', usable).map((a) => a.label)).not.toContain('Record mortality')
  })
})

describe('the contract rejects invalid industry definitions', () => {
  const farm = INDUSTRIES.farm
  const problems = (patch: Partial<IndustryDefinition>) => findIndustryProblems(clone(farm, patch)).join(' | ')

  it('accepts every shipped definition', () => {
    for (const d of Object.values(INDUSTRIES)) expect(findIndustryProblems(d), d.id).toEqual([])
  })

  it('rejects modules that are not prefixed with the industry id or have the wrong owner or path', () => {
    const bad = { ...farm.modules[0], code: 'overview', owner: 'bakery' as const, path: 'x/overview' }
    const p = problems({ modules: [bad, ...farm.modules.slice(1)] })
    expect(p).toMatch(/must be kebab-case and start with "farm-"/)
    expect(p).toMatch(/must declare owner "farm"/)
    expect(p).toMatch(/path must start with "farm\/"/)
  })

  it('rejects unknown, duplicate and contradictory module references', () => {
    expect(problems({ defaultModules: [...farm.defaultModules, 'ghost-module'] })).toMatch(/unknown module "ghost-module"/)
    expect(problems({ requiredModules: ['inventory-x'] })).toMatch(/unknown module/)
    expect(problems({ optionalModules: [...farm.optionalModules, 'inventory'] })).toMatch(/cannot be both default and optional/)
    expect(problems({ defaultModules: [...farm.defaultModules, 'dashboard'] })).toMatch(/core module "dashboard" is always on/)
    expect(problems({ requiredModules: ['purchases'] })).toMatch(/must also be a default module/)
  })

  it('rejects routes and navigation that point at modules the industry does not own or enable', () => {
    expect(problems({ routes: [...farm.routes, { module: 'bakery-recipes', component: farm.routes[0].component }] })).toMatch(/does not match a module owned/)
    expect(problems({ routes: farm.routes.slice(1) })).toMatch(/has no route/)
    expect(problems({ navigation: [{ label: 'X', modules: ['bakery-recipes'] }] })).toMatch(/does not enable/)
  })

  it('rejects industry permissions that are not namespaced, and modules needing undeclared permissions', () => {
    expect(problems({ permissions: [{ code: 'bakery.read', description: 'x' }] })).toMatch(/must start with "farm\."/)
    expect(problems({ permissions: [] })).toMatch(/neither shared nor declared/)
  })

  it('rejects an owned module that could never be enabled', () => {
    expect(problems({ defaultModules: farm.defaultModules.filter((c) => c !== 'farm-units') })).toMatch(/neither default nor optional/)
  })

  it('rejects invalid setup questions', () => {
    expect(problems({ onboarding: { questions: [{ id: 'pick', label: 'Pick', type: 'select' }] } })).toMatch(/select without options/)
    expect(problems({ onboarding: { questions: [{ id: 'n', label: 'N', type: 'number', min: 5, max: 1 }] } })).toMatch(/min greater than max/)
  })

  it('does not let a coming-soon industry expose anything', () => {
    const pharmacy = INDUSTRIES.pharmacy
    expect(findIndustryProblems(clone(pharmacy, { defaultModules: ['inventory'] })).join()).toMatch(/coming_soon industry must not/)
  })

  it('throws a descriptive error from defineIndustry', () => {
    expect(() => defineIndustry(clone(farm, { version: 0 }))).toThrow(IndustryDefinitionError)
  })

  it('detects collisions between industries', () => {
    const clash = clone(INDUSTRIES.bakery, { modules: [{ ...INDUSTRIES.farm.modules[0], code: INDUSTRIES.farm.modules[0].code }] })
    expect(findRegistryProblems({ ...INDUSTRIES, bakery: clash }).join()).toMatch(/already owned by farm|collides/)
  })
})

describe('adding an industry needs no change to core code', () => {
  it('a new industry defined in one folder validates, registers and produces routes and navigation', () => {
    const salon = defineIndustry({
      id: 'salon' as IndustryCode, name: 'Salon', description: 'Test industry', version: 1, status: 'active',
      modules: [{ code: 'salon-appointments', name: 'Appointments', description: 'Bookings', path: 'salon/appointments', permission: 'salon.read', icon: BookOpen, navGroup: 'Salon', owner: 'salon' as IndustryCode }],
      requiredSharedModules: ['sales'], optionalSharedModules: ['customers'],
      defaultModules: ['salon-appointments', 'sales'], optionalModules: ['customers'], requiredModules: ['salon-appointments'],
      permissions: [{ code: 'salon.read', description: 'View salon records' }],
      navigation: [{ label: 'Salon', modules: ['salon-appointments'] }],
      routes: [{ module: 'salon-appointments', component: () => null }],
      onboarding: { questions: [] }, dashboardWidgets: [], workflows: [],
    })
    expect(findRegistryProblems({ ...INDUSTRIES, salon })).toEqual([])
    expect(salon.routes.map((r) => r.module)).toEqual(['salon-appointments'])
    // Nothing in the shipped modules changed:
    expect(MODULES['salon-appointments']).toBeUndefined()
  })
})

describe('industry setup', () => {
  const farm = INDUSTRIES.farm
  it('validates answers generically and with industry rules', () => {
    expect(validateSetupAnswers(farm, {}).has_poultry).toMatch(/at least one/)
    expect(validateSetupAnswers(farm, { has_fish: true })).toEqual({})
    expect(validateSetupAnswers(farm, { has_fish: true, tax_rate_percent: 150 }).tax_rate_percent).toMatch(/at most 100/)
    expect(validateSetupAnswers(farm, { has_fish: true, tax_rate_percent: 'abc' }).tax_rate_percent).toMatch(/number/)
  })

  it('maps answers to the settings the database accepts', () => {
    expect(answersToSettings(farm, { has_poultry: true, has_crops: false, tax_rate_percent: '7.5' })).toEqual({
      tax_rate_percent: 7.5, setup: { has_poultry: true, has_crops: false },
    })
    expect(answersToSettings(INDUSTRIES.retail, {})).toEqual({})
  })
})
