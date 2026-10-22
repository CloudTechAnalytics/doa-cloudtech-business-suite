import { beforeAll, describe, expect, it } from 'vitest'
import { demoLocations, demoSaveLocation, demoSetLocationStatus, ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'

const B = 'b-retail'
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const names = () => demoLocations(B).filter((l) => l.active).map((l) => l.name)

beforeAll(() => { demoSignIn('owner@demo.test', 'demo1234'); ensureDemoInventory(B, 'retail') })

describe('demo stock locations follow the database rules', () => {
  it('seeds the sample Main store and Shelf 1, which can be managed like any other', () => {
    expect(names()).toEqual(expect.arrayContaining(['Main store', 'Shelf 1']))
  })

  it('adds and renames, with unique names and a valid kind of place', () => {
    expect(demoSaveLocation(B, { id: null, name: 'Cold room', type: 'warehouse' })).toBeNull()
    expect(demoSaveLocation(B, { id: null, name: 'cold room', type: 'shelf' })).toMatch(/duplicate key/)
    expect(demoSaveLocation(B, { id: null, name: ' ', type: 'shelf' })).toMatch(/name/)
    expect(demoSaveLocation(B, { id: null, name: 'Odd', type: 'spaceship' })).toMatch(/kind of place/)
    const id = demoLocations(B).find((l) => l.name === 'Cold room')!.id
    expect(demoSaveLocation(B, { id, name: 'Freezer', type: 'warehouse' })).toBeNull()
    expect(names()).toContain('Freezer')
  })

  it('archives only an empty location and keeps one active', () => {
    const main = demoLocations(B).find((l) => l.name === 'Main store')!
    expect(main.stocked).toBeGreaterThan(0)
    expect(demoSetLocationStatus(B, main.id, 'archived')).toMatch(/move or sell the stock/)
    const shelf = demoLocations(B).find((l) => l.name === 'Shelf 1')!
    expect(demoSetLocationStatus(B, shelf.id, 'archived')).toBeNull()
    expect(names()).not.toContain('Shelf 1')
    expect(getInv().locations.some((l) => l.id === shelf.id)).toBe(true) // history keeps pointing at it
    expect(demoSetLocationStatus(B, shelf.id, 'active')).toBeNull()
    for (const l of demoLocations(B).filter((x) => x.active && x.id !== main.id)) demoSetLocationStatus(B, l.id, 'archived')
    expect(demoSetLocationStatus(B, main.id, 'archived')).toMatch(/move or sell|at least one/)
  })

  it('needs permission to change locations', () => {
    as('cashier@demo.test')
    expect(demoSaveLocation(B, { id: null, name: 'Nope', type: 'shelf' })).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})
