import { beforeAll, describe, expect, it } from 'vitest'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as t from '@/demo/demoTrade'

const B = 'b-retail'
let n = 0
const key = () => `demo-${n++}-abcdefgh`
const product = (name: string) => getInv().products.find((p) => p.businessId === B && p.name.startsWith(name))!
const onHand = (name: string) => Object.entries(getInv().balances).filter(([k]) => k.startsWith(`${B}|${product(name).id}|`)).reduce((a, [, v]) => a + v.qty, 0)
let loc: string
let ada: string

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  ensureDemoInventory(B, 'retail')
  t.ensureDemoTrade(B)
  loc = getInv().locations.find((l) => l.businessId === B)!.id
  ada = t.getTrade().customers.find((c) => c.name === 'Ada Stores')!.id
})

describe('demo mode follows the same trade rules as the database', () => {
  const milk = () => product('Peak Milk')
  const oil = () => product('Vegetable Oil')

  it('prices on the server side, deducts stock once and is idempotent', () => {
    const k = key()
    const before = onHand('Vegetable Oil')
    const a = t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 2 }], [{ method: 'cash', amount: 19600 }], k)
    const b = t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 2 }], [{ method: 'cash', amount: 19600 }], k)
    expect(a.error).toBeNull()
    expect(b.result).toEqual(a.result)
    expect(onHand('Vegetable Oil')).toBe(before - 2)
  })

  it('rejects stale prices, overselling (atomically), overpayment and unauthorised discounts', () => {
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1, unitPrice: 1 }], [], key()).error).toMatch(/price .* has changed/)
    const stock = onHand('Vegetable Oil'); const sales = t.getTrade().sales.length
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1 }, { productId: milk().id, quantity: 9999 }], [], key()).error).toMatch(/insufficient stock/)
    expect(onHand('Vegetable Oil')).toBe(stock)
    expect(t.getTrade().sales.length).toBe(sales)
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1 }], [{ method: 'cash', amount: 99999 }], key()).error).toMatch(/exceeds the amount due/)
  })

  it('needs a customer and enough credit for a balance due', () => {
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1 }], [], key()).error).toMatch(/needs a customer/)
    const chidi = t.getTrade().customers.find((c) => c.name === 'Chidi Foods')!.id
    expect(t.demoPostSale(B, loc, chidi, [{ productId: oil().id, quantity: 1 }], [], key()).error).toMatch(/credit limit exceeded/)
    expect(t.demoPostSale(B, loc, ada, [{ productId: oil().id, quantity: 1 }], [], key()).error).toBeNull()
  })

  it('splits refunds with the remainder on the last unit, restocks at cost, caps eligibility', () => {
    const sold = t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 3, discount: 1 }], [{ method: 'cash', amount: 29399 }], key()).result!
    const item = t.getTrade().saleItems.find((i) => i.saleId === sold.saleId)!
    const ret = (q: number) => t.demoReturnSale(B, sold.saleId, [{ saleItemId: item.id, quantity: q, disposition: 'restock' }], 'changed mind', null, key())
    const totals = [ret(1), ret(1), ret(1)].map((r) => r.result!.total)
    expect(totals.reduce((a, b) => a + Math.round(b * 100), 0)).toBe(Math.round(item.total * 100))
    expect(ret(1).error).toMatch(/remain returnable/)
    expect(t.getTrade().sales.find((s) => s.id === sold.saleId)!.status).toBe('refunded')
  })

  it('requires payments to be reversed before voiding, then restores stock', () => {
    const before = onHand('Vegetable Oil')
    const s = t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 2 }], [{ method: 'cash', amount: 19600 }], key()).result!
    expect(t.demoVoidSale(B, s.saleId, 'entered twice', key())).toMatch(/reverse the successful payments/)
    const pay = t.getTrade().payments.find((p) => p.saleId === s.saleId)!
    expect(t.demoReversePayment(B, pay.id, 'wrong sale', key())).toBeNull()
    expect(t.demoVoidSale(B, s.saleId, 'entered twice', key())).toBeNull()
    expect(onHand('Vegetable Oil')).toBe(before)
  })

  it('purchase orders change stock only when goods are received, never beyond the order, and payments are capped', () => {
    const supplier = t.getTrade().suppliers.find((s) => s.businessId === B)!.id
    const before = onHand('Peak Milk')
    const po = t.demoCreatePurchase(B, supplier, [{ productId: milk().id, quantity: 10, unitCost: 1700 }], '', key()).result!
    expect(onHand('Peak Milk')).toBe(before)
    const line = t.getTrade().purchaseItems.find((i) => i.purchaseId === po.purchaseId)!
    expect(t.demoReceivePurchase(B, po.purchaseId, loc, [{ purchaseItemId: line.id, quantity: 11 }], key())).toMatch(/only 10 remain/)
    expect(t.demoReceivePurchase(B, po.purchaseId, loc, [{ purchaseItemId: line.id, quantity: 6 }], key())).toBeNull()
    expect(onHand('Peak Milk')).toBe(before + 6)
    expect(t.getTrade().purchases.find((p) => p.id === po.purchaseId)!.status).toBe('partially_received')
    expect(t.demoPayPurchase(B, po.purchaseId, 'cash', 17000.01, '', key())).toMatch(/exceeds the amount due/)
    expect(t.demoPayPurchase(B, po.purchaseId, 'cash', 17000, '', key())).toBeNull()
  })

  it('applies role permissions: a cashier cannot discount, refund, void or manage purchasing', () => {
    demoSignOut()
    demoSignIn('cashier@demo.test', 'demo1234')
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1, discount: 10 }], [{ method: 'cash', amount: 9790 }], key()).error).toMatch(/not allowed to give discounts/)
    expect(t.demoPostSale(B, loc, null, [{ productId: oil().id, quantity: 1 }], [{ method: 'cash', amount: 9800 }], key()).error).toBeNull()
    expect(t.demoVoidSale(B, t.getTrade().sales[0].id, 'nope', key())).toBe('permission denied')
    expect(t.demoCreatePurchase(B, 'x', [], '', key()).error).toBe('permission denied')
    demoSignOut()
  })
})
