import { beforeAll, describe, expect, it } from 'vitest'
import { getInv } from '@/demo/demoInventory'
import * as ph from '@/demo/demoPharmacy'
import { demoInvite, demoSignIn, demoSignOut, demoSignUp } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'

const B = 'b-pharmacy'
let n = 0
const key = () => `dph-${n++}-abcdefgh`
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let loc: string
const med = (name: string) => ph.demoMedicines(B).find((m) => m.name.startsWith(name))!
const lot = (name: string, batch: string) => ph.demoBatches(B).find((b) => b.productName.startsWith(name) && b.batchNumber === batch)!
const sell = (name: string, quantity: number, amount: number) => trade.demoPostSale(B, loc, null, [{ productId: med(name).id, quantity }], [{ method: 'cash', amount }], key())
const rxInput = (over: Partial<ph.RxInput> = {}): ph.RxInput => ({ id: null, customerId: null, patient: 'Ada Obi', prescriber: 'Dr Okoye', licence: 'MDCN-1', prescribedOn: iso(0), validUntil: iso(30), refills: 0, notes: '', submit: true, items: [{ productId: med('Amoxicillin').id, quantity: 21, directions: 'one three times a day' }], ...over })

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  ph.demoMedicines(B) // seeds the demo pharmacy
  expect(demoInvite(B, 'tech@demo.test', 'pharmacy_technician')).toBeNull()
  expect(demoSignUp('Demo Technician', 'tech@demo.test', 'demo1234')).toBeNull() // accepts the invitation
  as('owner@demo.test')
  loc = getInv().locations.find((l) => l.businessId === B)!.id
})

