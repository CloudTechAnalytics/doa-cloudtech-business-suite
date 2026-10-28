import { describe, expect, it } from 'vitest'
import { needsRelist } from '@/core/business-context/relist'

describe('when the business list is asked for again after signing in', () => {
  it('is asked again only when an invitation was accepted, since that can add a business', () => {
    expect(needsRelist({ data: 1, error: null })).toBe(true); expect(needsRelist({ data: 3, error: null })).toBe(true); expect(needsRelist({ data: '2', error: null })).toBe(true)
  })
  it('is not asked again when nothing was accepted, or the call failed', () => {
    expect(needsRelist({ data: 0, error: null })).toBe(false); expect(needsRelist({ data: null, error: null })).toBe(false); expect(needsRelist({ data: undefined, error: null })).toBe(false)
    expect(needsRelist({ data: 2, error: { message: 'boom' } })).toBe(false); expect(needsRelist({ data: 'x', error: null })).toBe(false)
  })
})
