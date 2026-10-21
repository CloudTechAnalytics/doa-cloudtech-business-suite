import { describe, expect, it } from 'vitest'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { retail } from '..'

describe('retail industry', () => {
  it('composes the shared modules, adds its own mart modules, and requires sales', () => {
    expect(retail.modules.every((m) => m.code.startsWith('retail-'))).toBe(true)
    expect(retail.requiredModules).toEqual(['sales'])
    expect(retail.defaultModules).toEqual(expect.arrayContaining(['inventory', 'sales', 'purchases', 'customers']))
  })

  it('asks for a tax rate and validates it', () => {
    expect(validateSetupAnswers(retail, {})).toEqual({})
    expect(validateSetupAnswers(retail, { tax_rate_percent: -1 }).tax_rate_percent).toMatch(/at least 0/)
  })
})
