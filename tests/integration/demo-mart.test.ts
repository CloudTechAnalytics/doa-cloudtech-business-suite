import { beforeAll, describe, expect, it } from 'vitest'
import * as mart from '@/demo/demoMart'
import { getInv } from '@/demo/demoInventory'
import { demoInvite, demoSignIn, demoSignOut, demoSignUp } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'

const B = 'b-retail'
let n = 0
const key = () => `dmt-${n++}-abcdefgh`
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let loc: string, supplier: string, category: string
const input = (over: Partial<mart.MartProductInput> = {}): mart.MartProductInput => ({
  id: null, name: 'Indomie Noodles', sku: '', barcode: '6001234500011', categoryId: category, brand: 'Indomie', unit: 'each', cost: 150, price: 200, wholesale: 180, reorder: 20, supplierId: null, trackExpiry: false, active: true,
  packs: [{ name: 'pack', units: 6 }, { name: 'carton', units: 72 }], ...over,
})
const save = (over: Partial<mart.MartProductInput> = {}) => mart.demoSaveMartProduct(B, input(over), key())
const row = (name: string) => mart.demoMartProducts(B).find((p) => p.name === name)!
const noodles = () => row('Indomie Noodles')

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  mart.demoMartProducts(B) // seeds the demo mart
  expect(demoInvite(B, 'officer@demo.test', 'inventory_officer')).toBeNull()
  expect(demoSignUp('Demo Officer', 'officer@demo.test', 'demo1234')).toBeNull() // accepts the invitation
  as('owner@demo.test')
  loc = getInv().locations.find((l) => l.businessId === B)!.id
  category = mart.getMart().categories.find((c) => c.businessId === B && c.name === 'Groceries')!.id
  supplier = (trade.demoCreateSupplier(B, 'Dangote Distributors', '0800') ?? '', trade.getTrade().suppliers.find((s) => s.businessId === B && s.name === 'Dangote Distributors')!.id)
})

