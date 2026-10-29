import { describe, expect, it } from 'vitest'
import { batchTimeline, canDelete, farmTimeline, sellAfter } from '@/industries/farm/components/BatchPage'
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
  it('shows only this batch’s history, newest first, without deleted records', () => {
    const t = batchTimeline(data, [treatment({})], 'b1', names)
    expect(t.map((x) => x.kind)).toEqual(['Water check', 'Collected', 'Fed', 'Died', 'Treatment', 'Started'])
    expect(t.some((x) => x.id === 'ee3')).toBe(false) // a deleted death is gone
    expect(t.find((x) => x.kind === 'Fed')!.text).toBe('50 kg Layer mash')
    expect(t.find((x) => x.kind === 'Collected')!.text).toBe('12 crate Eggs')
    expect(t.find((x) => x.kind === 'Treatment')!.text).toMatch(/do not sell until 2026-10-27/)
    expect(t.some((x) => x.text.includes('Elsewhere'))).toBe(false)
  })

  it('offers Delete on every line except the starting count, with what deleting undoes', () => {
    const t = batchTimeline(data, [treatment({})], 'b1', names)
    expect(t.find((x) => x.id === 'ee2')!.remove).toEqual({ kind: 'event', id: 'e2' })
    expect(t.find((x) => x.id === 'ff1')!.remove).toEqual({ kind: 'feed', id: 'f1' })
    expect(t.find((x) => x.id === 'hh1')!.remove).toEqual({ kind: 'harvest', id: 'h1' })
    expect(t.find((x) => x.id === 'tt1')!.remove).toEqual({ kind: 'health', id: 't1' })
    expect(t.find((x) => x.id === 'aa1')!.remove).toEqual({ kind: 'note', id: 'a1' })
    expect(t.find((x) => x.id === 'ee1')!.remove).toBeUndefined() // the starting count is deleted with the batch itself
  })

  it('lets a manager delete anything, and the people who record farm work delete notes', () => {
    const manager = { can: (p: string) => p === 'farm.manage' || p === 'farm.record' }
    const worker = { can: (p: string) => p === 'farm.record' }
    expect(canDelete(manager, { kind: 'feed', id: 'x' })).toBe(true)
    expect(canDelete(worker, { kind: 'feed', id: 'x' })).toBe(false)
    expect(canDelete(worker, { kind: 'note', id: 'x' })).toBe(true)
  })

  it('lists one day across all batches for Record Today', () => {
    const t = farmTimeline(data, [], names, { day: '2026-10-22' })
    expect(t.map((x) => x.id)).toEqual(['ff1']) // the deleted death that day is left out
  })

  it('warns not to sell until the last treatment waiting period ends', () => {
    const h = [treatment({}), treatment({ id: 't2', withdrawalEndsOn: '2026-11-05' }), treatment({ id: 't3', withdrawalEndsOn: '2026-12-01', status: 'voided' })]
    expect(sellAfter(h, 'b1', '2026-10-29')).toBe('2026-11-05')
    expect(sellAfter(h, 'b1', '2026-11-06')).toBeNull()
    expect(sellAfter(h, 'other', '2026-10-29')).toBeNull()
  })
})
