import { describe, expect, it } from 'vitest'
import { naira } from '@/shared/utilities/format'

describe('writing money', () => {
  it('writes amounts with the naira sign, thousands and two decimals', () => { expect(naira(967.5)).toBe('₦967.50'); expect(naira(1234567.891)).toBe('₦1,234,567.89'); expect(naira(0)).toBe('₦0.00') })
  it('puts the minus sign before the naira sign', () => { expect(naira(-67.5)).toBe('-₦67.50'); expect(naira(-1000)).toBe('-₦1,000.00') })
  it('never shows a minus on zero, however it got there', () => { expect(naira(-0)).toBe('₦0.00'); expect(naira(-0.001)).toBe('₦0.00') })
  it('shows a dash for nothing', () => { expect(naira(null)).toBe('–'); expect(naira(undefined)).toBe('–') })
})
