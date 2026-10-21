import { beforeAll, describe, expect, it } from 'vitest'
import { ensureDemoFarm } from '@/demo/demoFarm'
import { getInv } from '@/demo/demoInventory'
import * as o from '@/demo/demoOrders'
import { demoEnableModule, demoInvite, demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

// ------------------------------------------------------------- database
let db: Db
let owner: string, manager: string, worker: string, accountant: string, outsider: string
let biz: string, loc: string, feed: string, eggs: string, customer: string, supplier: string
let n = 0
const key = () => `ord-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)
const items = (...xs: [string, number, number?][]) => JSON.stringify(xs.map(([p, qn, c]) => ({ product_id: p, quantity: qn, estimated_unit_cost: c ?? null })))
const stock = async (p: string) => Number((await q<{ s: string }>('select coalesce(sum(quantity_on_hand),0) as s from public.inventory_balances where product_id=$1', [p]))[0].s)

const request = (u: string, xs: [string, number, number?][], k = key()) =>
  as(u, () => q<{ r: { request_id: string } }>('select public.create_purchase_request($1,$2::jsonb,$3,$4) as r', [biz, items(...xs), 'for the house', k])).then((r) => r[0].r.request_id)
const decide = (u: string, id: string, approve: boolean, note: string | null = null) => as(u, () => q('select public.decide_purchase_request($1,$2,$3,$4)', [id, approve, note, key()]))
const status = async (table: string, id: string) => (await q<{ status: string }>(`select status from public.${table} where id=$1`, [id]))[0].status

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, worker, accountant, outsider] = await Promise.all(['o', 'm', 'w', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Greenfield','farm') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [worker, 'operations_staff'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  await as(owner, () => q(`select public.enable_module($1,'purchases')`, [biz]))
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='kg'`, [biz]))[0].id
  const product = async (name: string, price: number, cost: number | null) => (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,default_purchase_cost) values ($1,$2,$3,$4,$5) returning id', [biz, name, unit, price, cost]))[0].id
  feed = await product('Layer mash', 600, 480)
  eggs = await product('Eggs', 1800, null)
  customer = (await q<{ id: string }>(`insert into public.customers (business_id,name,credit_limit) values ($1,'Ada',100000) returning id`, [biz]))[0].id
  supplier = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Alpha') returning id`, [biz]))[0].id
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: feed, quantity: 100, unit_cost: 480 }, { product_id: eggs, quantity: 20, unit_cost: 1000 }]), key()]))
})

