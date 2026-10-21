import { describe, expect, it } from 'vitest'
import { INDUSTRIES } from '@/core/industry-registry'
import { listAvailableIndustries } from '@/core/industry-registry'
import { compatibleModules } from '@/core/module-registry/registry'
import { pharmacy } from '..'

describe('pharmacy scaffold', () => {
  it('is registered but coming soon, and exposes nothing', () => {
    expect(INDUSTRIES.pharmacy).toBe(pharmacy)
    expect(pharmacy.status).toBe('coming_soon')
    expect(pharmacy.modules).toEqual([])
    expect(pharmacy.routes).toEqual([])
    expect(compatibleModules('pharmacy')).toEqual([])
    expect(listAvailableIndustries().map((d) => d.id)).not.toContain('pharmacy')
  })
})