describe('demo pharmacy follows the database rules', () => {
  it('seeds clearly demo medicines with batches, one expired and one quarantined', () => {
    expect(ph.demoMedicines(B).map((m) => m.name)).toEqual(expect.arrayContaining(['Paracetamol 500mg Tablets', 'Amoxicillin 500mg Capsules', 'Diazepam 5mg Tablets']))
    expect(med('Amoxicillin')).toMatchObject({ classification: 'prescription_only', saleable: 420, expired: 60 })
    expect(med('Elastic')).toMatchObject({ saleable: 24, quarantined: 6 })
    expect(med('Paracetamol').packs.map((p) => p.units)).toEqual([10, 100])
  })

  it('sells earliest-expiry first and spans batches', () => {
    as('cashier@demo.test')
    expect(sell('Paracetamol', 310, 6200).error).toBeNull()
    expect(lot('Paracetamol', 'PCM-2301')).toBeUndefined() // fully sold, so no longer listed
    expect(lot('Paracetamol', 'PCM-2410').remaining).toBe(890)
  })

  it('refuses restricted medicines on an ordinary sale and fractional units', () => {
    expect(sell('Amoxicillin', 1, 150).error).toMatch(/restricted medicine/)
    expect(sell('Diazepam', 1, 120).error).toMatch(/restricted medicine/)
    expect(sell('Paracetamol', 1.5, 30).error).toMatch(/whole units/)
  })

  it('never sells expired, quarantined or undated stock', () => {
    const before = med('Elastic').onHand
    expect(sell('Elastic', 25, 22500).error).toMatch(/expired, quarantined or undated/)
    expect(med('Elastic').onHand).toBe(before)
    expect(sell('Elastic', 24, 21600).error).toBeNull()
    expect(med('Elastic')).toMatchObject({ saleable: 0, quarantined: 6 })
  })

  it('releases quarantined stock only with a reason, and only with a valid expiry', () => {
    as('pharmacist@demo.test')
    const q = ph.demoBatches(B).find((b) => b.status === 'quarantined')!
    expect(ph.demoSetBatchStatus(B, q.id, 'active', '')).toMatch(/reason/)
    expect(ph.demoSetBatchStatus(B, q.id, 'active', 'Inspected', 'BND-0', iso(-3))).toMatch(/cannot be released/)
    expect(ph.demoSetBatchStatus(B, q.id, 'active', 'Inspected: undamaged', 'BND-0', iso(300))).toBeNull()
    expect(med('Elastic').saleable).toBe(6)
    expect(ph.demoSetBatchStatus(B, q.id, 'quarantined', 'Supplier recall')).toBeNull()
    expect(med('Elastic').saleable).toBe(0)
    expect(ph.demoBatchEvents(B, q.id).map((e) => e.event)).toEqual(['released', 'quarantined'])
    as('cashier@demo.test')
    expect(ph.demoSetBatchStatus(B, q.id, 'active', 'cashier tries', 'x', iso(10))).toMatch(/permission denied/)
  })

  it('lets only a pharmacist review and dispense, in order, and records each step', () => {
    as('tech@demo.test')
    const made = ph.demoSavePrescription(B, rxInput(), key())
    expect(made.error).toBeNull()
    const id = made.result!.prescriptionId
    expect(ph.demoReviewPrescription(B, id, 'approve', '')).toMatch(/permission denied/)
    as('cashier@demo.test')
    expect(ph.demoSavePrescription(B, rxInput(), key()).error).toMatch(/permission denied/)
    expect(ph.demoPrescriptions(B)).toEqual([])
    as('pharmacist@demo.test')
    const item = ph.demoPrescriptions(B).find((r) => r.id === id)!.items[0]
    expect(ph.demoDispense(B, id, loc, [{ itemId: item.id, quantity: 7 }], [], key()).error).toMatch(/awaiting review/)
    expect(ph.demoReviewPrescription(B, id, 'reject', '')).toMatch(/why/)
    expect(ph.demoReviewPrescription(B, id, 'approve', 'Reviewed')).toBeNull()
    const k = key()
    const first = ph.demoDispense(B, id, loc, [{ itemId: item.id, quantity: 7 }], [{ method: 'cash', amount: 1050 }], k)
    expect(first.error).toBeNull()
    expect(ph.demoDispense(B, id, loc, [{ itemId: item.id, quantity: 7 }], [{ method: 'cash', amount: 1050 }], k).result).toEqual(first.result) // repeated key: one sale
    expect(med('Amoxicillin').onHand).toBe(480 - 7 - 60 + 60) // 420 valid + 60 expired on hand, less 7 dispensed
    expect(ph.demoPrescriptions(B).find((r) => r.id === id)!.status).toBe('partially_dispensed')
    expect(ph.demoDispense(B, id, loc, [{ itemId: item.id, quantity: 15 }], [], key()).error).toMatch(/remain to be dispensed/)
    expect(ph.demoDispense(B, id, loc, [{ itemId: item.id, quantity: 14 }], [{ method: 'cash', amount: 2100 }], key()).error).toBeNull()
    expect(ph.demoPrescriptions(B).find((r) => r.id === id)!.status).toBe('dispensed')
    expect(ph.demoDispensings(B, id)).toHaveLength(2)
    expect(trade.getTrade().sales.filter((s) => s.businessId === B && s.id === first.result!.saleId)).toHaveLength(1)
  })

  it('handles rejected, cancelled and expired prescriptions', () => {
    as('tech@demo.test')
    const a = ph.demoSavePrescription(B, rxInput(), key()).result!.prescriptionId
    const b = ph.demoSavePrescription(B, rxInput({ submit: false }), key()).result!.prescriptionId
    expect(ph.demoSavePrescription(B, rxInput({ validUntil: iso(-1) }), key()).error).toMatch(/valid from its date/)
    expect(ph.demoCancelPrescription(B, b, 'Collected elsewhere')).toBeNull()
    as('pharmacist@demo.test')
    expect(ph.demoReviewPrescription(B, a, 'reject', 'Illegible details')).toBeNull()
    expect(ph.demoReviewPrescription(B, a, 'approve', '')).toMatch(/awaiting review/)
  })

  it('receives only the accepted quantity, requires batch and expiry, and refuses expired goods', () => {
    as('pharmacist@demo.test')
    const p = med('Paracetamol').id
    const base = { productId: p, pack: 'pack', received: 2, unitCost: 900, batch: 'PCM-NEW' }
    expect(ph.demoReceiveGoods(B, { locationId: loc, purchaseId: null, supplierId: null, invoice: 'INV-9', items: [{ ...base, expiry: '' }] }, key()).error).toMatch(/expiry/)
    expect(ph.demoReceiveGoods(B, { locationId: loc, purchaseId: null, supplierId: null, invoice: '', items: [{ ...base, expiry: iso(-4) }] }, key()).error).toMatch(/in the past/)
    expect(ph.demoReceiveGoods(B, { locationId: loc, purchaseId: null, supplierId: null, invoice: '', items: [{ ...base, rejected: 0.5, expiry: iso(300) }] }, key()).error).toMatch(/why/)
    const before = med('Paracetamol').onHand
    expect(ph.demoReceiveGoods(B, { locationId: loc, purchaseId: null, supplierId: null, invoice: 'INV-9', items: [{ ...base, rejected: 0.5, reason: 'crushed cartons', expiry: iso(300) }] }, key()).error).toBeNull()
    expect(med('Paracetamol').onHand).toBe(before + 150) // 2 packs x 100 received, 50 rejected
    expect(lot('Paracetamol', 'PCM-NEW').remaining).toBe(150)
    expect(ph.demoReceipts(B)[0].items[0]).toMatchObject({ received: 200, accepted: 150, rejected: 50 })
  })

  it('writes off a named batch (expired stock) with a recorded loss; only managers may', () => {
    as('pharmacist@demo.test')
    const expired = lot('Amoxicillin', 'AMX-61')
    expect(ph.demoDisposeBatch(B, expired.id, 60, 'expired', '', key()).error).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(ph.demoDisposeBatch(B, expired.id, 999, 'expired', '', key()).error).toMatch(/between 0 and/)
    const k = key()
    const r = ph.demoDisposeBatch(B, expired.id, 60, 'expired', 'Batch expired', k)
    expect(r.error).toBeNull()
    expect(r.result!.estimatedLoss).toBe(5400)
    expect(ph.demoDisposeBatch(B, expired.id, 60, 'expired', 'Batch expired', k).result).toEqual(r.result)
    expect(ph.demoBatches(B).find((b) => b.id === expired.id)).toBeUndefined()
    expect(med('Amoxicillin').expired).toBe(0)
  })

  it('reports expiry exposure and hides money and prescriptions from roles without access', () => {
    as('owner@demo.test')
    const o = ph.demoPharmacyOverview(B, iso(-1), iso(0))
    expect(o.expiringCritical).toBeGreaterThanOrEqual(0)
    expect(o.rxAwaitingReview).not.toBeNull()
    expect(o.expiredValue).not.toBeNull()
    as('cashier@demo.test')
    const c = ph.demoPharmacyOverview(B, iso(-1), iso(0))
    expect(c.financial).toBeNull()
    expect(c.expiredValue).toBeNull()
    expect(c.rxAwaitingReview).toBeNull()
  })

  it('validates settings and medicine input', () => {
    as('owner@demo.test')
    expect(ph.demoSaveSettings(B, { ...ph.demoSettings(B), warning: 30, alert: 90, critical: 180 })).toMatch(/shortest/)
    expect(ph.demoSaveSettings(B, { ...ph.demoSettings(B), warning: 120, alert: 60, critical: 14 })).toBeNull()
    const base: ph.MedicineInput = { id: null, name: 'Ibuprofen 400mg', sku: '', barcode: '', categoryId: null, unit: 'each', cost: 10, price: 25, reorder: 20, supplierId: null, active: true, packs: [{ name: 'strip', units: 10 }], genericName: 'Ibuprofen', brand: '', activeIngredient: '', strength: '400mg', dosageForm: 'tablet', manufacturer: '', registrationNo: '', classification: 'otc', storage: '', maxStock: null }
    const k = key()
    expect(ph.demoSaveMedicine(B, base, k).error).toBeNull()
    expect(ph.demoSaveMedicine(B, base, k).result).toBeDefined()
    expect(ph.demoMedicines(B).filter((m) => m.name === 'Ibuprofen 400mg')).toHaveLength(1)
    expect(ph.demoSaveMedicine(B, base, key()).error).toMatch(/duplicate key/)
    expect(ph.demoSaveMedicine(B, { ...base, name: 'Other', classification: 'miracle' as never }, key()).error).toMatch(/classification/)
    as('pharmacist@demo.test')
    expect(ph.demoSaveMedicine(B, { ...base, name: 'Not allowed' }, key()).error).toMatch(/permission denied/)
  })
})