describe('demo mart follows the database rules', () => {
  it('saves products with packs, rejects bad input and duplicate barcodes', () => {
    expect(save().error).toBeNull()
    expect(noodles()).toMatchObject({ price: 200, wholesale: 180, brand: 'Indomie', barcode: '6001234500011', packs: [{ name: 'pack', units: 6 }, { name: 'carton', units: 72 }] })
    expect(save().error).toMatch(/duplicate key/)
    expect(save({ name: 'Other', barcode: '6001234500011' }).error).toMatch(/duplicate key/)
    expect(save({ name: 'Bad', price: -1 }).error).toMatch(/selling price/)
    expect(save({ name: 'Bad2', barcode: '', packs: [{ name: 'box', units: 0 }] }).error).toMatch(/more than zero/)
    expect(save({ name: 'Bad3', barcode: '', packs: [{ name: 'box', units: 2 }, { name: 'BOX', units: 3 }] }).error).toMatch(/once/)
  })

  it('receives cartons as single units at the unit cost, and a price change does not touch stock cost', () => {
    const r = mart.demoReceiveStock(B, { locationId: loc, reference: 'DN-1', items: [{ productId: noodles().id, quantity: 5, pack: 'carton', unitCost: 10800 }] }, key())
    expect(r.error).toBeNull()
    expect(noodles()).toMatchObject({ onHand: 360, avgCost: 150, stockValue: 54000 })
    expect(mart.demoReceiveStock(B, { locationId: loc, reference: '', items: [{ productId: noodles().id, quantity: 1, pack: 'pallet', unitCost: 1 }] }, key()).error).toMatch(/no pack called/)
    expect(save({ id: noodles().id, price: 220 }).error).toBeNull()
    expect(noodles()).toMatchObject({ price: 220, avgCost: 150 })
  })

  it('sells by the carton, snapshots the unit cost, and total stock drops by the base units', () => {
    const s = mart.demoMartSale(B, loc, null, [{ productId: noodles().id, quantity: 1, pack: 'carton', unitPrice: 15840 }, { productId: noodles().id, quantity: 5 }], [{ method: 'cash', amount: 16940 }], key())
    expect(s.error).toBeNull()
    expect(noodles().onHand).toBe(360 - 77)
    const items = trade.getTrade().saleItems.filter((i) => i.saleId === s.result!.saleId)
    expect(items.reduce((a, i) => a + i.quantity, 0)).toBe(77)
    expect(items.every((i) => i.unitCost === 150)).toBe(true)
    expect(items.reduce((a, i) => a + i.total, 0)).toBe(16940)
  })

  it('requires an expiry date for tracked products and sells the earliest expiry first', () => {
    expect(save({ name: 'Fresh Yoghurt', barcode: '', packs: [], trackExpiry: true, cost: 100, price: 150 }).error).toBeNull()
    const p = row('Fresh Yoghurt').id
    expect(mart.demoReceiveStock(B, { locationId: loc, reference: '', items: [{ productId: p, quantity: 10, unitCost: 100 }] }, key()).error).toMatch(/expiry/)
    expect(mart.demoReceiveStock(B, { locationId: loc, reference: '', items: [{ productId: p, quantity: 10, unitCost: 100, batch: 'B-late', expiry: iso(30) }] }, key()).error).toBeNull()
    expect(mart.demoReceiveStock(B, { locationId: loc, reference: '', items: [{ productId: p, quantity: 10, unitCost: 100, batch: 'B-soon', expiry: iso(5) }] }, key()).error).toBeNull()
    expect(row('Fresh Yoghurt').nextExpiry).toBe(iso(5))
    expect(mart.demoMartSale(B, loc, null, [{ productId: p, quantity: 4 }], [{ method: 'cash', amount: 600 }], key()).error).toBeNull()
    const lots = mart.demoMartLots(B).filter((l) => l.productId === p)
    expect(lots.find((l) => l.batchNumber === 'B-soon')).toMatchObject({ remaining: 6, status: 'expiring' })
    expect(lots.find((l) => l.batchNumber === 'B-late')).toMatchObject({ remaining: 10, status: 'ok' })
  })

  it('needs a manager to approve a stock count, then posts differences as adjustments', () => {
    const p = noodles().id
    const start = mart.demoStartCount(B, loc, category, key())
    expect(start.error).toBeNull()
    const id = start.result!.countId
    expect(mart.demoRecordCount(B, id, p, 280)).toBeNull() // 3 short
    as('officer@demo.test')
    expect(mart.demoPostCount(B, id, key()).error).toMatch(/manager must approve/)
    as('owner@demo.test')
    expect(noodles().onHand).toBe(283)
    expect(mart.demoPostCount(B, id, key()).error).toBeNull()
    expect(noodles().onHand).toBe(280)
    expect(mart.demoPostCount(B, id, key()).error).toMatch(/already posted/)
  })

  it('records losses with an estimated cost, refuses more than is in stock, and restores on void', () => {
    const p = noodles().id
    const r = mart.demoRecordLoss(B, { productId: p, locationId: loc, quantity: 10, reason: 'damaged', notes: 'wet carton' }, key())
    expect(r.error).toBeNull()
    expect(r.result!.estimatedLoss).toBe(1500)
    expect(noodles().onHand).toBe(270)
    expect(mart.demoRecordLoss(B, { productId: p, locationId: loc, quantity: 99999, reason: 'expired', notes: '' }, key()).error).toMatch(/negative|stock/i)
    expect(mart.demoVoidLoss(B, r.result!.lossId, 'entered twice', key())).toBeNull()
    expect(noodles().onHand).toBe(280)
  })

  it('returns goods to a supplier, reducing stock and keeping the credit', () => {
    const p = noodles().id
    const r = mart.demoSupplierReturn(B, { supplierId: supplier, purchaseId: null, locationId: loc, items: [{ productId: p, quantity: 12, unitCost: 150 }], reason: 'Wrong flavour' }, key())
    expect(r.error).toBeNull()
    expect(r.result!.totalCredit).toBe(1800)
    expect(noodles().onHand).toBe(268)
    expect(mart.demoSupplierReturn(B, { supplierId: supplier, purchaseId: null, locationId: loc, items: [{ productId: p, quantity: 1, unitCost: 150 }], reason: '' }, key()).error).toMatch(/reason/)
  })

  it('works out expected cash from the cashier own cash sales and keeps variance for review', () => {
    as('owner@demo.test')
    const open = mart.demoOpenShift(B, 5000, key())
    expect(open.error).toBeNull()
    expect(mart.demoOpenShift(B, 1, key()).error).toMatch(/already have an open shift/)
    const id = open.result!.shiftId
    expect(mart.demoMartSale(B, loc, null, [{ productId: noodles().id, quantity: 1 }], [{ method: 'cash', amount: 220 }], key()).error).toBeNull()
    expect(mart.demoMartSale(B, loc, null, [{ productId: noodles().id, quantity: 1 }], [{ method: 'bank_transfer', amount: 220 }], key()).error).toBeNull()
    expect(mart.demoCashMovement(B, id, 'out', 100, 'Change float', key()).error).toBeNull()
    const s = mart.demoShiftSummaries(B).find((x) => x.id === id)!
    expect(s).toMatchObject({ cashSales: 220, otherMethods: 220, movedOut: 100, expectedCash: 5120 })
    const close = mart.demoCloseShift(B, id, 5070, '', key())
    expect(close.result).toMatchObject({ expectedCash: 5120, variance: -50 })
    expect(mart.demoReviewShift(B, id, '')).toMatch(/explain/)
    expect(mart.demoReviewShift(B, id, 'Short change given')).toBeNull()
  })

  it('reports figures from the records with the documented definitions', () => {
    const o = mart.demoMartOverview(B, iso(-1), iso(0))
    expect(o.transactions).toBeGreaterThanOrEqual(4)
    expect(o.bestSellers[0].product).toBe('Indomie Noodles')
    const f = o.financial!
    expect(f.grossProfit).toBeCloseTo(f.netSales - f.cogs, 2)
    expect(f.operatingProfitEstimate).toBeCloseTo(f.grossProfit - f.operatingExpenses - (f.stockWriteOffs ?? 0) + (f.countDifference ?? 0), 2)
    expect(f.shiftVariance).toBe(-50)
    expect(f.supplierBalances).toBeGreaterThanOrEqual(0)
    expect(f.byCategory.map((c) => c.category)).toContain('Groceries')
  })

  it('hides money figures from roles without financial access', () => {
    as('cashier@demo.test')
    expect(mart.demoMartOverview(B, iso(-1), iso(0)).financial).toBeNull()
    expect(save({ name: 'Not allowed', barcode: '' }).error).toMatch(/permission/)
    as('owner@demo.test')
  })
})

