import { BookOpen } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { buildApps, buildQuickActions, findCurrentApp, sidebarEntries } from '@/app/navigation/navigation'
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
  it('exposes retail, farm, bakery, pharmacy, school and general (business apps) as available', () => {
    expect(listAvailableIndustries().map((d) => d.id).sort()).toEqual(['bakery', 'farm', 'general', 'pharmacy', 'retail', 'school'])
    expect(getIndustry('pharmacy').status).toBe('active')
    expect(Object.keys(INDUSTRIES).sort()).toEqual(['bakery', 'farm', 'general', 'pharmacy', 'retail', 'school'])
  })

  it('gives every industry its own module set and permissions without duplication', () => {
    expect(findRegistryProblems(INDUSTRIES)).toEqual([])
    const owned = (id: IndustryCode) => INDUSTRIES[id].modules.map((m) => m.code)
    expect(owned('retail').every((c) => c.startsWith('retail-'))).toBe(true)
    expect(owned('farm').every((c) => c.startsWith('farm-'))).toBe(true)
    expect(owned('bakery').every((c) => c.startsWith('bakery-'))).toBe(true)
    expect(new Set(ALL_MODULES.map((m) => m.code)).size).toBe(ALL_MODULES.length)
  })

  it('keeps industry modules out of other industries', () => {
    const farmOnly = compatibleModules('farm').filter((c) => c.startsWith('farm-'))
    expect(compatibleModules('retail').some((c) => farmOnly.includes(c))).toBe(false)
    expect(compatibleModules('bakery').some((c) => farmOnly.includes(c))).toBe(false)
    expect(compatibleModules('pharmacy').some((c) => farmOnly.includes(c))).toBe(false)
    expect(compatibleModules('retail').some((c) => c.startsWith('pharmacy-'))).toBe(false)
    expect(defaultModules('pharmacy')).toContain('pharmacy-batches')
  })

  it('builds routes for shared modules and every industry-owned module, with no duplicates', () => {
    const routes = buildModuleRoutes()
    const paths = routes.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const m of ALL_MODULES) expect(paths, m.code).toContain(m.path)
  })
})

describe('apps, the navbar menu and the Record menu follow the industry and the usable modules', () => {
  const usableFor = (id: IndustryCode) => new Set<ModuleCode>(compatibleModules(id))
  const codes = (id: IndustryCode, usable = usableFor(id)) => buildApps(id, usable).flatMap((a) => a.modules.map((m) => m.code))

  it('shows farm apps only for farms, bakery apps only for bakeries', () => {
    expect(codes('farm')).toContain('farm-batches')
    expect(codes('farm')).not.toContain('bakery-recipes')
    expect(codes('bakery')).toContain('bakery-recipes')
    expect(codes('bakery')).not.toContain('farm-batches')
    expect(codes('retail').some((c) => c.startsWith('farm-') || c.startsWith('bakery-'))).toBe(false)
  })

  it('hides modules that are not usable, and drops apps left with no modules', () => {
    const usable = usableFor('farm'); usable.delete('sales'); usable.delete('farm-batches')
    expect(codes('farm', usable)).not.toContain('sales')
    expect(codes('farm', usable)).not.toContain('farm-batches')
    expect(codes('farm', usable)).toContain('inventory')
    expect(buildApps('farm', usable).map((a) => a.id)).not.toContain('sales')
    expect(buildApps('farm', new Set<ModuleCode>(['dashboard'])).map((a) => a.id)).toEqual(['dashboard'])
  })

  it('orders apps: dashboard first, the industry app next, settings last', () => {
    const apps = buildApps('farm', usableFor('farm'))
    expect(apps[0].id).toBe('dashboard')
    expect(apps[1].label).toBe('Overview')
    expect(apps.map((a) => a.label)).toEqual(['Dashboard', 'Overview', 'Farm operations', 'Production', 'Sales and customers', 'Stock and procurement', 'Finance', 'People and administration', 'Invoices', 'Calendar'])
  })

  it('gives each app a menu of its own modules and finds the open app from the URL', () => {
    const apps = buildApps('farm', usableFor('farm'))
    const stock = apps.find((a) => a.label === 'Stock and procurement')!.modules.map((m) => m.code)
    expect(stock).toEqual(expect.arrayContaining(['inventory', 'suppliers', 'purchases', 'farm-purchase-requests', 'farm-supplier-bills']))
    expect(apps.map((a) => a.id)).not.toContain('purchase') // claimed by the farm's own sections, not repeated
    expect(findCurrentApp(apps, '/app/farm/mortality')?.label).toBe('Production')
    expect(findCurrentApp(apps, '/app/purchases')?.label).toBe('Stock and procurement')
    expect(findCurrentApp(apps, '/app/inventory/anything')?.label).toBe('Stock and procurement')
    expect(findCurrentApp(apps, '/app')).toBeNull()
  })

  it('builds the sidebar: single-module apps are plain links, multi-module apps get a heading', () => {
    const entries = sidebarEntries(buildApps('farm', usableFor('farm')))
    const heading = (label: string) => entries.findIndex((e) => e.kind === 'heading' && e.label === label)
    const link = (code: string) => entries.findIndex((e) => e.kind === 'link' && e.module.code === code)
    expect(entries.some((e) => e.kind === 'heading' && e.label === 'Dashboard')).toBe(false)
    expect(entries[0]).toMatchObject({ kind: 'link', module: { code: 'dashboard' } })
    expect(link('farm-overview')).toBe(-1) // the Dashboard shows the overview
    expect(link('farm-alerts')).toBe(1) // a one-module section is a plain link right after Dashboard
    expect(heading('Farm operations')).toBeLessThan(link('farm-daily'))
    expect(link('farm-daily')).toBeLessThan(link('farm-tasks'))
    expect(heading('Production')).toBeLessThan(link('farm-batches'))
    expect(heading('Stock and procurement')).toBeLessThan(link('inventory'))
    expect(link('inventory')).toBeLessThan(link('suppliers'))
    expect(heading('Sales and customers')).toBeLessThan(link('farm-products'))
    expect(link('customers')).toBeLessThan(link('sales')) // customers and selling come before stock
    expect(link('sales')).toBeLessThan(link('farm-products'))
    expect(heading('Sales and customers')).toBeLessThan(heading('Stock and procurement'))
    expect(heading('Finance')).toBeLessThan(link('farm-cashbook'))
    // workers, staff and settings are in the account menu (top right), not the sidebar
    for (const code of ['farm-workers', 'staff', 'settings']) expect(link(code), code).toBe(-1)
    expect(entries.some((e) => e.kind === 'heading' && e.label === 'People and administration')).toBe(false)
    // an optional shared app sits after the industry's own sections (Invoices lists its own parts: Invoices, Payments, Statements, Ageing; Calendar its views)
    const code = (e: (typeof entries)[number]) => (e.kind === 'heading' ? '' : e.module.code)
    expect(entries.slice(-4).map(code)).toEqual(['calendar', 'calendar', 'calendar', 'calendar']) // the last optional app
    expect(entries.slice(-10, -5).map(code)).toEqual(['', 'invoices', 'invoices', 'invoices', 'invoices']) // Invoices: its heading and its four parts
    expect(entries.at(-11)).toMatchObject({ kind: 'link', module: { code: 'reports' } }) // then its heading
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
    expect(findIndustryProblems(clone(INDUSTRIES.pharmacy, { status: 'coming_soon' })).join()).toMatch(/coming_soon industry must not/)
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
      id: 'salon' as IndustryCode, name: 'Salon', description: 'Test industry', category: 'Services', icon: BookOpen, version: 1, status: 'active',
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
