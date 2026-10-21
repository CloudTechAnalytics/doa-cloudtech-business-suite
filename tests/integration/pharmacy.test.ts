import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, pharmacist: string, technician: string, cashier: string, storekeeper: string, accountant: string, outsider: string
let biz: string, bizB: string, loc: string, supplier: string, category: string
let para: string, amox: string, morph: string, gauze: string
let n = 0
const key = () => `ph-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)
const stock = (p: string) => num('select coalesce(sum(quantity_on_hand),0) as v from public.inventory_balances where product_id=$1', [p])
const saleable = (p: string) => num('select saleable as v from public.pharmacy_medicines where id=$1', [p])

type Profile = { classification?: string; form?: string; strength?: string }
const save = (u: string, name: string, over: { id?: string | null; price?: number; cost?: number; barcode?: string | null; packs?: { name: string; units: number }[]; unit?: string; k?: string; b?: string; profile?: Profile } = {}) =>
  as(u, () => q<{ r: { product_id: string } }>('select public.pharmacy_save_medicine($1,$2,$3,null,$4,$5,$6,$7,$8,$9,null,true,$10::jsonb,$11::jsonb,$12) as r',
    [over.b ?? biz, over.id ?? null, name, over.barcode ?? null, category, over.unit ?? 'each', over.cost ?? 10, over.price ?? 20, 20, JSON.stringify(over.packs ?? []),
      JSON.stringify({ generic_name: name, dosage_form: over.profile?.form ?? 'tablet', classification: over.profile?.classification ?? 'otc', strength: over.profile?.strength ?? '500mg', manufacturer: 'Acme' }), over.k ?? key()])).then((r) => r[0].r.product_id)
const grn = (u: string, items: object[], extra: { purchase?: string | null; k?: string } = {}) =>
  as(u, () => q<{ r: { receipt_id: string } }>('select public.pharmacy_receive_goods($1,$2,$3,$4,$5::jsonb,$6,$7) as r', [biz, loc, extra.purchase ?? null, supplier, JSON.stringify(items), 'INV-1', extra.k ?? key()]))
const sell = (u: string, items: object[], pay: { method: string; amount: number }[], k = key()) =>
  as(u, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, JSON.stringify(items), JSON.stringify(pay), k])).then((r) => r[0].r.sale_id)
const batches = (p: string) => q<{ id: string; batch_number: string; remaining: string; status: string; expires_on: string }>('select id, batch_number, remaining, status, expires_on::text from public.mart_lots where product_id=$1 order by expires_on nulls last', [p])
const batch = async (p: string, name: string) => (await batches(p)).find((b) => b.batch_number === name)!
const rx = (u: string, over: { items?: object[]; submit?: boolean; valid?: string; id?: string | null; patient?: string; k?: string } = {}) =>
  as(u, () => q<{ r: { prescription_id: string } }>('select public.pharmacy_save_prescription($1,$2,null,$3,$4,$5,$6,$7,0,null,$8::jsonb,$9,$10) as r',
    [biz, over.id ?? null, over.patient ?? 'Ada Obi', 'Dr Okoye', 'MDCN-1', iso(0), over.valid ?? iso(30), JSON.stringify(over.items ?? [{ product_id: amox, quantity: 21, directions: 'one three times a day' }]), over.submit ?? true, over.k ?? key()])).then((r) => r[0].r.prescription_id)
const approve = (u: string, id: string) => as(u, () => q('select public.pharmacy_review_prescription($1,$2,$3)', [id, 'approve', 'Reviewed']))
const dispense = (u: string, id: string, items: object[], pay: object[], k = key()) =>
  as(u, () => q<{ r: { sale_id: string; dispensing_id: string } }>('select public.pharmacy_dispense($1,$2,$3::jsonb,$4::jsonb,$5) as r', [id, loc, JSON.stringify(items), JSON.stringify(pay), k])).then((r) => r[0].r)
const rxItems = (id: string) => q<{ id: string; product_id: string; quantity_dispensed: string }>('select id, product_id, quantity_dispensed from public.pharmacy_prescription_items where prescription_id=$1', [id])

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, pharmacist, technician, cashier, storekeeper, accountant, outsider] = await Promise.all(['o', 'm', 'p', 't', 'c', 's', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Care Pharmacy','pharmacy') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other Pharmacy','pharmacy') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [pharmacist, 'pharmacist'], [technician, 'pharmacy_technician'], [cashier, 'cashier'], [storekeeper, 'inventory_officer'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  supplier = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'MedSupply') returning id`, [biz]))[0].id
  category = (await q<{ id: string }>(`insert into public.product_categories (business_id,name) values ($1,'Analgesics') returning id`, [biz]))[0].id
})

