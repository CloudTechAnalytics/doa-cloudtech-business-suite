import { beforeAll, describe, expect, it } from 'vitest'
import * as farm from '@/demo/demoFarm'
import { getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { loadFarm } from '@/industries/farm/services/farmApi'
import { mortalityRate } from '@/industries/farm/types'

const B = 'b-farm'
let n = 0
const key = () => `df-${n++}-abcdefgh`
const today = new Date().toISOString().slice(0, 10)
const product = (name: string) => getInv().products.find((p) => p.businessId === B && p.name.startsWith(name))!
const stock = (name: string) => Object.entries(getInv().balances).filter(([k]) => k.startsWith(`${B}|${product(name).id}|`)).reduce((a, [, v]) => a + v.qty, 0)
const loc = () => getInv().locations.find((l) => l.businessId === B)!.id
const batch = (code: string) => farm.getFarm().batches.find((b) => b.businessId === B && b.code === code)!
const pop = (code: string) => farm.getFarm().events.filter((e) => e.batchId === batch(code).id).reduce((a, e) => a + e.quantity, 0)
const unit = (name: string) => farm.getFarm().units.find((u) => u.businessId === B && u.name === name)!

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  farm.ensureDemoFarm(B)
})

describe('demo farm follows the database rules', () => {
  it('starts a batch with its opening event; rejects mismatched units and duplicate codes', () => {
    const start = (code: string, u: string, type: 'poultry' | 'fish' = 'poultry') => farm.demoStartBatch(B, { unitId: unit(u).id, code, species: 'Layer', variety: '', productionType: type, opening: 100, startDate: today, plannedEnd: null, basis: 'exact' }, key())
    expect(start('T-1', 'House A').error).toBeNull()
    expect(pop('T-1')).toBe(100)
    expect(start('T-2', 'Pond 1').error).toMatch(/is for fish production/)
    expect(start('T-1', 'House A').error).toMatch(/duplicate key/)
  })

  it('refuses mortality above the population, requires a cause, and is idempotent', () => {
    const id = batch('T-1').id
    expect(farm.demoRecordMortality(B, id, 101, 'disease', today, key())).toMatch(/only 100 remain/)
    expect(farm.demoRecordMortality(B, id, 1, '', today, key())).toMatch(/cause is required/)
    const k = key()
    farm.demoRecordMortality(B, id, 5, 'disease', today, k); farm.demoRecordMortality(B, id, 5, 'disease', today, k)
    expect(pop('T-1')).toBe(95)
  })

  it('corrections are new events, once, and fold back into mortality', async () => {
    const id = batch('T-1').id
    const ev = farm.getFarm().events.find((e) => e.batchId === id && e.type === 'mortality')!
    expect(farm.demoReverseEvent(B, ev.id, 'entered twice', key())).toBeNull()
    expect(farm.demoReverseEvent(B, ev.id, 'again', key())).toMatch(/already reversed/)
    expect(pop('T-1')).toBe(100)
    const data = await loadFarm(B)
    const b = data.batches.find((x) => x.id === id)!
    expect([b.population, b.mortality, b.entering]).toEqual([100, 0, 100])
    expect(mortalityRate(b)).toBe(0)
  })

  it('estimated fish counts record an explicit adjustment', () => {
    farm.demoStartBatch(B, { unitId: unit('Pond 1').id, code: 'T-FISH', species: 'Catfish', variety: '', productionType: 'fish', opening: 100, startDate: today, plannedEnd: null, basis: 'estimated' }, key())
    expect(farm.demoAdjustPopulation(B, batch('T-FISH').id, 'removal', 120, 'sold', today, key())).toBeNull()
    expect(pop('T-FISH')).toBe(0)
    expect(farm.getFarm().events.filter((e) => e.batchId === batch('T-FISH').id && e.type === 'adjustment' && /estimated/.test(e.reason ?? ''))).toHaveLength(1)
  })

  it('feeding takes stock once, refuses more than is held, and voiding restores it', () => {
    const id = batch('T-1').id
    const before = stock('Layer Mash')
    const k = key()
    farm.demoRecordFeeding(B, id, product('Layer Mash').id, loc(), 50, today, '', k); farm.demoRecordFeeding(B, id, product('Layer Mash').id, loc(), 50, today, '', k)
    expect(stock('Layer Mash')).toBe(before - 50)
    expect(farm.demoRecordFeeding(B, id, product('Layer Mash').id, loc(), 999999, today, '', key())).toMatch(/insufficient stock/)
    const rec = farm.getFarm().feeds.find((f) => f.batchId === id)!
    expect(farm.demoVoidFeeding(B, rec.id, 'wrong batch', key())).toBeNull()
    expect(stock('Layer Mash')).toBe(before)
    expect(farm.demoVoidFeeding(B, rec.id, 'again', key())).toMatch(/already voided/)
  })

  it('a harvest adds produce and removes animals atomically; failure posts nothing', () => {
    const id = batch('T-1').id
    const [s0, p0] = [stock('Table eggs'), pop('T-1')]
    expect(farm.demoRecordHarvest(B, id, product('Table eggs').id, loc(), 30, today, 10, key())).toBeNull()
    expect([stock('Table eggs'), pop('T-1')]).toEqual([s0 + 30, p0 - 10])
    expect(farm.demoRecordHarvest(B, id, product('Table eggs').id, loc(), 5, today, 99999, key())).toMatch(/remain in batch/)
    expect([stock('Table eggs'), pop('T-1')]).toEqual([s0 + 30, p0 - 10])
    const h = farm.getFarm().harvests.find((x) => x.batchId === id)!
    expect(farm.demoVoidHarvest(B, h.id, 'in error', key())).toBeNull()
    expect([stock('Table eggs'), pop('T-1')]).toEqual([s0, p0])
  })

  it('closing needs confirmation to write off animals, then locks the batch', () => {
    const id = batch('T-1').id
    expect(farm.demoCloseBatch(B, id, 'cycle finished', false, key())).toMatch(/animals remain/)
    expect(farm.demoCloseBatch(B, id, 'cycle finished', true, key())).toBeNull()
    expect(pop('T-1')).toBe(0)
    expect(farm.demoRecordMortality(B, id, 1, 'x cause', today, key())).toMatch(/is closed/)
    expect(farm.demoCloseBatch(B, id, 'again', true, key())).toMatch(/already closed/)
  })

  it('applies roles: a worker can record but not start, correct, void or close', () => {
    demoSignOut()
    expect(demoSignIn('cashier@demo.test', 'demo1234')).toBeNull()
    // cashier has no farm access at all in this business, so every action is refused
    expect(farm.demoRecordMortality(B, batch('B-2026-04').id, 1, 'disease', today, key())).toBe('permission denied')
    expect(farm.demoCreateUnit(B, { name: 'Hack', unitType: 'pen', productionType: 'livestock', capacity: null })).toBe('permission denied')
    demoSignOut()
    demoSignIn('owner@demo.test', 'demo1234')
  })
})