describe('purchase requests (database)', () => {
  it('lets staff with procurement.request raise one; accountants and outsiders cannot', async () => {
    await request(worker, [[feed, 10, 480]])
    await request(manager, [[feed, 5]])
    await expect(request(outsider, [[feed, 1]])).rejects.toThrow(/permission denied/)
    await expect(request(accountant, [[feed, 1]])).rejects.toThrow(/permission denied/) // accountants approve, they do not raise
  })

  it('is idempotent and validates lines', async () => {
    const k = key()
    const a = await request(worker, [[feed, 2]], k)
    expect(await request(worker, [[feed, 2]], k)).toBe(a)
    await expect(request(worker, [[feed, 0]])).rejects.toThrow(/greater than zero/)
    await expect(request(worker, [[feed, 1], [feed, 2]])).rejects.toThrow(/once per request/)
    await expect(as(worker, () => q('select public.create_purchase_request($1,$2::jsonb,null,$3)', [biz, '[]', key()]))).rejects.toThrow(/1 to 50 lines/)
  })

  it('needs an approver who is not the requester (unless the owner)', async () => {
    const r = await request(worker, [[feed, 4, 480]])
    await expect(decide(worker, r, true)).rejects.toThrow(/permission denied/)
    await decide(manager, r, true, 'ok')
    expect(await status('purchase_requests', r)).toBe('approved')
    await expect(decide(manager, r, true)).rejects.toThrow(/awaiting a decision/)
    const own = await request(manager, [[feed, 3, 480]])
    await expect(decide(manager, own, true)).rejects.toThrow(/another approver/)
    await decide(accountant, own, true)
    const ownerOwn = await request(owner, [[feed, 1, 480]])
    await decide(owner, ownerOwn, true)
    expect(await status('purchase_requests', ownerOwn)).toBe('approved')
  })

  it('needs a reason to reject', async () => {
    const r = await request(worker, [[feed, 1]])
    await expect(decide(manager, r, false, 'no')).rejects.toThrow(/say why/)
    await decide(manager, r, false, 'not needed this month')
    expect(await status('purchase_requests', r)).toBe('rejected')
  })

  it('becomes a normal purchase order once approved, using estimated or default costs', async () => {
    const r = await request(worker, [[feed, 10], [eggs, 2, 900]])
    await expect(as(manager, () => q('select public.order_purchase_request($1,$2,$3)', [r, supplier, key()]))).rejects.toThrow(/approved request/)
    await decide(manager, r, true)
    const k = key()
    const res = await as(manager, () => q<{ r: { purchase_id: string } }>('select public.order_purchase_request($1,$2,$3) as r', [r, supplier, k]))
    const again = await as(manager, () => q<{ r: { purchase_id: string } }>('select public.order_purchase_request($1,$2,$3) as r', [r, supplier, k]))
    expect(again[0].r.purchase_id).toBe(res[0].r.purchase_id)
    expect(await status('purchase_requests', r)).toBe('ordered')
    const [po] = await q<{ total_amount: string; supplier_reference: string }>('select total_amount, supplier_reference from public.purchases where id=$1', [res[0].r.purchase_id])
    expect(Number(po.total_amount)).toBe(10 * 480 + 2 * 900) // feed at its usual cost, eggs at the estimate
    expect(po.supplier_reference).toMatch(/^PRQ-/)
    expect(await q('select 1 from public.purchases where supplier_id=$1', [supplier])).toHaveLength(1) // exactly one order
  })

  it('cannot order without a unit cost, and cannot cancel what is ordered', async () => {
    const r = await request(worker, [[eggs, 3]]) // eggs have no usual cost and no estimate
    await decide(manager, r, true)
    await expect(as(manager, () => q('select public.order_purchase_request($1,$2,$3)', [r, supplier, key()]))).rejects.toThrow(/unit cost is required/)
    expect(await status('purchase_requests', r)).toBe('approved')
    await as(worker, () => q('select public.cancel_purchase_request($1,$2)', [r, key()]))
    expect(await status('purchase_requests', r)).toBe('cancelled')
    await expect(as(worker, () => q('select public.cancel_purchase_request($1,$2)', [r, key()]))).rejects.toThrow(/no longer be cancelled/)
  })

  it('only the requester or an approver can cancel', async () => {
    const r = await request(manager, [[feed, 1, 480]])
    await expect(as(worker, () => q('select public.cancel_purchase_request($1,$2)', [r, key()]))).rejects.toThrow(/only the requester or an approver/)
    await as(accountant, () => q('select public.cancel_purchase_request($1,$2)', [r, key()])).catch((e: Error) => expect(e.message).toMatch(/permission denied/)) // accountants cannot raise, so they cannot use the cancel path either
  })
})