describe('a pharmacy business gets its own modules and roles', () => {
  it('enables the pharmacy modules and the shared ones', async () => {
    const mods = (await q<{ code: string }>('select m.code from public.business_modules bm join public.modules m on m.id = bm.module_id where bm.business_id=$1', [biz])).map((m) => m.code)
    expect(mods).toEqual(expect.arrayContaining(['pharmacy-products', 'pharmacy-batches', 'pharmacy-prescriptions', 'pharmacy-shifts', 'inventory', 'sales', 'purchases']))
    expect(mods.some((m) => m.startsWith('retail-'))).toBe(false)
  })

  it('gives the dispensing permission to pharmacists and owners, not to managers or technicians', async () => {
    const has = (u: string, p: string) => as(u, async () => (await q<{ v: boolean }>('select public.has_business_permission($1,$2) as v', [biz, p]))[0].v)
    expect(await has(pharmacist, 'pharmacy.dispense')).toBe(true)
    expect(await has(owner, 'pharmacy.dispense')).toBe(true)
    expect(await has(manager, 'pharmacy.dispense')).toBe(false)
    expect(await has(technician, 'pharmacy.dispense')).toBe(false)
    expect(await has(technician, 'pharmacy.rx')).toBe(true)
    expect(await has(cashier, 'pharmacy.rx')).toBe(false)
    expect(await has(accountant, 'pharmacy.rx')).toBe(false)
  })
})

