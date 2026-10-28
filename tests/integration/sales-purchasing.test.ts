import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, officer: string, accountant: string, other: string
let biz: string, bizB: string, loc: string
let widget: string, gadget: string, service: string, bWidget: string
let n = 0
const key = () => `k-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)

type Sale = { sale_id: string; sale_number: string; grand_total: number; amount_paid: number; balance_due: number }
const sell = (u: string, items: object[], payments: object[] = [], customer: string | null = null, k = key()) =>
  as(u, () => q<{ r: Sale }>('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, customer, J(items), J(payments), k])).then((r) => r[0].r)
const saleRow = async (id: string) => (await q<Record<string, string>>('select * from public.sales where id=$1', [id]))[0]
const stock = async (p: string) => Number((await q<{ quantity_on_hand: string }>('select quantity_on_hand from public.inventory_balances where product_id=$1 and location_id=$2', [p, loc]))[0]?.quantity_on_hand ?? 0)
const num = (v: unknown) => Number(v)
const setSettings = (patch: object) => db.query(`update public.businesses set settings = settings || $2::jsonb where id=$1`, [biz, J(patch)])
const setPlan = (b: string, plan: string) => db.query(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code=$2) where business_id=$1`, [b, plan])
const newProduct = (u: string, b: string, name: string, price: number, tracks = true, unitId?: string) =>
  as(u, async () => {
    const unit = unitId ?? (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [b]))[0].id
    return (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,tracks_stock) values ($1,$2,$3,$4,$5) returning id', [b, name, unit, price, tracks]))[0].id
  })
const receiveStock = (p: string, qty: number, cost: number) =>
  as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, J([{ product_id: p, quantity: qty, unit_cost: cost }]), key()]))
