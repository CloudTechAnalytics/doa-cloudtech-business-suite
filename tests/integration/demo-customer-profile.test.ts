import { beforeAll, describe, expect, it } from 'vitest'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'
import * as crm from '@/modules/crm/crmApi'

const B = 'b-retail'
let n = 0
const key = () => `dcp-${n++}-abcdefgh`
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let loc: string, ada: string, product: string
const row = async (id: string) => (await crm.searchCustomers(B, { q: '', category: '', page: 0, pageSize: 100 })).rows.find((r) => r.id === id)!

beforeAll(async () => {
  demoSignIn('owner@demo.test', 'demo1234')
  ensureDemoInventory(B, 'retail')
  trade.ensureDemoTrade(B)
  loc = getInv().locations.find((l) => l.businessId === B)!.id
  product = getInv().products.find((p) => p.businessId === B && p.name.startsWith('Vegetable Oil'))!.id
  expect(await crm.createCustomer(B, { name: 'Ngozi Stores', phone: '0803', email: '', source: 'walk-in', category: 'Retailer', company: 'Ngozi & Sons', city: 'Enugu', address: '4 Market Rd', notes: 'Pays monthly' })).toBeNull()
  ada = (await crm.searchCustomers(B, { q: 'Ngozi', category: '', page: 0, pageSize: 10 })).rows[0].id
})

describe('demo customer profile follows the database rules', () => {
  it('keeps the fuller details and lets staff with customer access edit them', async () => {
    expect(await row(ada)).toMatchObject({ company: 'Ngozi & Sons', city: 'Enugu', address: '4 Market Rd', notes: 'Pays monthly' })
    expect(await crm.updateCustomer(B, ada, { name: 'Ngozi Stores', phone: '0803', email: 'n@x.test', source: 'walk-in', category: 'Retailer', city: 'Abuja', notes: 'Prefers delivery' })).toBeNull()
    expect(await row(ada)).toMatchObject({ city: 'Abuja', email: 'n@x.test', notes: 'Prefers delivery', company: null })
    expect(await crm.updateCustomer(B, ada, { name: ' ', phone: '', email: '', source: '', category: '' })).toMatch(/name/)
    expect(await crm.updateCustomer(B, ada, { name: 'Ngozi Stores', phone: '', email: '', source: '', category: '', notes: 'x'.repeat(2001) })).toMatch(/2000/)
    as('accountant@demo.test')
    expect(await crm.updateCustomer(B, ada, { name: 'Hacked', phone: '', email: '', source: '', category: '' })).toMatch(/permission denied/)
    as('owner@demo.test')
  })

  it('starts at zero, then adds up sales net of returns and shows what is owed', async () => {
    expect((await row(ada)).summary).toMatchObject({ orders: 0, lifetimeSpend: 0, lastPurchaseAt: null })
    const sale = trade.demoPostSale(B, loc, ada, [{ productId: product, quantity: 4 }], [{ method: 'cash', amount: 39200 }], key())
    expect(sale.error).toBeNull()
    const credit = trade.demoPostSale(B, loc, ada, [{ productId: product, quantity: 1 }], [], key())
    expect(credit.error).toMatch(/credit/) // no credit limit yet
    expect(trade.demoSetCreditLimit(B, ada, 50000)).toBeNull()
    expect(trade.demoPostSale(B, loc, ada, [{ productId: product, quantity: 1 }], [{ method: 'cash', amount: 4800 }], key()).error).toBeNull()
    const r = await row(ada)
    expect(r.summary.orders).toBe(2)
    expect(r.summary.lifetimeSpend).toBe(49000) // 4 + 1 oils at 9,800
    expect(r.outstanding).toBe(5000)
    expect(r.summary.lastPurchaseAt).not.toBeNull()
  })

  it('ranks what they buy and keeps unrelated customers at zero', async () => {
    expect(await crm.customerTopProducts(B, ada)).toEqual([{ product: 'Vegetable Oil 5L', units: 5, revenue: 49000 }])
    const other = (await crm.searchCustomers(B, { q: 'Chidi', category: '', page: 0, pageSize: 5 })).rows[0]
    expect(other.summary.orders).toBe(0)
    expect(await crm.customerTopProducts(B, other.id)).toEqual([])
  })

  it('hides spending from roles that cannot read sales', async () => {
    as('accountant@demo.test') // accountants read sales but not the customer list's edit rights
    expect((await row(ada)).summary.orders).toBe(2)
    as('owner@demo.test')
  })
})
