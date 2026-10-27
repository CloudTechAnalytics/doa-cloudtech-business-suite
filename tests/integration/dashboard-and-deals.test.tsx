import { describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import { dealsExport, sortDeals } from '@/modules/crm/CrmDealsList'
import type { DealRow } from '@/modules/crm/dealsApi'
import { crmModule } from '@/modules/crm/manifest'

const d = (id: string, over: Partial<DealRow> = {}): DealRow => ({ id, title: id, customerId: null, leadId: null, contact: 'Ada', contactPhone: null, contactEmail: null, value: 100, stageId: 's', stageName: 'Proposal', stageKind: 'open', probability: 50, ownerId: null, ownerName: 'Bola', expectedClose: null, nextStep: '', notes: '', lostReason: null, closedAt: null, createdAt: '2031-01-01T00:00:00Z', lastMovedAt: '2031-01-01T00:00:00Z', stale: false, ...over })

describe('the dashboard of a Business apps workspace', () => {
  it('has a widget, so it never shows "No widgets yet"', () => {
    const w = getIndustry('general').dashboardWidgets
    expect(w.map((x) => x.id)).toEqual(['apps-overview'])
  })
})

describe('Deals in the CRM sidebar', () => {
  it('is a part of its own, next to the pipeline board', () => {
    expect(crmModule.definition.sections!.map((s) => s.key).slice(0, 3)).toEqual(['pipeline', 'deals', 'activities'])
  })
})

describe('the deals list', () => {
  const rows = [d('a', { value: 300, createdAt: '2031-01-02T00:00:00Z', expectedClose: '2031-03-01', lastMovedAt: '2031-01-09T00:00:00Z' }), d('b', { value: 900, createdAt: '2031-01-03T00:00:00Z', lastMovedAt: '2031-01-02T00:00:00Z' }), d('c', { value: 100, createdAt: '2031-01-01T00:00:00Z', expectedClose: '2031-02-01' })]
  it('sorts by newest, biggest, closing soonest and quiet longest (no close date goes last)', () => {
    expect(sortDeals(rows, 'newest').map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(sortDeals(rows, 'value').map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(sortDeals(rows, 'close').map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(sortDeals(rows, 'quiet')[0].id).toBe('c')
  })
  it('does not change the order of the list it was given', () => { sortDeals(rows, 'value'); expect(rows.map((x) => x.id)).toEqual(['a', 'b', 'c']) })
  it('exports what is on screen with a chance of winning only for open deals', () => {
    const csv = dealsExport([d('x'), d('y', { stageKind: 'lost', lostReason: 'Price', stageName: 'Lost' })])
    expect(csv[0][0]).toBe('Deal'); expect(csv[1][5]).toBe(50); expect(csv[2][5]).toBeNull(); expect(csv[2][9]).toBe('Price')
  })
})