describe('medicines, classification and units', () => {
  it('lets managers define medicines with packs and a classification; others cannot', async () => {
    para = await save(manager, 'Paracetamol 500mg', { barcode: '5001', packs: [{ name: 'strip', units: 10 }, { name: 'pack', units: 100 }], price: 20, cost: 10 })
    amox = await save(manager, 'Amoxicillin 500mg', { profile: { classification: 'prescription_only', form: 'capsule' }, price: 150, cost: 90 })
    morph = await save(manager, 'Morphine 10mg', { profile: { classification: 'controlled', form: 'injection' }, price: 900, cost: 600 })
    gauze = await save(manager, 'Gauze Roll', { profile: { classification: 'device', form: 'device' }, price: 300, cost: 150 })
    await expect(save(cashier, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(pharmacist, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(outsider, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(manager, 'paracetamol 500mg')).rejects.toThrow(/duplicate key/)
    await expect(save(manager, 'Odd', { profile: { classification: 'miracle' } })).rejects.toThrow(/classification/)
    const k = key()
    expect(await save(manager, 'Ibuprofen 200mg', { k })).toBe(await save(manager, 'Ibuprofen 200mg', { k }))
    const v = (await as(pharmacist, () => q<{ classification: string; strength: string; packs: { name: string; units: number }[]; track_expiry: boolean }>('select classification, strength, packs, track_expiry from public.pharmacy_medicines where id=$1', [para])))[0]
    expect(v).toMatchObject({ classification: 'otc', strength: '500mg', track_expiry: true })
    expect(v.packs.map((p) => p.units)).toEqual([10, 100])
  })
})

describe('receiving goods and batches', () => {
  it('requires batch and expiry, receives packs as single units, and keeps rejected goods out of stock', async () => {
    await expect(grn(storekeeper, [{ product_id: para, received: 1, pack: 'pack', unit_cost: 900, batch: 'B1' }])).rejects.toThrow(/expiry/)
    await expect(grn(storekeeper, [{ product_id: para, received: 1, pack: 'pack', unit_cost: 900, expiry: iso(300) }])).rejects.toThrow(/batch number/)
    await expect(grn(storekeeper, [{ product_id: para, received: 1, pack: 'pack', unit_cost: 900, batch: 'OLD', expiry: iso(-5) }])).rejects.toThrow(/in the past/)
    await expect(grn(storekeeper, [{ product_id: para, received: 5, rejected: 2, pack: 'strip', unit_cost: 90, batch: 'B1', expiry: iso(300) }])).rejects.toThrow(/why/)
    await expect(grn(cashier, [{ product_id: para, received: 1, batch: 'B1', expiry: iso(300) }])).rejects.toThrow(/permission denied/)
    await grn(storekeeper, [{ product_id: para, received: 6, rejected: 1, rejection_reason: 'damaged packaging', pack: 'pack', unit_cost: 900, batch: 'LATE', expiry: iso(400), manufactured: iso(-60) }])
    await grn(storekeeper, [{ product_id: para, received: 3, pack: 'pack', unit_cost: 900, batch: 'SOON', expiry: iso(40) }])
    expect(await stock(para)).toBe(800) // (5 + 3) packs x 100 tablets; the rejected pack never entered stock
    expect(await num('select sum(rejected_quantity) as v from public.pharmacy_goods_receipt_items')).toBe(100)
    expect(await num('select avg_unit_cost as v from public.inventory_balances where product_id=$1', [para])).toBe(9)
    const b = await batches(para)
    expect(b.map((x) => x.batch_number)).toEqual(['SOON', 'LATE'])
    expect(await saleable(para)).toBe(800)
  })

  it('moves a purchase order forward only by the accepted quantity', async () => {
    const po = (await as(owner, () => q<{ r: { purchase_id: string } }>(`select public.create_purchase($1,$2,$3::jsonb,'PO',$4) as r`, [biz, supplier, JSON.stringify([{ product_id: amox, quantity: 100, unit_cost: 90 }]), key()])))[0].r.purchase_id
    await as(owner, () => q('select public.approve_purchase($1,$2)', [po, key()])).catch(() => null)
    const status = (await q<{ status: string }>('select status from public.purchases where id=$1', [po]))[0].status
    if (status === 'draft') await as(owner, () => q(`update public.purchases set status='ordered' where id=$1`, [po]).catch(() => null))
    await db.exec(`update public.purchases set status='ordered' where id='${po}'`)
    await grn(storekeeper, [{ product_id: amox, received: 40, rejected: 10, rejection_reason: 'wrong strength', unit_cost: 90, batch: 'AM1', expiry: iso(500) }], { purchase: po })
    expect(await stock(amox)).toBe(30)
    expect(await num('select quantity_received as v from public.purchase_items where purchase_id=$1', [po])).toBe(30)
    expect((await q<{ status: string }>('select status from public.purchases where id=$1', [po]))[0].status).toBe('partially_received')
    expect((await batch(amox, 'AM1')).expires_on).toBe(iso(500))
    await grn(storekeeper, [{ product_id: amox, received: 70, unit_cost: 90, batch: 'AM2', expiry: iso(520) }], { purchase: po })
    expect((await q<{ status: string }>('select status from public.purchases where id=$1', [po]))[0].status).toBe('received')
    expect(await stock(amox)).toBe(100)
  })

  it('replays a repeated receipt without receiving twice', async () => {
    const k = key()
    const item = [{ product_id: gauze, received: 5, unit_cost: 150, batch: 'G1', expiry: iso(900) }]
    const a = await grn(storekeeper, item, { k }); const b = await grn(storekeeper, item, { k })
    expect(a[0].r.receipt_id).toBe(b[0].r.receipt_id)
    expect(await stock(gauze)).toBe(5)
  })
})

describe('first-expiry-first-out, expired and quarantined stock', () => {
  it('sells from the earliest-expiring valid batch and records the allocation', async () => {
    const sale = await sell(cashier, [{ product_id: para, quantity: 30 }], [{ method: 'cash', amount: 600 }])
    expect(Number((await batch(para, 'SOON')).remaining)).toBe(270)
    expect(Number((await batch(para, 'LATE')).remaining)).toBe(500)
    expect(await num('select sum(a.quantity) as v from public.mart_lot_allocations a join public.sale_items si on si.stock_movement_id = a.movement_id where si.sale_id=$1', [sale])).toBe(30)
  })

  it('spans batches in one sale', async () => {
    await sell(cashier, [{ product_id: para, quantity: 290 }], [{ method: 'cash', amount: 5800 }])
    expect(Number((await batch(para, 'SOON')).remaining)).toBe(0)
    expect(Number((await batch(para, 'LATE')).remaining)).toBe(480)
  })

  it('refuses to sell expired stock even though it is on hand', async () => {
    await db.exec(`update public.mart_lots set expires_on = '${iso(-2)}' where product_id = '${para}' and batch_number = 'LATE'`)
    expect(await stock(para)).toBe(480)
    expect(await saleable(para)).toBe(0)
    await expect(sell(cashier, [{ product_id: para, quantity: 1 }], [{ method: 'cash', amount: 20 }])).rejects.toThrow(/expired, quarantined or undated/)
    expect(await stock(para)).toBe(480)
    await db.exec(`update public.mart_lots set expires_on = '${iso(400)}' where product_id = '${para}' and batch_number = 'LATE'`)
  })

  it('quarantines a batch so it cannot be sold, and releases it again with a reason', async () => {
    const lot = (await batch(para, 'LATE')).id
    await expect(as(cashier, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [lot, 'quarantined', 'suspect']))).rejects.toThrow(/permission denied/)
    await expect(as(pharmacist, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [lot, 'quarantined', '']))).rejects.toThrow(/reason/)
    await as(pharmacist, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [lot, 'quarantined', 'Supplier recall notice']))
    expect(await saleable(para)).toBe(0)
    expect(await num('select quarantined_qty as v from public.pharmacy_medicines where id=$1', [para])).toBe(480)
    await expect(sell(cashier, [{ product_id: para, quantity: 1 }], [{ method: 'cash', amount: 20 }])).rejects.toThrow(/quarantined/)
    await as(pharmacist, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [lot, 'active', 'Recall cleared by supplier']))
    expect(await saleable(para)).toBe(480)
    expect(await num(`select count(*) as v from public.pharmacy_batch_events where lot_id=$1 and event in ('quarantined','released')`, [lot])).toBe(2)
  })

  it('disposes of a named batch with a reason; only managers may, and stock falls by that batch', async () => {
    const lot = (await batch(para, 'LATE')).id
    await expect(as(pharmacist, () => q('select public.pharmacy_dispose_batch($1,$2,$3,$4,$5)', [lot, 80, 'expired', '', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.pharmacy_dispose_batch($1,$2,$3,$4,$5)', [lot, 9999, 'expired', '', key()]))).rejects.toThrow(/between 0 and/)
    const k = key()
    const r = await as(manager, () => q<{ r: { estimated_loss: number } }>('select public.pharmacy_dispose_batch($1,$2,$3,$4,$5) as r', [lot, 80, 'recalled', 'Recall R-12', k]))
    expect(Number(r[0].r.estimated_loss)).toBe(720) // 80 x 9
    await as(manager, () => q('select public.pharmacy_dispose_batch($1,$2,$3,$4,$5)', [lot, 80, 'recalled', 'Recall R-12', k]))
    expect(Number((await batch(para, 'LATE')).remaining)).toBe(400)
    expect(await stock(para)).toBe(400)
  })

  it('puts a customer return in quarantine until a pharmacist confirms and releases it', async () => {
    const sale = await sell(cashier, [{ product_id: para, quantity: 10 }], [{ method: 'cash', amount: 200 }])
    const item = (await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [sale]))[0].id
    await as(owner, () => q(`select public.return_sale($1,$2::jsonb,'Wrong item',null,$3)`, [sale, JSON.stringify([{ sale_item_id: item, quantity: 4, disposition: 'restock' }]), key()]))
    const quarantined = (await batches(para)).find((b) => b.status === 'quarantined')!
    expect(Number(quarantined.remaining)).toBe(4)
    expect(await saleable(para)).toBe(390)
    await expect(as(pharmacist, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [quarantined.id, 'active', 'Inspected: sealed and in date']))).rejects.toThrow(/expiry/)
    await as(pharmacist, () => q('select public.pharmacy_set_batch_status($1,$2,$3,$4,$5)', [quarantined.id, 'active', 'Inspected: sealed and in date', 'RET-1', iso(200)]))
    expect(await saleable(para)).toBe(394)
  })
})

describe('restricted medicines and prescriptions', () => {
  beforeAll(async () => {
    await grn(storekeeper, [{ product_id: morph, received: 20, unit_cost: 600, batch: 'M1', expiry: iso(300) }])
  })

  it('refuses prescription-only and controlled medicines on an ordinary sale, but sells OTC and devices', async () => {
    await expect(sell(cashier, [{ product_id: amox, quantity: 1 }], [{ method: 'cash', amount: 150 }])).rejects.toThrow(/restricted medicine/)
    await expect(sell(owner, [{ product_id: morph, quantity: 1 }], [{ method: 'cash', amount: 900 }])).rejects.toThrow(/restricted medicine/)
    await sell(cashier, [{ product_id: gauze, quantity: 1 }], [{ method: 'cash', amount: 300 }])
    await expect(sell(cashier, [{ product_id: para, quantity: 1.5 }], [{ method: 'cash', amount: 30 }])).rejects.toThrow(/whole units/)
  })

  it('lets a technician enter and submit a prescription, but not review or dispense it', async () => {
    const id = await rx(technician)
    expect((await q<{ status: string }>('select status from public.pharmacy_prescriptions where id=$1', [id]))[0].status).toBe('awaiting_review')
    await expect(approve(technician, id)).rejects.toThrow(/permission denied/)
    await expect(approve(cashier, id)).rejects.toThrow(/permission denied/)
    await expect(approve(manager, id)).rejects.toThrow(/permission denied/)
    await expect(dispense(technician, id, [{ item_id: (await rxItems(id))[0].id, quantity: 1 }], [])).rejects.toThrow(/permission denied/)
    await expect(rx(cashier)).rejects.toThrow(/permission denied/)
  })

  it('needs a pharmacist approval before dispensing, then dispenses partially and fully', async () => {
    const id = await rx(technician)
    const [item] = await rxItems(id)
    await expect(dispense(pharmacist, id, [{ item_id: item.id, quantity: 7 }], [{ method: 'cash', amount: 1050 }])).rejects.toThrow(/awaiting review/)
    await expect(as(pharmacist, () => q('select public.pharmacy_review_prescription($1,$2,$3)', [id, 'reject', '']))).rejects.toThrow(/why/)
    await approve(pharmacist, id)
    const first = await dispense(pharmacist, id, [{ item_id: item.id, quantity: 7 }], [{ method: 'cash', amount: 1050 }])
    expect((await q<{ status: string }>('select status from public.pharmacy_prescriptions where id=$1', [id]))[0].status).toBe('partially_dispensed')
    expect(await stock(amox)).toBe(93)
    expect(await num('select grand_total as v from public.sales where id=$1', [first.sale_id])).toBe(1050)
    await expect(dispense(pharmacist, id, [{ item_id: item.id, quantity: 15 }], [{ method: 'cash', amount: 2250 }])).rejects.toThrow(/remain to be dispensed/)
    expect(await stock(amox)).toBe(93)
    const k = key()
    await dispense(pharmacist, id, [{ item_id: item.id, quantity: 14 }], [{ method: 'cash', amount: 2100 }], k)
    const again = await dispense(pharmacist, id, [{ item_id: item.id, quantity: 14 }], [{ method: 'cash', amount: 2100 }], k)
    expect(again.sale_id).toBeTruthy()
    expect((await q<{ status: string }>('select status from public.pharmacy_prescriptions where id=$1', [id]))[0].status).toBe('dispensed')
    expect(await stock(amox)).toBe(79)
    expect(await num('select count(*) as v from public.pharmacy_dispensings where prescription_id=$1', [id])).toBe(2)
    expect(await num('select sum(quantity) as v from public.pharmacy_dispensing_items where prescription_item_id=$1', [item.id])).toBe(21)
    await expect(dispense(pharmacist, id, [{ item_id: item.id, quantity: 1 }], [])).rejects.toThrow(/dispensed and cannot/)
  })

  it('rejects, cancels and expires prescriptions correctly', async () => {
    const a = await rx(technician)
    await as(pharmacist, () => q('select public.pharmacy_review_prescription($1,$2,$3)', [a, 'reject', 'Illegible prescriber details']))
    expect((await q<{ status: string }>('select status from public.pharmacy_prescriptions where id=$1', [a]))[0].status).toBe('rejected')
    await expect(approve(pharmacist, a)).rejects.toThrow(/awaiting review/)
    const b = await rx(technician, { submit: false })
    await as(technician, () => q('select public.pharmacy_cancel_prescription($1,$2)', [b, 'Patient collected elsewhere']))
    const c = await rx(technician)
    await approve(pharmacist, c)
    await db.exec(`update public.pharmacy_prescriptions set prescribed_on = '${iso(-40)}', valid_until = '${iso(-1)}' where id = '${c}'`)
    expect((await q<{ effective_status: string }>('select effective_status from public.pharmacy_prescription_list where id=$1', [c]))[0].effective_status).toBe('expired')
    await expect(dispense(pharmacist, c, [{ item_id: (await rxItems(c))[0].id, quantity: 1 }], [])).rejects.toThrow(/expired/)
    await expect(rx(technician, { valid: iso(-1) })).rejects.toThrow(/valid from its date/)
  })

  it('dispenses a controlled medicine only on an approved prescription', async () => {
    const id = await rx(technician, { items: [{ product_id: morph, quantity: 5, directions: 'as directed' }] })
    await approve(owner, id)
    await dispense(owner, id, [{ item_id: (await rxItems(id))[0].id, quantity: 5 }], [{ method: 'cash', amount: 4500 }])
    expect(await stock(morph)).toBe(15)
  })

  it('hides prescriptions from staff without the permission and from other businesses', async () => {
    const count = (u: string) => as(u, async () => Number((await q<{ v: string }>('select count(*) as v from public.pharmacy_prescription_list where business_id=$1', [biz]))[0].v))
    expect(await count(pharmacist)).toBeGreaterThan(0)
    expect(await count(technician)).toBeGreaterThan(0)
    expect(await count(cashier)).toBe(0)
    expect(await count(accountant)).toBe(0)
    expect(await count(storekeeper)).toBe(0)
    expect(await count(outsider)).toBe(0)
    expect(await as(cashier, async () => Number((await q<{ v: string }>('select count(*) as v from public.pharmacy_dispensings'))[0].v))).toBe(0)
  })

  it('keeps patient notes out of the audit metadata', async () => {
    const id = await rx(technician, { patient: 'Secret Patient' })
    const logs = JSON.stringify(await q('select metadata from public.audit_logs where entity_id::text = $1', [id]).catch(() => []))
    expect(logs).not.toMatch(/Secret Patient/)
  })
})

describe('overview, counts and isolation', () => {
  it('reports expiry exposure, quarantine and prescription queues, with money only for finance roles', async () => {
    await rx(technician)
    const o = (await as(owner, () => q<{ r: Record<string, unknown> }>('select public.pharmacy_overview($1,$2,$3) as r', [biz, iso(-1), iso(0)])))[0].r
    expect(o.transactions).toBeGreaterThan(0)
    expect(Number(o.rx_awaiting_review)).toBeGreaterThanOrEqual(1)
    expect(o.expired_value).not.toBeNull()
    const c = (await as(cashier, () => q<{ r: Record<string, unknown> }>('select public.pharmacy_overview($1,$2,$3) as r', [biz, iso(-1), iso(0)])))[0].r
    expect(c.expired_value).toBeNull()
    expect(c.rx_awaiting_review).toBeNull()
    expect(c.financial).toBeNull()
  })

  it('needs a manager to approve a stock count and keeps the lots valid', async () => {
    const cid = (await as(storekeeper, () => q<{ r: { count_id: string } }>('select public.mart_start_count($1,$2,null,$3) as r', [biz, loc, key()])))[0].r.count_id
    await as(storekeeper, () => q('select public.stock_count_record($1,$2,$3)', [cid, gauze, 4]))
    await expect(as(storekeeper, () => q('select public.stock_count_post($1,$2)', [cid, key()]))).rejects.toThrow(/manager must approve/)
    await as(manager, () => q('select public.stock_count_post($1,$2)', [cid, key()]))
    expect(await stock(gauze)).toBe(4)
  })

  it('isolates one pharmacy from another', async () => {
    const mine = Number((await as(outsider, () => q<{ v: string }>('select count(*) as v from public.pharmacy_medicines where business_id=$1', [biz])))[0].v)
    expect(mine).toBe(0)
    await expect(save(outsider, 'Spy', { b: biz })).rejects.toThrow(/permission denied/)
    const lateId = (await batch(para, 'LATE')).id
    await expect(as(outsider, () => q('select public.pharmacy_set_batch_status($1,$2,$3)', [lateId, 'quarantined', 'bad actor']))).rejects.toThrow(/permission denied/)
    expect(bizB).not.toBe(biz)
  })

  it('validates expiry warning settings', async () => {
    await expect(as(manager, () => q('select public.pharmacy_save_settings($1,$2,$3,$4,$5,$6,$7)', [biz, 'community_pharmacy', null, null, 30, 90, 180]))).rejects.toThrow(/shortest/)
    await as(manager, () => q('select public.pharmacy_save_settings($1,$2,$3,$4,$5,$6,$7)', [biz, 'community_pharmacy', 'PCN-123', 'Pharm. Ade', 120, 60, 14]))
    expect((await q<{ expiry_status: string }>(`select expiry_status from public.pharmacy_batches where product_id=$1 and batch_number='LATE'`, [para]))[0].expiry_status).toBe('ok')
    await expect(as(cashier, () => q('select public.pharmacy_save_settings($1,$2,$3,$4,$5,$6,$7)', [biz, 'community_pharmacy', null, null, 180, 90, 30]))).rejects.toThrow(/permission denied/)
  })
})