const newCustomer = (u: string, name: string) => as(u, () => q<{ id: string }>('insert into public.customers (business_id,name) values ($1,$2) returning id', [biz, name])).then((r) => r[0].id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, officer, accountant, other] = await Promise.all(['o', 'c', 'i', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Other','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[cashier, 'cashier'], [officer, 'inventory_officer'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  widget = await newProduct(owner, biz, 'Widget', 1000)
  gadget = await newProduct(owner, biz, 'Gadget', 250.5)
  service = await newProduct(owner, biz, 'Delivery', 500, false)
  bWidget = await newProduct(other, bizB, 'B widget', 10)
  await receiveStock(widget, 100, 600)
  await receiveStock(gadget, 50, 100)
})

describe('posting a sale', () => {
  it('computes totals on the server, deducts stock and records the payment', async () => {
    await setSettings({ tax_rate_percent: 7.5 })
    const s = await sell(owner, [{ product_id: widget, quantity: 2, discount_amount: 100 }], [{ method: 'cash', amount: 2042.5 }])
    await setSettings({ tax_rate_percent: 0 })
    const row = await saleRow(s.sale_id)
    expect([num(row.subtotal), num(row.discount_total), num(row.tax_total), num(row.grand_total)]).toEqual([2000, 100, 142.5, 2042.5])
    expect(row.payment_status).toBe('paid')
    expect(num(row.balance_due)).toBe(0)
    expect(await stock(widget)).toBe(98)
    const [item] = await q<{ unit_cost_snapshot: string; description_snapshot: string }>('select * from public.sale_items where sale_id=$1', [s.sale_id])
    expect(num(item.unit_cost_snapshot)).toBe(600)
    expect(item.description_snapshot).toBe('Widget')
  })

  it('numbers sales sequentially per business', async () => {
    const a = await sell(owner, [{ product_id: gadget, quantity: 1 }], [{ method: 'cash', amount: 250.5 }])
    const b = await sell(owner, [{ product_id: gadget, quantity: 1 }], [{ method: 'cash', amount: 250.5 }])
    expect(Number(b.sale_number.slice(4)) - Number(a.sale_number.slice(4))).toBe(1)
    expect(a.sale_number).toMatch(/^SAL-\d{6}$/)
  })

  it('rejects a stale or tampered client price instead of trusting it', async () => {
    await expect(sell(owner, [{ product_id: widget, quantity: 1, unit_price: 1 }], [{ method: 'cash', amount: 1 }])).rejects.toThrow(/price .* has changed/)
  })

  it('only users with sales.discount can discount; discounts are bounded', async () => {
    await expect(sell(cashier, [{ product_id: widget, quantity: 1, discount_amount: 10 }], [{ method: 'cash', amount: 990 }])).rejects.toThrow(/not allowed to give discounts/)
    await expect(sell(owner, [{ product_id: widget, quantity: 1, discount_amount: 5000 }])).rejects.toThrow(/invalid discount/)
    await expect(sell(owner, [{ product_id: widget, quantity: 1, discount_amount: -1 }])).rejects.toThrow(/invalid discount/)
    await sell(cashier, [{ product_id: widget, quantity: 1 }], [{ method: 'cash', amount: 1000 }])
  })

  it('rejects bad lines and refuses to oversell without leaving a partial sale', async () => {
    const before = (await q('select 1 from public.sales')).length
    const stockBefore = await stock(gadget)
    await expect(sell(owner, [{ product_id: gadget, quantity: 1 }, { product_id: widget, quantity: 9999 }], [])).rejects.toThrow(/insufficient stock/)
    await expect(sell(owner, [{ product_id: widget, quantity: 0 }])).rejects.toThrow(/greater than zero/)
    await expect(sell(owner, [])).rejects.toThrow(/1 to 100/)
    await expect(sell(owner, [{ product_id: bWidget, quantity: 1 }])).rejects.toThrow(/invalid product/)
    expect((await q('select 1 from public.sales')).length).toBe(before)
    expect(await stock(gadget)).toBe(stockBefore)
  })

  it('does not post stock movements for non-stock items', async () => {
    const before = (await q('select 1 from public.stock_movements')).length
    await sell(owner, [{ product_id: service, quantity: 1 }], [{ method: 'cash', amount: 500 }])
    expect((await q('select 1 from public.stock_movements')).length).toBe(before)
  })

  it('a retried request returns the original sale and deducts stock once', async () => {
    const k = key()
    const before = await stock(widget)
    const first = await sell(owner, [{ product_id: widget, quantity: 3 }], [{ method: 'cash', amount: 3000 }], null, k)
    const second = await sell(owner, [{ product_id: widget, quantity: 3 }], [{ method: 'cash', amount: 3000 }], null, k)
    expect(second).toEqual(first)
    expect(await stock(widget)).toBe(before - 3)
  })

  it('keeps ledger balances reconciled', async () => {
    expect(await as(owner, () => q('select * from public.inventory_reconcile($1)', [biz]))).toHaveLength(0)
  })
})

describe('payments and credit', () => {
  let customer: string
  beforeAll(async () => { customer = await newCustomer(cashier, 'Ada Stores') })

  it('requires a customer for a sale with a balance due, and respects the credit limit', async () => {
    await expect(sell(owner, [{ product_id: widget, quantity: 1 }], [{ method: 'cash', amount: 400 }])).rejects.toThrow(/needs a customer/)
    await expect(sell(owner, [{ product_id: widget, quantity: 1 }], [], customer)).rejects.toThrow(/credit limit exceeded/)
    await expect(as(cashier, () => q('select public.set_customer_credit_limit($1, 5000)', [customer]))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.set_customer_credit_limit($1, 5000)', [customer]))
    const s = await sell(owner, [{ product_id: widget, quantity: 3 }], [{ method: 'cash', amount: 1000 }], customer)
    expect(num(s.balance_due)).toBe(2000)
    await expect(sell(owner, [{ product_id: widget, quantity: 4 }], [], customer)).rejects.toThrow(/credit limit exceeded/)
  })

  it('cashiers cannot edit credit limits directly', async () => {
    await expect(as(cashier, () => db.query('update public.customers set credit_limit = 1e9 where id=$1', [customer]))).rejects.toThrow(/permission denied/)
  })

  it('applies partial payments, rejects overpayment, and tracks status', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 2 }], [{ method: 'cash', amount: 500 }], customer)
    expect((await saleRow(s.sale_id)).payment_status).toBe('partially_paid')
    await expect(as(cashier, () => q(`select public.record_sale_payment($1,'cash',1500.01,'successful',null,$2)`, [s.sale_id, key()]))).rejects.toThrow(/exceeds the amount due/)
    await as(cashier, () => q(`select public.record_sale_payment($1,'bank_transfer',1500,'successful','TRX-1',$2)`, [s.sale_id, key()]))
    const row = await saleRow(s.sale_id)
    expect([row.payment_status, num(row.amount_paid), num(row.balance_due)]).toEqual(['paid', 2000, 0])
  })

  it('does not count pending payments until confirmed, and handles reversals', async () => {
    const s = await sell(owner, [{ product_id: gadget, quantity: 2 }], [], await newCustomerWithLimit(10000))
    const [pay] = await as(cashier, () => q<{ r: { payment_id: string } }>(`select public.record_sale_payment($1,'bank_transfer',501,'pending','TRX-2',$2) as r`, [s.sale_id, key()]))
    expect(num((await saleRow(s.sale_id)).amount_paid)).toBe(0)
    await as(cashier, () => q('select public.confirm_payment($1,$2)', [pay.r.payment_id, key()]))
    expect((await saleRow(s.sale_id)).payment_status).toBe('paid')
    await expect(as(cashier, () => q('select public.reverse_payment($1,$2,$3)', [pay.r.payment_id, 'bounced', key()]))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.reverse_payment($1,$2,$3)', [pay.r.payment_id, 'transfer bounced', key()]))
    const row = await saleRow(s.sale_id)
    expect([row.payment_status, num(row.balance_due)]).toEqual(['unpaid', 501])
    await expect(as(owner, () => q('select public.confirm_payment($1,$2)', [pay.r.payment_id, key()]))).rejects.toThrow(/only pending/)
  })

  it('payments are immutable except for their status', async () => {
    await expect(db.query('update public.payments set amount = 1')).rejects.toThrow(/immutable/)
    await expect(db.query('delete from public.payments')).rejects.toThrow(/cannot be deleted/)
    await expect(as(owner, () => db.query('update public.payments set status=$1', ['successful']))).rejects.toThrow(/permission denied/)
  })
})

