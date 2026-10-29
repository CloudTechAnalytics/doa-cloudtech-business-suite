import { describe, expect, it } from 'vitest'
import { setupSteps } from '@/industries/farm/components/FarmOverview'
import type { InventoryData } from '@/modules/inventory/inventoryApi'
import type { FarmData } from '@/industries/farm/types'

const empty = (): FarmData => ({ units: [], batches: [], events: [], feeds: [], harvests: [], activities: [] })
const noStock = (): InventoryData => ({ products: [], locations: [], balances: [], movements: [], units: [], categories: [] })
const done = (data: FarmData, stock = noStock()) => setupSteps(data, stock).map((s) => s.done)

describe('the farm home walks a new farm through setup in order', () => {
  it('lists the four steps in the order they have to be done', () => {
    expect(setupSteps(empty(), noStock()).map((s) => s.to)).toEqual(['/app/farm/units', '/app/farm/batches', '/app/inventory', '/app/farm/daily'])
    expect(done(empty())).toEqual([false, false, false, false])
  })

  it('ticks each step off from the farm’s own records', () => {
    const data = empty()
    data.units.push({ id: 'u1', name: 'Pen A', unitType: 'pen', productionType: 'poultry', capacity: 500, status: 'active' })
    expect(done(data)).toEqual([true, false, false, false])
    data.batches.push({ id: 'b1', code: 'GS-1', unitId: 'u1', productionType: 'poultry', species: 'Broiler', status: 'active' } as FarmData['batches'][number])
    data.events.push({ id: 'e1', batchId: 'b1', type: 'opening', quantity: 200 } as FarmData['events'][number])
    expect(done(data)).toEqual([true, true, false, false]) // the opening count is not a day's record
    const stock = noStock(); stock.products.push({ id: 'p1', name: 'Layer mash' } as InventoryData['products'][number])
    expect(done(data, stock)).toEqual([true, true, true, false])
    data.events.push({ id: 'e2', batchId: 'b1', type: 'mortality', quantity: -2 } as FarmData['events'][number])
    expect(done(data, stock)).toEqual([true, true, true, true])
  })
})
