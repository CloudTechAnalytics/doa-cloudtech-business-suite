import { describe, expect, it } from 'vitest'
import { validateSetupAnswers } from '@/core/industry-registry/validate'
import { retail } from '..'

describe('retail industry', () => {
  it('composes shared modules only and requires sales', () => {
    expect(retail.modules).toEqual([])
    expect(retail.requiredModules).toEqual(['sales'])
    expect(retail.defaultModules).toEqual(expect.arrayContaining(['inventory', 'sales', 'purchases', 'customers']))
  })

  it('asks for a tax rate and validates it', () => {
    expect(validateSetupAnswers(retail, {})).toEqual({})
    expect(validateSetupAnswers(retail, { tax_rate_percent: -1 }).tax_rate_percent).toMatch(/at least 0/)
  })
})