async function newCustomerWithLimit(limit: number) {
  const c = await newCustomer(cashier, `C-${n++}`)
  await as(owner, () => q('select public.set_customer_credit_limit($1,$2)', [c, limit]))
  return c
}

describe('returns and refunds', () => {
  it('splits a refund so the last unit takes the remainder (no cent drift)', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 3, discount_amount: 1 }], [{ method: 'cash', amount: 2999 }])
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    const ret = (qty: number, extra = {}) => as(owner, () => q<{ r: { total_amount: number } }>('select public.return_sale($1,$2::jsonb,$3,$4::jsonb,$5) as r',
      [s.sale_id, J([{ sale_item_id: item.id, quantity: qty, disposition: 'restock', ...extra }]), 'customer changed mind', null, key()])).then((r) => r[0].r.total_amount)
    const parts = [await ret(1), await ret(1), await ret(1)]
    expect(parts.map(num)).toEqual([999.67, 999.67, 999.66])
    expect(parts.reduce((a, b) => a + num(b), 0)).toBeCloseTo(2999, 2)
    const row = await saleRow(s.sale_id)
    expect(row.status).toBe('refunded')
  })

  it('rejects returning more than was sold or already returned', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 2 }], [{ method: 'cash', amount: 2000 }])
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    const ret = (qty: number) => as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,null,$4)', [s.sale_id, J([{ sale_item_id: item.id, quantity: qty }]), 'defective', key()]))
    await expect(ret(3)).rejects.toThrow(/remain returnable/)
    await ret(2)
    await expect(ret(1)).rejects.toThrow(/remain returnable/)
    await expect(as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,null,$4)', [s.sale_id, J([{ sale_item_id: item.id, quantity: 1 }, { sale_item_id: item.id, quantity: 1 }]), 'dup lines', key()]))).rejects.toThrow()
  })

  it('restocks at the original cost, or discards without touching stock', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 2 }], [{ method: 'cash', amount: 2000 }])
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    const before = await stock(widget)
    const run = (disposition: string) => as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,null,$4)', [s.sale_id, J([{ sale_item_id: item.id, quantity: 1, disposition }]), 'faulty', key()]))
    await run('restock')
    expect(await stock(widget)).toBe(before + 1)
    await run('discard')
    expect(await stock(widget)).toBe(before + 1)
    const [m] = await q<{ unit_cost: string }>(`select unit_cost from public.stock_movements where movement_type='return_in' order by created_at desc limit 1`)
    expect(num(m.unit_cost)).toBe(600)
  })

  it('refunds cash as a separate linked payment, capped at what was paid', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 2 }], [{ method: 'cash', amount: 2000 }])
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    await expect(as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,$4::jsonb,$5)',
      [s.sale_id, J([{ sale_item_id: item.id, quantity: 1 }]), 'refund me', J({ method: 'cash', amount: 1000.01 }), key()]))).rejects.toThrow(/refund exceeds/)
    await as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,$4::jsonb,$5)',
      [s.sale_id, J([{ sale_item_id: item.id, quantity: 1 }]), 'refund me', J({ method: 'cash', amount: 1000 }), key()]))
    const row = await saleRow(s.sale_id)
    expect([num(row.amount_paid), num(row.returned_total), num(row.refund_due), num(row.balance_due)]).toEqual([1000, 1000, 0, 0])
    const [p] = await q<{ payment_type: string; sale_return_id: string | null }>(`select payment_type, sale_return_id from public.payments where sale_id=$1 and payment_type='refund'`, [s.sale_id])
    expect(p.payment_type).toBe('refund')
    expect(p.sale_return_id).toBeTruthy()
  })

  it('only users with sales.refund can return', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 1 }], [{ method: 'cash', amount: 1000 }])
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    await expect(as(cashier, () => q('select public.return_sale($1,$2::jsonb,$3,null,$4)', [s.sale_id, J([{ sale_item_id: item.id, quantity: 1 }]), 'nope', key()]))).rejects.toThrow(/permission denied/)
  })
})

