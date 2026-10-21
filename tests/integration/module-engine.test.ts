import { describe, expect, it } from 'vitest'
import { computeModuleStatuses } from '@/core/module-registry/availability'
import { rolePermissions } from '@/core/permissions/roles'
import {
  demoChangeIndustry, demoDisableModule, demoEnableModule, demoModuleStatuses, demoSetPlan, demoSignIn, demoSignOut,
} from '@/demo/demoStore'

const usable = (s: ReturnType<typeof demoModuleStatuses>) => s.filter((m) => m.usable).map((m) => m.code)

describe('navigation differs per industry', () => {
  it('retail, farm and bakery owners see different usable modules', () => {
    const owner = rolePermissions('owner')
    const mk = (industry: 'retail' | 'farm' | 'bakery', enabled: string[]) =>
      usable(computeModuleStatuses({ industry, enabled: enabled as never, plan: 'business', permissions: owner }))
    expect(mk('retail', ['sales', 'purchases'])).not.toContain('farm-batches')
    expect(mk('farm', ['farm-batches'])).toContain('farm-batches')
    expect(mk('bakery', ['bakery-recipes'])).toContain('bakery-recipes')
  })

  it('a module outside the industry is not listed at all', () => {
    const s = computeModuleStatuses({ industry: 'retail', enabled: [], plan: 'business', permissions: rolePermissions('owner') })
    expect(s.find((m) => m.code === 'farm-batches')).toBeUndefined()
  })

  it('plan, permission and enabled state each block usage', () => {
    const base = { industry: 'retail' as const, enabled: ['sales', 'reports'] as never, plan: 'starter' as const }
    const find = (s: ReturnType<typeof computeModuleStatuses>, c: string) => s.find((m) => m.code === c)!
    expect(find(computeModuleStatuses({ ...base, permissions: rolePermissions('owner') }), 'reports').availability).toBe('needs_plan')
    expect(find(computeModuleStatuses({ ...base, plan: 'growth', permissions: rolePermissions('cashier') }), 'reports').availability).toBe('no_permission')
    expect(find(computeModuleStatuses({ ...base, plan: 'growth', permissions: rolePermissions('owner') }), 'customers').availability).toBe('disabled')
    expect(find(computeModuleStatuses({ ...base, plan: null, permissions: rolePermissions('owner') }), 'dashboard').usable).toBe(true)
  })
})

describe('demo store operations', () => {
  it('only owners/admins can change modules; industry change needs confirmation and is owner-only', () => {
    demoSignIn('cashier@demo.test', 'demo1234')
    expect(demoEnableModule('b-retail', 'customers')).toBe('permission denied')
    expect(demoChangeIndustry('b-retail', 'bakery', true)).toMatch(/only the owner/)
    demoSignOut()

    demoSignIn('owner@demo.test', 'demo1234')
    expect(demoDisableModule('b-farm', 'farm-overview')).toMatch(/cannot be disabled/)
    expect(demoEnableModule('b-farm', 'bakery-recipes')).toMatch(/not compatible/)
    expect(demoChangeIndustry('b-farm', 'retail', false)).toMatch(/Confirm/)
    expect(demoChangeIndustry('b-farm', 'spaceship' as never, true)).toBeTruthy()
    expect(usable(demoModuleStatuses('b-farm'))).toContain('farm-batches')
    expect(demoChangeIndustry('b-farm', 'retail', true)).toBeNull()
    expect(usable(demoModuleStatuses('b-farm'))).not.toContain('farm-batches')
    expect(usable(demoModuleStatuses('b-farm'))).toContain('customers')
    demoSetPlan('b-farm', null)
    expect(usable(demoModuleStatuses('b-farm'))).toEqual(['dashboard', 'staff', 'settings'])
  })
})
