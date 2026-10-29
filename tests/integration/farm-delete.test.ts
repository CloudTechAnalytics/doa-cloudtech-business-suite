import { beforeAll, describe, expect, it } from 'vitest'
import * as farm from '@/demo/demoFarm'
import { demoDeleteRecord } from '@/demo/demoDelete'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { INDUSTRIES } from '@/core/industry-registry'

const B = 'b-farm'
const today = new Date().toISOString().slice(0, 10)
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const f = () => farm.getFarm()

beforeAll(() => { as('owner@demo.test'); farm.ensureDemoFarm(B) })

describe('deleting farm notes, places and batches', () => {
  it('deletes a note', () => {
    const house = f().units.find((u) => u.businessId === B && u.name === 'House A')!
    expect(farm.demoAddActivity(B, { batchId: null, unitId: house.id, type: 'cleaning', notes: 'Swept out', on: today })).toBeNull()
    const note = f().activities.find((a) => a.businessId === B && a.notes === 'Swept out')!
    expect(demoDeleteRecord(B, 'farm_note', note.id)).toBeNull()
    expect(f().activities.some((a) => a.id === note.id)).toBe(false)
  })

  it('deletes a place nothing was kept in, but not one with a batch', () => {
    expect(farm.demoCreateUnit(B, { name: 'Spare pen', unitType: 'pen', productionType: 'livestock', capacity: null })).toBeNull()
    const spare = f().units.find((u) => u.businessId === B && u.name === 'Spare pen')!
    expect(demoDeleteRecord(B, 'farm_unit', spare.id)).toBeNull()
    const house = f().units.find((u) => u.businessId === B && u.name === 'House A')!
    expect(demoDeleteRecord(B, 'farm_unit', house.id)).toMatch(/cannot be deleted.*delete those first, or archive it/)
  })

  it('deletes a batch started by mistake, but not one with records', () => {
    const house = f().units.find((u) => u.businessId === B && u.name === 'House A')!
    expect(farm.demoStartBatch(B, { unitId: house.id, code: 'OOPS-1', species: 'Broiler', variety: '', productionType: 'poultry', opening: 50, startDate: today, plannedEnd: null, basis: 'exact' }, 'del-oops-abcdefgh').error).toBeNull()
    const oops = f().batches.find((b) => b.code === 'OOPS-1')!
    expect(demoDeleteRecord(B, 'farm_batch', oops.id)).toBeNull()
    expect(f().batches.some((b) => b.id === oops.id)).toBe(false)
    expect(f().events.some((e) => e.batchId === oops.id)).toBe(false)
    const running = f().batches.find((b) => b.businessId === B && b.code === 'B-2026-04')!
    expect(demoDeleteRecord(B, 'farm_batch', running.id)).toMatch(/cannot be deleted|Close it instead/)
  })

  it('only farm managers delete places and batches', () => {
    as('cashier@demo.test')
    const house = f().units.find((u) => u.businessId === B && u.name === 'House A')!
    expect(demoDeleteRecord(B, 'farm_unit', house.id)).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})

describe('a farm can record supplier bills', () => {
  it('has suppliers and purchase orders by default', () => {
    expect(INDUSTRIES.farm.defaultModules).toEqual(expect.arrayContaining(['suppliers', 'purchases', 'farm-supplier-bills']))
  })
})