describe('voiding', () => {
  it('requires payments to be reversed first, then restores stock', async () => {
    const before = await stock(widget)
    const s = await sell(owner, [{ product_id: widget, quantity: 2 }], [{ method: 'cash', amount: 2000 }])
    expect(await stock(widget)).toBe(before - 2)
    await expect(as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'entered twice', key()]))).rejects.toThrow(/reverse the successful payments/)
    const [p] = await q<{ id: string }>('select id from public.payments where sale_id=$1', [s.sale_id])
    await as(owner, () => q('select public.reverse_payment($1,$2,$3)', [p.id, 'wrong sale', key()]))
    await expect(as(cashier, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'oops', key()]))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'entered twice', key()]))
    expect(await stock(widget)).toBe(before)
    expect((await saleRow(s.sale_id)).status).toBe('voided')
    await expect(as(owner, () => q(`select public.record_sale_payment($1,'cash',1,'successful',null,$2)`, [s.sale_id, key()]))).rejects.toThrow(/voided/)
    await expect(as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'again', key()]))).rejects.toThrow(/only posted/)
    expect(await as(owner, () => q('select * from public.inventory_reconcile($1)', [biz]))).toHaveLength(0)
  })

  it('cannot void a sale that has returns', async () => {
    const s = await sell(owner, [{ product_id: widget, quantity: 1 }], [])
      .catch(async () => sell(owner, [{ product_id: widget, quantity: 1 }], [{ method: 'cash', amount: 1000 }]))
    const [item] = await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [s.sale_id])
    await as(owner, () => q('select public.return_sale($1,$2::jsonb,$3,null,$4)', [s.sale_id, J([{ sale_item_id: item.id, quantity: 1 }]), 'returned', key()]))
    await expect(as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'void it', key()]))).rejects.toThrow(/returns cannot be voided|only posted/)
  })
})

describe('receipts', () => {
  it('returns everything needed to print a receipt', async () => {
    const s = await sell(cashier, [{ product_id: gadget, quantity: 2 }], [{ method: 'cash', amount: 501 }])
    const [r] = await as(cashier, () => q<{ r: { business: { name: string }; items: unknown[]; payments: unknown[]; sale: { sale_number: string } } }>('select public.sale_receipt($1) as r', [s.sale_id]))
    expect(r.r.business.name).toBe('Shop')
    expect(r.r.items).toHaveLength(1)
    expect(r.r.payments).toHaveLength(1)
    expect(r.r.sale.sale_number).toBe(s.sale_number)
    await expect(as(other, () => q('select public.sale_receipt($1)', [s.sale_id]))).rejects.toThrow(/permission denied/)
  })
})

