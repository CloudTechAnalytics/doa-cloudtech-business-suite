import { describe, expect, it } from 'vitest'
import { INDUSTRIES, listAvailableIndustries } from '@/core/industry-registry'
import { compatibleModules } from '@/core/module-registry/registry'
import { pharmacy } from '..'

describe('pharmacy industry', () => {
  it('is registered and available, and owns only pharmacy-prefixed modules and permissions', () => {
    expect(INDUSTRIES.pharmacy).toBe(pharmacy)
    expect(pharmacy.status).toBe('active')
    expect(pharmacy.modules.length).toBeGreaterThan(0)
    expect(pharmacy.modules.every((m) => m.code.startsWith('pharmacy-'))).toBe(true)
    expect(pharmacy.permissions.map((p) => p.code).sort()).toEqual(['pharmacy.dispense', 'pharmacy.manage', 'pharmacy.rx'])
    expect(listAvailableIndustries().map((d) => d.id)).toContain('pharmacy')
  })

  it('composes the shared stock, sales and purchasing modules and requires sales', () => {
    expect(pharmacy.requiredModules).toEqual(['sales'])
    expect(pharmacy.defaultModules).toEqual(expect.arrayContaining(['inventory', 'sales', 'purchases', 'suppliers', 'pharmacy-batches', 'pharmacy-prescriptions']))
    expect(compatibleModules('pharmacy')).toContain('pharmacy-products')
    expect(compatibleModules('retail')).not.toContain('pharmacy-products')
  })

  it('has a route and a navigation entry for every module it owns', () => {
    const routed = pharmacy.routes.map((r) => r.module)
    for (const m of pharmacy.modules) expect(routed, m.code).toContain(m.code)
    const nav = pharmacy.navigation.flatMap((s) => s.modules)
    for (const m of pharmacy.modules) expect(nav, m.code).toContain(m.code)
  })

  it('gates prescriptions behind the prescription permission, not general inventory access', () => {
    expect(pharmacy.modules.find((m) => m.code === 'pharmacy-prescriptions')!.permission).toBe('pharmacy.rx')
  })
})
