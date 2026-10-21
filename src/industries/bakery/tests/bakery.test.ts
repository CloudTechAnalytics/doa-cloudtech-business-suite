import { describe, expect, it } from 'vitest'
import { bakery } from '..'

describe('bakery industry', () => {
  it('owns bakery-prefixed modules with routes and requires production', () => {
    for (const m of bakery.modules) {
      expect(m.code.startsWith('bakery-')).toBe(true)
      expect(bakery.routes.some((r) => r.module === m.code), m.code).toBe(true)
    }
    expect(bakery.requiredModules).toEqual(['bakery-production'])
  })

  it('uses shared inventory for ingredients and finished goods rather than its own stock tables', () => {
    const stock = bakery.modules.filter((m) => m.permission === 'inventory.read').map((m) => m.code)
    expect(stock).toEqual(['bakery-ingredients', 'bakery-finished-goods'])
    expect(bakery.requiredSharedModules).toContain('inventory')
  })

  it('treats customers (wholesale and custom orders) as the shared CRM, not a bakery copy', () => {
    expect(bakery.optionalModules).toEqual(['customers'])
    expect(bakery.modules.some((m) => m.code.includes('customer'))).toBe(false)
  })
})
