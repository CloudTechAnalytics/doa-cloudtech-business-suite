import { describe, expect, it } from 'vitest'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { farm } from '..'

describe('farm industry', () => {
  it('owns farm-prefixed modules, each with a route, and declares its permissions', () => {
    expect(farm.modules.length).toBeGreaterThan(0)
    for (const m of farm.modules) {
      expect(m.code.startsWith('farm-')).toBe(true)
      expect(farm.routes.some((r) => r.module === m.code), m.code).toBe(true)
    }
    expect(farm.permissions.map((p) => p.code).sort()).toEqual(['farm.manage', 'farm.read', 'farm.record'])
  })

  it('requires inventory and sales, and keeps farm overview switched on', () => {
    expect(farm.requiredSharedModules).toEqual(expect.arrayContaining(['inventory', 'sales']))
    expect(farm.requiredModules).toContain('farm-overview')
  })

  it('needs at least one type of production', () => {
    expect(validateSetupAnswers(farm, { has_poultry: false })).toHaveProperty('has_poultry')
    expect(validateSetupAnswers(farm, { has_crops: true })).toEqual({})
  })

  it('offers its day-to-day workflows from the Record menu', () => {
    expect(farm.workflows.map((w) => w.id)).toEqual(['record-feeding', 'record-mortality', 'record-harvest'])
  })
})