describe('a pack with a price of its own, in the demo as in the database', () => {
  const name = 'Pack price probe'
  const withPrice = (price: number | null) => save({ id: row(name)?.id ?? null, name, barcode: '', packs: [{ name: 'carton', units: 12, price }, { name: 'dozen', units: 12 }], price: 200 })
  it('sells at the pack price, records the saving as a discount, and takes the units off the stock', () => {
    as('owner@demo.test')
    expect(withPrice(2000).error).toBeNull()
    expect(mart.demoReceiveStock(B, { locationId: loc, reference: '', items: [{ productId: row(name).id, quantity: 100, unitCost: 100 }] }, key()).error).toBeNull()
    as('cashier@demo.test')
    const s = mart.demoMartSale(B, loc, null, [{ productId: row(name).id, quantity: 1, pack: 'carton', unitPrice: 2000 }], [{ method: 'cash', amount: 2000 }], key())
    expect(s.error).toBeNull()
    const item = trade.getTrade().saleItems.find((i) => i.saleId === s.result!.saleId)!
    expect(item.discount).toBe(400); expect(row(name).onHand).toBe(88)
    expect(mart.demoMartSale(B, loc, null, [{ productId: row(name).id, quantity: 1, pack: 'dozen', unitPrice: 2400 }], [{ method: 'cash', amount: 2400 }], key()).error).toBeNull()
  })
  it('does not let the till set the pack price, and refuses a pack price above its units one by one', () => {
    expect(mart.demoMartSale(B, loc, null, [{ productId: row(name).id, quantity: 1, pack: 'carton', unitPrice: 1000 }], [{ method: 'cash', amount: 1000 }], key()).error).toMatch(/price of the carton has changed to 2000/)
    as('owner@demo.test')
    expect(withPrice(2500).error).toMatch(/cannot be more than its units sold one by one/)
    expect(withPrice(null).error).toBeNull()
    expect(row(name).packs.find((k) => k.name === 'carton')!.price).toBeNull()
  })
})

