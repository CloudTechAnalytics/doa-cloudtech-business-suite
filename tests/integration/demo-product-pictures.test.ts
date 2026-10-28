import { beforeAll, describe, expect, it } from 'vitest'
import * as mart from '@/demo/demoMart'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'

const B = 'b-retail'
const jpeg = (kb: number) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1000)
let id: string

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  expect(mart.demoSaveMartProduct(B, { id: null, name: 'Picture test', sku: '', barcode: '', categoryId: null, brand: '', unit: 'each', cost: 100, price: 150, wholesale: null, reorder: null, supplierId: null, trackExpiry: false, active: true, packs: [] }, 'pic-key-12345').error).toBeNull()
  id = mart.demoMartProducts(B).find((p) => p.name === 'Picture test')!.id
})

describe('product pictures in the demo, as in the database', () => {
  it('keeps a small and a large picture per product, replaces them, and removes them', () => {
    expect(mart.demoSetProductImage(B, id, jpeg(5), jpeg(80))).toBeNull()
    expect(mart.demoProductThumbs(B)[id]).toBe(jpeg(5)); expect(mart.demoProductImage(id)).toBe(jpeg(80))
    expect(mart.demoSetProductImage(B, id, jpeg(6), jpeg(90))).toBeNull(); expect(mart.demoProductThumbs(B)[id]).toBe(jpeg(6))
    expect(mart.demoSetProductImage(B, id, null, null)).toBeNull()
    expect(mart.demoProductThumbs(B)[id]).toBeUndefined(); expect(mart.demoProductImage(id)).toBeNull()
  })
  it('refuses anything that is not a small JPEG, and an unknown product', () => {
    expect(mart.demoSetProductImage(B, id, 'data:image/png;base64,AAAA', jpeg(5))).toMatch(/JPEG/)
    expect(mart.demoSetProductImage(B, id, jpeg(40), jpeg(80))).toMatch(/too large/)
    expect(mart.demoSetProductImage(B, id, jpeg(5), jpeg(250))).toMatch(/too large/)
    expect(mart.demoSetProductImage(B, 'nope', jpeg(5), jpeg(80))).toMatch(/permission denied/)
  })
  it('is refused to a cashier', () => {
    expect(mart.demoSetProductImage(B, id, jpeg(5), jpeg(80))).toBeNull()
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    expect(mart.demoSetProductImage(B, id, null, null)).toMatch(/permission denied/)
    expect(mart.demoProductThumbs(B)[id]).toBe(jpeg(5))
  })
})
