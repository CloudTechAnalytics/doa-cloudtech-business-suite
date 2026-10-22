import { beforeAll, describe, expect, it } from 'vitest'
import { demoDeleteRecord } from '@/demo/demoDelete'
import { demoSaveLocation, ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, demoCreateSupplier, demoPostSale, ensureDemoTrade, getTrade } from '@/demo/demoTrade'
import { demoMartProducts, demoRecordLoss, demoSaveCategory, demoSaveMartProduct, demoVoidLoss, getMart } from '@/demo/demoMart'
import * as crm from '@/modules/crm/crmApi'

const B = 'b-retail'
let n = 0
const key = () => `ddl-${n++}-abcdefgh`
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let loc: string
const customer = (name: string) => getTrade().customers.find((c) => c.businessId === B && c.name === name)!.id
const product = (name: string) => getInv().products.find((p) => p.businessId === B && p.name === name)!

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  ensureDemoInventory(B, 'retail'); ensureDemoTrade(B); demoMartProducts(B)
  loc = getInv().locations.find((l) => l.businessId === B)!.id
})

describe('demo delete follows the database rules', () => {
  it('deletes an unused customer and refuses one who has bought something', () => {
    expect(demoCreateCustomer(B, 'Temp Customer', '0800')).toBeNull()
    expect(demoDeleteRecord(B, 'customer', customer('Temp Customer'))).toBeNull()
    expect(getTrade().customers.some((c) => c.name === 'Temp Customer')).toBe(false)
    const ada = customer('Ada Stores')
    expect(demoPostSale(B, loc, ada, [{ productId: product('Vegetable Oil 5L').id, quantity: 1 }], [{ method: 'cash', amount: 9800 }], key()).error).toBeNull()
    expect(demoDeleteRecord(B, 'customer', ada)).toMatch(/cannot be deleted.*Archive it instead/)
    expect(customer('Ada Stores')).toBe(ada)
  })

  it('refuses a product with history, deletes one that was never used, and clears its packs', () => {
    expect(demoDeleteRecord(B, 'product', product('Vegetable Oil 5L').id)).toMatch(/cannot be deleted/)
    const made = demoSaveMartProduct(B, { id: null, name: 'Unused Item', sku: '', barcode: '', categoryId: null, brand: '', unit: 'each', cost: 10, price: 20, wholesale: null, reorder: null, supplierId: null, trackExpiry: false, active: true, packs: [{ name: 'box', units: 6 }] }, key())
    const id = made.result!.productId
    expect(getMart().packs.some((k) => k.productId === id)).toBe(true)
    expect(demoDeleteRecord(B, 'product', id)).toBeNull()
    expect(getInv().products.some((p) => p.id === id)).toBe(false)
    expect(getMart().packs.some((k) => k.productId === id)).toBe(false)
  })

  it('deletes a spare supplier and category, but not ones in use', () => {
    expect(demoCreateSupplier(B, 'Spare Supplier', '1')).toBeNull()
    const s = getTrade().suppliers.find((x) => x.name === 'Spare Supplier')!.id
    expect(demoDeleteRecord(B, 'supplier', s)).toBeNull()
    expect(demoSaveCategory(B, { id: null, name: 'Empty group' })).toBeNull()
    const empty = getMart().categories.find((c) => c.name === 'Empty group')!.id
    expect(demoDeleteRecord(B, 'category', empty)).toBeNull()
    const used = getMart().categories.find((c) => c.name === 'Groceries')!.id
    expect(demoDeleteRecord(B, 'category', used)).toMatch(/cannot be deleted/)
  })

  it('deletes an empty location with no history, and refuses one with stock history', () => {
    expect(demoSaveLocation(B, { id: null, name: 'Temp shelf', type: 'shelf' })).toBeNull()
    const temp = getInv().locations.find((l) => l.name === 'Temp shelf')!.id
    expect(demoDeleteRecord(B, 'location', temp)).toBeNull()
    expect(demoDeleteRecord(B, 'location', loc)).toMatch(/cannot be deleted/)
  })

  it('deletes a stock loss only after it was voided', () => {
    const r = demoRecordLoss(B, { productId: product('Vegetable Oil 5L').id, locationId: loc, quantity: 1, reason: 'damaged', notes: '' }, key())
    expect(r.error).toBeNull()
    const id = r.result!.lossId
    expect(demoDeleteRecord(B, 'loss', id)).toMatch(/void this entry first/)
    expect(demoVoidLoss(B, id, 'entered twice', key())).toBeNull()
    expect(demoDeleteRecord(B, 'loss', id)).toBeNull()
    expect(getMart().losses.some((w) => w.id === id)).toBe(false)
  })

  it('deletes a lead together with its notes', async () => {
    expect(await crm.createLead(B, { name: 'Walk-in lead', phone: '', email: '', source: '', notes: '' })).toBeNull()
    const lead = (await crm.searchLeads(B, { q: 'Walk-in', status: '', page: 0, pageSize: 5 })).rows[0]
    expect(demoDeleteRecord(B, 'lead', lead.id)).toBeNull()
    expect((await crm.searchLeads(B, { q: 'Walk-in', status: '', page: 0, pageSize: 5 })).rows).toHaveLength(0)
  })

  it('needs the same permission as changing the record, and never touches another business', () => {
    expect(demoCreateCustomer(B, 'Guarded', '1')).toBeNull()
    const id = customer('Guarded')
    as('accountant@demo.test')
    expect(demoDeleteRecord(B, 'customer', id)).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(demoDeleteRecord('b-farm', 'customer', id)).toMatch(/permission denied/)
    expect(demoDeleteRecord(B, 'customer', id)).toBeNull()
  })
})
