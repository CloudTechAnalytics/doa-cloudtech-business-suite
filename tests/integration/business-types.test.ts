import { describe, expect, it } from 'vitest'
import { groupByCategory, includedModuleNames, toggleSelection } from '@/core/businesses/selection'
import { INDUSTRIES, listIndustries } from '@/core/industry-registry'
import { findIndustryProblems } from '@/core/industry-registry/validate'
import { enableModule } from '@/core/module-registry/moduleActions'
import { demoCreateBusiness, demoModuleStatuses, demoSignIn } from '@/demo/demoStore'

describe('the business-type picker is driven by the industry registry', () => {
  it('groups every industry under its category, keeping registry order', () => {
    const groups = groupByCategory(listIndustries())
    expect(groups.map((g) => g.category)).toEqual(['Shops & trade', 'Farming & food', 'Education', 'Any business'])
    expect(groups[0].items.map((d) => d.id)).toEqual(['retail', 'pharmacy'])
    expect(groups[1].items.map((d) => d.id)).toEqual(['farm', 'bakery'])
    expect(groups[2].items.map((d) => d.id)).toEqual(['school'])
    expect(groups[3].items.map((d) => d.id)).toEqual(['general'])
    expect(groups.flatMap((g) => g.items)).toHaveLength(listIndustries().length)
  })

  it('offers every industry as available, pharmacy included', () => {
    expect(INDUSTRIES.pharmacy.status).toBe('active')
    expect(listIndustries().filter((d) => d.status === 'active').map((d) => d.id)).toEqual(['retail', 'farm', 'bakery', 'pharmacy', 'school', 'general'])
  })

  it('requires a category on every industry definition', () => {
    expect(findIndustryProblems({ ...INDUSTRIES.farm, category: ' ' }).join()).toMatch(/category is required/)
    for (const d of listIndustries()) expect(d.icon, d.id).toBeDefined()
  })
})

describe('multi-select', () => {
  it('toggles business types on and off without duplicates, keeping the order picked', () => {
    let s = toggleSelection([], 'farm')
    s = toggleSelection(s, 'bakery')
    expect(s).toEqual(['farm', 'bakery'])
    expect(toggleSelection(s, 'farm')).toEqual(['bakery'])
    expect(toggleSelection(toggleSelection(s, 'retail'), 'retail')).toEqual(['farm', 'bakery'])
  })

  it('lists what each selected type includes, core modules first and without repeats', () => {
    const names = includedModuleNames(INDUSTRIES.farm)
    expect(names.slice(0, 3)).toEqual(['Dashboard', 'Staff & Roles', 'Settings'])
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Farm Batches')
    expect(includedModuleNames(INDUSTRIES.pharmacy)).toEqual(expect.arrayContaining(['Medicines', 'Batches & Expiry', 'Prescriptions']))
  })

  it('creating several types makes separate businesses, each with its own industry and modules', () => {
    demoSignIn('owner@demo.test', 'demo1234')
    const ids = (['farm', 'bakery', 'retail'] as const).map((t) => demoCreateBusiness(`Multi ${t}`, t, {}))
    expect(new Set(ids).size).toBe(3)
    const enabled = (id: string) => demoModuleStatuses(id).filter((s) => s.enabled).map((s) => s.code)
    expect(enabled(ids[0])).toContain('farm-batches')
    expect(enabled(ids[0])).not.toContain('bakery-recipes')
    expect(enabled(ids[1])).toContain('bakery-recipes')
    expect(enabled(ids[2])).not.toContain('farm-batches')
  })
})

describe('optional add-ons chosen during onboarding', () => {
  it('are enabled on the new business without changing what else is on', async () => {
    demoSignIn('owner@demo.test', 'demo1234')
    const id = demoCreateBusiness('Add-on Farm', 'farm', {})
    const before = demoModuleStatuses(id).filter((s) => s.enabled).map((s) => s.code)
    expect(before).not.toContain('suppliers')
    expect(await enableModule(id, 'suppliers')).toBeNull()
    const after = demoModuleStatuses(id).filter((s) => s.enabled).map((s) => s.code)
    expect(after).toEqual(expect.arrayContaining([...before, 'suppliers']))
    expect(await enableModule(id, 'bakery-recipes')).toMatch(/not compatible/)
  })
})