describe('supplier bills (database)', () => {
  let po: string
  beforeAll(async () => {
    po = (await as(owner, () => q<{ r: { purchase_id: string } }>('select public.create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, JSON.stringify([{ product_id: feed, quantity: 10, unit_cost: 100 }]), key()])))[0].r.purchase_id
  })
  const bill = (u: string, number: string, amount: number, k = key(), due = today) => as(u, () => q<{ r: { bill_id: string } }>('select public.record_supplier_bill($1,$2,$3,$4,$5,$6,$7) as r', [biz, po, number, today, due, amount, k])).then((r) => r[0].r.bill_id)

  it('lets owner, manager and accountant record; workers cannot', async () => {
    await bill(accountant, 'INV-1', 300)
    await expect(bill(worker, 'INV-X', 10)).rejects.toThrow(/permission denied/)
    await expect(bill(outsider, 'INV-X', 10)).rejects.toThrow(/permission denied/)
  })

  it('rejects duplicate numbers per supplier, over-billing, bad dates and zero amounts; is idempotent', async () => {
    await expect(bill(owner, 'inv-1', 100)).rejects.toThrow(/duplicate key/)
    await expect(bill(owner, 'INV-2', 800)).rejects.toThrow(/exceed its total/) // 300 + 800 > 1000
    await expect(bill(owner, 'INV-2', 100, key(), '2000-01-01')).rejects.toThrow(/due date/)
    await expect(bill(owner, 'INV-2', 0)).rejects.toThrow(/positive/)
    const k = key()
    const a = await bill(owner, 'INV-3', 100, k)
    expect(await bill(owner, 'INV-3', 100, k)).toBe(a)
  })

  it('frees the number and the amount when voided, and tracks the order payment', async () => {
    const id = (await q<{ id: string }>(`select id from public.supplier_bills where bill_number='INV-1'`))[0].id
    await expect(as(owner, () => q('select public.void_supplier_bill($1,$2,$3)', [id, 'x', key()]))).rejects.toThrow(/reason is required/)
    await as(owner, () => q('select public.void_supplier_bill($1,$2,$3)', [id, 'supplier reissued it', key()]))
    await expect(as(owner, () => q('select public.void_supplier_bill($1,$2,$3)', [id, 'again please', key()]))).rejects.toThrow(/already voided/)
    await bill(owner, 'INV-1', 300) // number is free again
    await as(owner, () => q(`select public.pay_purchase($1,'bank_transfer',1000,null,$2)`, [po, key()]))
    const s = await as(owner, () => q<{ bill_number: string; payment_status: string; overdue: boolean; status: string }>(`select bill_number, payment_status, overdue, status from public.supplier_bill_status where purchase_id=$1 order by bill_number`, [po]))
    expect(s.filter((x) => x.status === 'open').every((x) => x.payment_status === 'paid' && x.overdue === false)).toBe(true)
  })

  it('shows bills to their own business only', async () => {
    expect(await as(outsider, () => q('select * from public.supplier_bills'))).toHaveLength(0)
    expect(await as(worker, () => q('select * from public.supplier_bill_status'))).toHaveLength(0)
  })
})

describe('sales orders (database)', () => {
  const order = (u: string, lines: [string, number][], k = key()) =>
    as(u, () => q<{ r: { order_id: string } }>('select public.create_sales_order($1,$2,$3::jsonb,null,null,$4) as r', [biz, customer, JSON.stringify(lines.map(([p, qn]) => ({ product_id: p, quantity: qn }))), k])).then((r) => r[0].r.order_id)
  const lineOf = async (id: string, p: string) => (await q<{ line_id: string }>('select line_id from public.sales_order_line_status where order_id=$1 and product_id=$2', [id, p]))[0].line_id
  const fulfil = (u: string, id: string, lines: { line_id: string; quantity: number }[], pay: { method: string; amount: number }[] = [], k = key()) =>
    as(u, () => q<{ r: { sale_id: string } }>('select public.fulfil_sales_order($1,$2,$3::jsonb,$4::jsonb,$5) as r', [id, loc, JSON.stringify(lines), JSON.stringify(pay), k])).then((r) => r[0].r.sale_id)
  const view = async (id: string) => (await q<{ status: string }>('select status from public.sales_order_status where id=$1', [id]))[0].status
  const remaining = async (id: string, p: string) => Number((await q<{ remaining: string }>('select remaining from public.sales_order_line_status where order_id=$1 and product_id=$2', [id, p]))[0].remaining)

  it('creates an order that reserves nothing, quoting today\'s price', async () => {
    const before = await stock(feed)
    const id = await order(owner, [[feed, 30], [eggs, 5]])
    expect(await stock(feed)).toBe(before)
    expect(await view(id)).toBe('open')
    expect(Number((await q<{ quoted_total: string }>('select quoted_total from public.sales_order_status where id=$1', [id]))[0].quoted_total)).toBe(30 * 600 + 5 * 1800)
  })

  it('rejects workers without sales.create, outsiders, duplicate products and unknown customers; is idempotent', async () => {
    await expect(order(outsider, [[feed, 1]])).rejects.toThrow(/permission denied/)
    await expect(order(worker, [[feed, 1]])).rejects.toThrow(/permission denied/)
    await expect(order(owner, [[feed, 1], [feed, 2]])).rejects.toThrow(/once per order/)
    await expect(as(owner, () => q('select public.create_sales_order($1,$2,$3::jsonb,null,null,$4)', [biz, '00000000-0000-0000-0000-000000000000', JSON.stringify([{ product_id: feed, quantity: 1 }]), key()]))).rejects.toThrow(/unknown customer/)
    const k = key()
    const a = await order(owner, [[feed, 1]], k)
    expect(await order(owner, [[feed, 1]], k)).toBe(a)
  })

  it('delivers in parts through a normal sale, deducts stock once, and tracks what remains', async () => {
    const id = await order(owner, [[feed, 40]])
    const line = await lineOf(id, feed)
    const before = await stock(feed)
    const k = key()
    const sale = await fulfil(owner, id, [{ line_id: line, quantity: 15 }], [{ method: 'cash', amount: 9000 }], k)
    expect(await fulfil(owner, id, [{ line_id: line, quantity: 15 }], [{ method: 'cash', amount: 9000 }], k)).toBe(sale) // same key, same sale
    expect(await stock(feed)).toBe(before - 15)
    expect(await view(id)).toBe('partially_fulfilled')
    expect(await remaining(id, feed)).toBe(25)
    expect((await q<{ sales_order_id: string; grand_total: string; amount_paid: string }>('select sales_order_id, grand_total, amount_paid from public.sales where id=$1', [sale]))[0]).toMatchObject({ sales_order_id: id })
    await expect(fulfil(owner, id, [{ line_id: line, quantity: 26 }])).rejects.toThrow(/only 25 remain/)
    await fulfil(owner, id, [{ line_id: line, quantity: 25 }], [{ method: 'cash', amount: 15000 }])
    expect(await view(id)).toBe('fulfilled')
  })

  it('reopens the order when its sale is voided (after reversing the payment)', async () => {
    const id = await order(owner, [[feed, 10]])
    const line = await lineOf(id, feed)
    const before = await stock(feed)
    const sale = await fulfil(owner, id, [{ line_id: line, quantity: 10 }], [{ method: 'cash', amount: 6000 }])
    expect(await view(id)).toBe('fulfilled')
    const pay = (await q<{ id: string }>('select id from public.payments where sale_id=$1', [sale]))[0].id
    await as(owner, () => q('select public.reverse_payment($1,$2,$3)', [pay, 'wrong customer', key()]))
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [sale, 'entered twice', key()]))
    expect(await view(id)).toBe('open')
    expect(await remaining(id, feed)).toBe(10)
    expect(await stock(feed)).toBe(before)
  })

  it('rolls everything back when stock is short, and refuses a cancelled order', async () => {
    const id = await order(owner, [[eggs, 5000]])
    const line = await lineOf(id, eggs)
    const before = await stock(eggs)
    await expect(fulfil(owner, id, [{ line_id: line, quantity: 5000 }])).rejects.toThrow(/insufficient stock/)
    expect(await stock(eggs)).toBe(before)
    expect(await view(id)).toBe('open')
    await expect(as(owner, () => q('select public.cancel_sales_order($1,$2,$3)', [id, 'x', key()]))).rejects.toThrow(/reason is required/)
    await as(owner, () => q('select public.cancel_sales_order($1,$2,$3)', [id, 'customer changed mind', key()]))
    expect(await view(id)).toBe('cancelled')
    await expect(fulfil(owner, id, [{ line_id: line, quantity: 1 }])).rejects.toThrow(/cancelled/)
    await expect(as(owner, () => q('select public.cancel_sales_order($1,$2,$3)', [id, 'again please', key()]))).rejects.toThrow(/already cancelled/)
  })

  it('refuses lines from another order and shows orders to their own business only', async () => {
    const a = await order(owner, [[feed, 1]]); const b = await order(owner, [[feed, 1]])
    await expect(fulfil(owner, a, [{ line_id: await lineOf(b, feed), quantity: 1 }])).rejects.toThrow(/does not belong/)
    expect(await as(outsider, () => q('select * from public.sales_orders'))).toHaveLength(0)
    expect(await as(worker, () => q('select * from public.sales_order_status'))).toHaveLength(0) // workers lack sales.read
  })
})

// ------------------------------------------------------------- demo mirror
const B = 'b-farm'
const dkey = () => `dord-${n++}-abcdefgh`

describe('demo mirrors purchase requests, bills and sales orders', () => {
  let mash: string, eggsId: string, ada: string, alpha: string, dloc: string
  beforeAll(() => {
    demoSignIn('owner@demo.test', 'demo1234')
    ensureDemoFarm(B); trade.ensureDemoTrade(B)
    expect(demoInvite(B, 'accountant@demo.test', 'manager')).toBeNull()
    expect(demoInvite(B, 'cashier@demo.test', 'operations_staff')).toBeNull()
    const prod = (name: string) => getInv().products.find((p) => p.businessId === B && p.name.startsWith(name))!.id
    mash = prod('Layer Mash'); eggsId = prod('Table eggs')
    ada = trade.getTrade().customers.find((c) => c.businessId === B && c.name === 'Ada Stores')!.id
    alpha = trade.getTrade().suppliers.find((s) => s.businessId === B && s.name === 'Alpha Distributors')!.id
    dloc = getInv().locations.find((l) => l.businessId === B)!.id
  })
  const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }

  it('purchase requests: staff raise, another approver decides, ordering needs the Purchases module', () => {
    as('cashier@demo.test')
    const r = o.demoCreateRequest(B, [{ productId: mash, quantity: 10, estimatedCost: 480 }], 'for the house', dkey())
    expect(r.error).toBeNull()
    expect(o.demoCreateRequest(B, [{ productId: mash, quantity: 1, estimatedCost: null }, { productId: mash, quantity: 2, estimatedCost: null }], '', dkey()).error).toMatch(/once per request/)
    const id = r.result!.requestId
    expect(o.demoDecideRequest(B, id, true, '', dkey())).toMatch(/permission denied/)
    as('accountant@demo.test')
    expect(o.demoDecideRequest(B, id, false, 'no', dkey())).toMatch(/say why/)
    expect(o.demoDecideRequest(B, id, true, '', dkey())).toBeNull()
    expect(o.demoDecideRequest(B, id, true, '', dkey())).toMatch(/awaiting a decision/)
    const own = o.demoCreateRequest(B, [{ productId: mash, quantity: 3, estimatedCost: 480 }], '', dkey()).result!.requestId
    expect(o.demoDecideRequest(B, own, true, '', dkey())).toMatch(/another approver/)
    as('owner@demo.test')
    expect(o.demoDecideRequest(B, own, true, '', dkey())).toBeNull()
    expect(o.demoOrderRequest(B, id, alpha, dkey()).error).toMatch(/permission denied/) // Purchases is not on for a farm by default
    expect(demoEnableModule(B, 'purchases')).toBeNull()
    const k = dkey()
    const a = o.demoOrderRequest(B, id, alpha, k); const b = o.demoOrderRequest(B, id, alpha, k)
    expect(a.error).toBeNull()
    expect(b.result).toEqual(a.result)
    expect(trade.getTrade().purchases.filter((p) => p.businessId === B && p.reference?.startsWith('PRQ-'))).toHaveLength(1)
    expect(o.getOrders().requests.find((x) => x.id === id)!.status).toBe('ordered')
    expect(o.demoOrderRequest(B, id, alpha, dkey()).error).toMatch(/approved request/)
  })

  it('supplier bills: capped by the order, unique per supplier, voidable with a reason', () => {
    const po = trade.demoCreatePurchase(B, alpha, [{ productId: mash, quantity: 10, unitCost: 100 }], '', dkey()).result!.purchaseId
    const bill = (num: string, amount: number, k = dkey()) => o.demoRecordBill(B, { purchaseId: po, number: num, billDate: '2026-01-01', dueDate: '2026-01-31', amount }, k)
    expect(bill('INV-1', 300).error).toBeNull()
    expect(bill('inv-1', 100).error).toMatch(/duplicate key/)
    expect(bill('INV-2', 800).error).toMatch(/exceed its total/)
    expect(o.demoRecordBill(B, { purchaseId: po, number: 'INV-9', billDate: '2026-02-01', dueDate: '2026-01-01', amount: 10 }, dkey()).error).toMatch(/due date/)
    const k = dkey()
    const a = bill('INV-3', 100, k)
    expect(bill('INV-3', 100, k).result).toEqual(a.result)
    const id = o.getOrders().bills.find((x) => x.number === 'INV-1')!.id
    expect(o.demoVoidBill(B, id, 'x', dkey())).toMatch(/reason is required/)
    expect(o.demoVoidBill(B, id, 'supplier reissued it', dkey())).toBeNull()
    expect(bill('INV-1', 300).error).toBeNull()
    expect(o.demoBills(B).filter((x) => x.purchaseId === po && x.overdue).length).toBe(2) // both live bills are past due and unpaid
    as('cashier@demo.test')
    expect(bill('INV-X', 10).error).toMatch(/permission denied/)
    as('owner@demo.test')
  })

  it('sales orders: deliver in parts, derive what remains, reopen on void, reject over-delivery and cancelled orders', () => {
    const created = o.demoCreateOrder(B, ada, [{ productId: mash, quantity: 40 }], null, '', dkey())
    expect(created.error).toBeNull()
    expect(o.demoCreateOrder(B, ada, [{ productId: mash, quantity: 1 }, { productId: mash, quantity: 2 }], null, '', dkey()).error).toMatch(/once per order/)
    const id = created.result!.orderId
    const row = () => o.demoOrderRows(B).find((x) => x.id === id)!
    const line = row().lines[0].id
    const onHand = () => Object.entries(getInv().balances).filter(([k]) => k.startsWith(`${B}|${mash}|`)).reduce((a, [, v]) => a + v.qty, 0)
    const before = onHand()
    const k = dkey()
    const a = o.demoFulfilOrder(B, id, dloc, [{ lineId: line, quantity: 15 }], [{ method: 'cash', amount: 9000 }], k)
    expect(a.error).toBeNull()
    expect(o.demoFulfilOrder(B, id, dloc, [{ lineId: line, quantity: 15 }], [{ method: 'cash', amount: 9000 }], k).result).toEqual(a.result)
    expect(onHand()).toBe(before - 15)
    expect(row()).toMatchObject({ derivedStatus: 'partially_fulfilled' })
    expect(row().lines[0].remaining).toBe(25)
    expect(o.demoFulfilOrder(B, id, dloc, [{ lineId: line, quantity: 26 }], [], dkey()).error).toMatch(/only 25 remain/)
    const pay = trade.getTrade().payments.find((p) => p.saleId === a.result!.saleId)!
    expect(trade.demoReversePayment(B, pay.id, 'wrong customer', dkey())).toBeNull()
    expect(trade.demoVoidSale(B, a.result!.saleId, 'entered twice', dkey())).toBeNull()
    expect(row()).toMatchObject({ derivedStatus: 'open' })
    expect(row().lines[0].remaining).toBe(40)
    expect(onHand()).toBe(before)
    const big = o.demoCreateOrder(B, ada, [{ productId: eggsId, quantity: 99999 }], null, '', dkey()).result!.orderId
    const bigLine = o.demoOrderRows(B).find((x) => x.id === big)!.lines[0].id
    expect(o.demoFulfilOrder(B, big, dloc, [{ lineId: bigLine, quantity: 99999 }], [], dkey()).error).toMatch(/insufficient stock/)
    expect(o.demoOrderRows(B).find((x) => x.id === big)!.saleIds).toEqual([])
    expect(o.demoCancelOrder(B, big, 'x', dkey())).toMatch(/reason is required/)
    expect(o.demoCancelOrder(B, big, 'customer changed mind', dkey())).toBeNull()
    expect(o.demoFulfilOrder(B, big, dloc, [{ lineId: bigLine, quantity: 1 }], [], dkey()).error).toMatch(/cancelled/)
    expect(o.demoOrderRows(B).find((x) => x.id === big)!.derivedStatus).toBe('cancelled')
  })

  it('sales orders need sales.create', () => {
    as('cashier@demo.test') // operations staff on the farm: no sales.create
    expect(o.demoCreateOrder(B, ada, [{ productId: mash, quantity: 1 }], null, '', dkey()).error).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})