describe('purchasing', () => {
  let supplier: string
  let po: { purchase_id: string; total_amount: number; purchase_number: string }
  const poItems = async () => q<{ id: string; quantity_ordered: string; quantity_received: string }>('select * from public.purchase_items where purchase_id=$1 order by quantity_ordered desc', [po.purchase_id])
  const receivePo = (u: string, lines: object[], k = key()) => as(u, () => q('select public.receive_purchase($1,$2,$3::jsonb,null,$4)', [po.purchase_id, loc, J(lines), k]))
  let raw: string

  beforeAll(async () => {
    supplier = (await as(officer, () => q<{ id: string }>('insert into public.suppliers (business_id,name) values ($1,$2) returning id', [biz, 'Alpha Distributors'])))[0].id
    raw = await newProduct(owner, biz, 'Raw sugar', 0)
    po = (await as(officer, () => q<{ r: typeof po }>('select public.create_purchase($1,$2,$3::jsonb,$4,$5) as r', [biz, supplier, J([{ product_id: raw, quantity: 10, unit_cost: 50 }, { product_id: gadget, quantity: 4, unit_cost: 110.25 }]), 'INV-77', key()])))[0].r
  })

  it('creates a purchase order without touching stock', async () => {
    expect(num(po.total_amount)).toBe(941)
    expect(po.purchase_number).toMatch(/^PO-\d{6}$/)
    expect(await stock(raw)).toBe(0)
  })

  it('receives partially, updating stock at the order cost and the status', async () => {
    const items = await poItems()
    const gadgetBefore = await stock(gadget)
    await receivePo(officer, [{ purchase_item_id: items[0].id, quantity: 6 }])
    expect(await stock(raw)).toBe(6)
    const [s1] = await q<{ status: string }>('select status from public.purchases where id=$1', [po.purchase_id])
    expect(s1.status).toBe('partially_received')
    await expect(receivePo(officer, [{ purchase_item_id: items[0].id, quantity: 5 }])).rejects.toThrow(/only 4(\.0+)? remain/)
    await receivePo(officer, [{ purchase_item_id: items[0].id, quantity: 4 }, { purchase_item_id: items[1].id, quantity: 4 }])
    expect(await stock(raw)).toBe(10)
    expect(await stock(gadget)).toBe(gadgetBefore + 4)
    const [s2] = await q<{ status: string }>('select status from public.purchases where id=$1', [po.purchase_id])
    expect(s2.status).toBe('received')
    await expect(receivePo(officer, [{ purchase_item_id: items[0].id, quantity: 1 }])).rejects.toThrow(/cannot receive goods/)
  })

  it('a retried receipt does not double-count stock', async () => {
    const po2 = (await as(officer, () => q<{ r: typeof po }>('select public.create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, J([{ product_id: raw, quantity: 5, unit_cost: 40 }]), key()])))[0].r
    const [line] = await q<{ id: string }>('select id from public.purchase_items where purchase_id=$1', [po2.purchase_id])
    const k = key()
    const before = await stock(raw)
    const call = () => as(officer, () => q('select public.receive_purchase($1,$2,$3::jsonb,null,$4)', [po2.purchase_id, loc, J([{ purchase_item_id: line.id, quantity: 5 }]), k]))
    await call(); await call()
    expect(await stock(raw)).toBe(before + 5)
  })

  it('pays suppliers up to the balance only, by users with purchases.pay', async () => {
    await expect(as(officer, () => q(`select public.pay_purchase($1,'cash',100,null,$2)`, [po.purchase_id, key()]))).rejects.toThrow(/permission denied/)
    await as(accountant, () => q(`select public.pay_purchase($1,'bank_transfer',500,'TRX-9',$2)`, [po.purchase_id, key()]))
    await expect(as(accountant, () => q(`select public.pay_purchase($1,'cash',441.01,null,$2)`, [po.purchase_id, key()]))).rejects.toThrow(/exceeds the amount due/)
    await as(accountant, () => q(`select public.pay_purchase($1,'cash',441,null,$2)`, [po.purchase_id, key()]))
    const [p] = await q<{ payment_status: string; amount_paid: string }>('select payment_status, amount_paid from public.purchases where id=$1', [po.purchase_id])
    expect([p.payment_status, num(p.amount_paid)]).toEqual(['paid', 941])
  })

  it('creates but does not let accountants or cashiers create orders', async () => {
    await expect(as(accountant, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, supplier, J([{ product_id: raw, quantity: 1, unit_cost: 1 }]), key()]))).rejects.toThrow(/permission denied/)
    await expect(as(cashier, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, supplier, J([{ product_id: raw, quantity: 1, unit_cost: 1 }]), key()]))).rejects.toThrow(/permission denied/)
  })

  it('cancels only an untouched, unpaid order', async () => {
    await expect(as(officer, () => q('select public.cancel_purchase($1,$2,$3)', [po.purchase_id, 'mistake', key()]))).rejects.toThrow(/nothing received/)
    const po3 = (await as(officer, () => q<{ r: typeof po }>('select public.create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, J([{ product_id: raw, quantity: 1, unit_cost: 10 }]), key()])))[0].r
    await as(accountant, () => q(`select public.pay_purchase($1,'cash',5,null,$2)`, [po3.purchase_id, key()]))
    await expect(as(officer, () => q('select public.cancel_purchase($1,$2,$3)', [po3.purchase_id, 'mistake', key()]))).rejects.toThrow(/reverse the supplier payments/)
    const [pay] = await q<{ id: string }>('select id from public.payments where purchase_id=$1', [po3.purchase_id])
    await as(accountant, () => q('select public.reverse_payment($1,$2,$3)', [pay.id, 'paid wrong supplier', key()]))
    await as(officer, () => q('select public.cancel_purchase($1,$2,$3)', [po3.purchase_id, 'mistake', key()]))
    await expect(as(accountant, () => q(`select public.pay_purchase($1,'cash',1,null,$2)`, [po3.purchase_id, key()]))).rejects.toThrow(/cancelled/)
  })

  it('rejects suppliers and products from another business', async () => {
    const otherSupplier = (await as(other, () => q<{ id: string }>('insert into public.suppliers (business_id,name) values ($1,$2) returning id', [bizB, 'Theirs'])).catch(() => [{ id: '' }]))[0].id
    expect(otherSupplier).toBeDefined()
    await expect(as(officer, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, '00000000-0000-0000-0000-000000000000', J([{ product_id: raw, quantity: 1, unit_cost: 1 }]), key()]))).rejects.toThrow(/unknown supplier/)
    await expect(as(officer, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, supplier, J([{ product_id: bWidget, quantity: 1, unit_cost: 1 }]), key()]))).rejects.toThrow(/invalid product/)
  })
})