describe('shifts, cash given and receipts in the demo, as in the database', () => {
  it('lets cash out be at most what is in the drawer, in words a person understands', () => {
    as('owner@demo.test')
    expect(mart.demoOpenShift(B, 1000, key()).error).toBeNull()
    const shift = mart.demoShiftSummaries(B).find((s) => s.status === 'open' && s.openingCash === 1000)!
    expect(mart.demoCashMovement(B, shift.id, 'out', 1500, 'Bank drop', key()).error).toMatch(/there is only ₦1,000.00 in the drawer, so ₦1,500.00 cannot be taken out/)
    expect(mart.demoCashMovement(B, shift.id, 'out', 400, 'Bank drop', key()).error).toBeNull()
    expect(mart.demoShiftSummaries(B).find((s) => s.id === shift.id)!.expectedCash).toBe(600)
    expect(mart.demoCloseShift(B, shift.id, 600, '', key()).error).toBeNull()
  })
  it('deletes a shift where nothing happened, with a reason, and keeps one that has cash activity', () => {
    as('owner@demo.test')
    expect(mart.demoOpenShift(B, 250, key()).error).toBeNull()
    const idle = mart.demoShiftSummaries(B).find((s) => s.status === 'open' && s.openingCash === 250)!
    expect(mart.demoDeleteShift(B, idle.id, 'x')).toMatch(/reason is required/)
    expect(mart.demoDeleteShift(B, idle.id, 'Opened by mistake')).toBeNull()
    expect(mart.demoShiftSummaries(B).some((s) => s.id === idle.id)).toBe(false)
    expect(mart.demoOpenShift(B, 300, key()).error).toBeNull()
    const busy = mart.demoShiftSummaries(B).find((s) => s.status === 'open' && s.openingCash === 300)!
    expect(mart.demoCashMovement(B, busy.id, 'in', 50, 'Float', key()).error).toBeNull()
    expect(mart.demoDeleteShift(B, busy.id, 'Opened by mistake')).toMatch(/money record/)
    expect(mart.demoCloseShift(B, busy.id, 350, '', key()).error).toBeNull()
    expect(mart.demoDeleteShift(B, busy.id, 'Opened by mistake')).toMatch(/closed shift carries the cash count/)
  })
  it('keeps the cash given for a sale, works out the change, and refuses too little, a second record and a card sale', () => {
    as('owner@demo.test')
    const p = row('Pack price probe').id
    const sale = (method: string, amount: number) => mart.demoMartSale(B, loc, null, [{ productId: p, quantity: 1 }], [{ method, amount }], key()).result!.saleId
    const s1 = sale('cash', 200)
    expect(trade.demoRecordTender(B, s1, 150)).toMatch(/less than the cash paid/)
    expect(trade.demoRecordTender(B, s1, 500)).toBeNull()
    expect(trade.getTrade().sales.find((s) => s.id === s1)).toMatchObject({ tendered: 500, change: 300 })
    expect(trade.demoRecordTender(B, s1, 600)).toMatch(/already recorded/)
    expect(trade.demoRecordTender(B, sale('card', 200), 500)).toMatch(/not paid in cash/)
  })
})
