import { describe, expect, it } from 'vitest'
import { batchTimeline, sellAfter } from '@/industries/farm/components/BatchPage'
import type { HealthDto } from '@/industries/farm/services/opsApi'
import type { FarmData } from '@/industries/farm/types'

const names = { product: (id: string) => ({ p1: 'Layer mash', p2: 'Eggs' })[id] ?? '?', unit: (id: string) => ({ p1: 'kg', p2: 'crate' })[id] ?? '' }
const treatment = (v: Partial<HealthDto>): HealthDto => ({ id: 't1', batchId: 'b1', type: 'treatment', title: 'Antibiotic', productId: null, quantity: null, on: '2026-10-20', withdrawalDays: 7, withdrawalEndsOn: '2026-10-27', notes: null, status: 'posted', voidReason: null, ...v })
const data: FarmData = {
  units: [], batches: [],
  events: [
    { id: 'e1', batchId: 'b1', type: 'opening', quantity: 500, reason: null, on: '2026-10-01', reversesId: null, reversed: false },
    { id: 'e2', batchId: 'b1', type: 'mortality', quantity: -3, reason: 'Heat', on: '2026-10-21', reversesId: null, reversed: false },
    { id: 'e3', batchId: 'b1', type: 'mortality', quantity: -1, reason: 'Typo', on: '2026-10-22', reversesId: null, reversed: true },
    { id: 'e9', batchId: 'other', type: 'mortality', quantity: -9, reason: 'Elsewhere', on: '2026-10-23', reversesId: null, reversed: false },
  ],
  feeds: [
    { id: 'f1', batchId: 'b1', productId: 'p1', quantity: 50, on: '2026-10-22', notes: null, status: 'posted' },
    { id: 'f2', batchId: 'b1', productId: 'p1', quantity: 40, on: '2026-10-23', notes: null, status: 'voided' },
  ],
  harvests: [{ id: 'h1', batchId: 'b1', productId: 'p2', quantity: 12, date: '2026-10-24', animalsRemoved: null, status: 'posted' }],
  activities: [{ id: 'a1', batchId: 'b1', unitId: null, type: 'water_check', notes: 'Drinkers cleaned', on: '2026-10-25' }],
}

describe("a batch's own page", () => {
  it('shows only this batch’s history, newest first, without voided records', () => {
    const t = batchTimeline(data, [treatment({})], 'b1', names)
    expect(t.map((x) => x.kind)).toEqual(['Water check', 'Collected', 'Fed', 'Died', 'Died', 'Treatment', 'Started'])
    expect(t.find((x) => x.id === 'ee3')!.text).toMatch(/\(corrected\)/)
    expect(t.find((x) => x.kind === 'Fed')!.text).toBe('50 kg Layer mash')
    expect(t.find((x) => x.kind === 'Collected')!.text).toBe('12 crate Eggs')
    expect(t.find((x) => x.kind === 'Treatment')!.text).toMatch(/do not sell until 2026-10-27/)
    expect(t.some((x) => x.text.includes('Elsewhere'))).toBe(false)
  })

  it('lets a manager correct a death only once', () => {
    const t = batchTimeline(data, [], 'b1', names)
    expect(t.find((x) => x.id === 'ee2')!.eventId).toBe('e2')
    expect(t.find((x) => x.id === 'ee3')!.eventId).toBeUndefined() // already corrected
    expect(t.find((x) => x.id === 'ee1')!.eventId).toBeUndefined() // the starting count is not corrected this way
  })

  it('warns not to sell until the last treatment waiting period ends', () => {
    const h = [treatment({}), treatment({ id: 't2', withdrawalEndsOn: '2026-11-05' }), treatment({ id: 't3', withdrawalEndsOn: '2026-12-01', status: 'voided' })]
    expect(sellAfter(h, 'b1', '2026-10-29')).toBe('2026-11-05')
    expect(sellAfter(h, 'b1', '2026-11-06')).toBeNull()
    expect(sellAfter(h, 'other', '2026-10-29')).toBeNull()
  })
})