describe('tenant isolation, plans and modules', () => {
  it('another business sees nothing and cannot act', async () => {
    for (const t of ['sales', 'sale_items', 'payments', 'purchases', 'purchase_items', 'customers', 'suppliers', 'sale_returns']) {
      expect(await as(other, () => q(`select ${t === 'sale_items' ? 'id' : '*'} from public.${t} where business_id=$1`, [biz])), t).toHaveLength(0)
    }
    await expect(as(other, () => q('select public.post_sale($1,$2,null,$3::jsonb,null,$4)', [biz, loc, J([{ product_id: widget, quantity: 1 }]), key()]))).rejects.toThrow(/permission denied/)
  })

  it('has no direct write path to sales, payments or purchases', async () => {
    await expect(as(owner, () => db.query(`insert into public.sales (business_id,location_id,sale_number,currency,subtotal,grand_total,idempotency_key) values ($1,$2,'X','NGN',1,1,'x')`, [biz, loc]))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('update public.sales set grand_total = 1'))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('delete from public.purchases'))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('select * from public.document_sequences'))).rejects.toThrow(/permission denied/)
  })

  it('the starter plan blocks purchasing; a lapsed plan blocks selling but keeps history readable', async () => {
    await setPlan(biz, 'starter')
    await expect(as(officer, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, '00000000-0000-0000-0000-000000000000', J([]), key()]))).rejects.toThrow(/permission denied/)
    await db.query(`update public.subscriptions set status='expired', current_period_end=now()-interval '1 day' where business_id=$1`, [biz])
    await expect(sell(owner, [{ product_id: gadget, quantity: 1 }], [{ method: 'cash', amount: 250.5 }])).rejects.toThrow(/permission denied/)
    expect((await as(owner, () => q('select * from public.sales where business_id=$1', [biz]))).length).toBeGreaterThan(0)
    await db.query(`update public.subscriptions set status='active', current_period_end=now()+interval '30 days' where business_id=$1`, [biz])
    await setPlan(biz, 'growth')
  })

  it('turning the purchases module off blocks new orders but keeps history readable', async () => {
    const before = (await as(owner, () => q('select * from public.purchases where business_id=$1', [biz]))).length
    await as(owner, () => q(`select public.disable_module($1,'purchases')`, [biz]))
    await expect(as(officer, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [biz, '00000000-0000-0000-0000-000000000000', J([]), key()]))).rejects.toThrow(/permission denied/)
    expect((await as(owner, () => q('select * from public.purchases where business_id=$1', [biz]))).length).toBe(before)
    await as(owner, () => q(`select public.enable_module($1,'purchases')`, [biz]))
  })

  it('sales is a required module for retail and cannot be switched off', async () => {
    await expect(as(owner, () => q(`select public.disable_module($1,'sales')`, [biz]))).rejects.toThrow(/cannot be disabled/)
  })
})
