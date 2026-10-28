import { describe, expect, it } from 'vitest'
import { taxRateOf } from '@/core/business-context/taxRate'
import { priceCart } from '@/modules/sales/pricing'

describe('the tax the till shows', () => {
  it('reads the rate the owner set, and treats anything unusable as no tax', () => {
    expect(taxRateOf({ tax_rate_percent: 7.5 })).toBe(7.5); expect(taxRateOf({ tax_rate_percent: '5' })).toBe(5)
    for (const bad of [null, undefined, {}, { tax_rate_percent: -1 }, { tax_rate_percent: 101 }, { tax_rate_percent: 'x' }, { tax_rate_percent: null }]) expect(taxRateOf(bad)).toBe(0)
  })
  it('shows the total the server will charge: three at ₦300 with 7.5% tax is ₦967.50, not ₦900', () => {
    const lines = [{ quantity: 3, unitPrice: 300, discount: 0 }]
    expect(priceCart(lines, taxRateOf({ tax_rate_percent: 7.5 })).grandTotal).toBe(967.5)
    expect(priceCart(lines, taxRateOf({})).grandTotal).toBe(900)
  })
})
