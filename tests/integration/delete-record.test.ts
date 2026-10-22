import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, cashier: string, accountant: string, outsider: string
let biz: string, loc: string, cat: string
let n = 0
const key = () => `del-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const del = (u: string, kind: string, id: string) => as(u, () => q('select public.delete_record($1,$2)', [kind, id]))
const exists = async (table: string, id: string) => (await q(`select 1 from public.${table} where id=$1`, [id])).length > 0
const product = (name: string) => as(owner, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,null,$2,null,null,null,null,$3,$4,$5,null,null,null,false,true,$6::jsonb,$7) as r', [biz, name, 'each', 500, 1000, '[{"name":"pack","units":6}]', key()])).then((r) => r[0].r.product_id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, cashier, accountant, outsider] = await Promise.all(['o', 'm', 'c', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('CityMart','retail') as id`)))[0].id
  await as(outsider, () => q(`select public.create_business('Other','retail')`))
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [cashier, 'cashier'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  cat = (await as(manager, () => q<{ id: string }>(`insert into public.product_categories (business_id,name) values ($1,'Groceries') returning id`, [biz])))[0].id
})

describe('deleting records that were never used', () => {
  it('deletes an unused customer and keeps a record of it in the audit log', async () => {
    const c = (await as(cashier, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Ada Obi') returning id`, [biz])))[0].id
    await del(cashier, 'customer', c)
    expect(await exists('customers', c)).toBe(false)
    const log = await q<{ metadata: { name: string } }>(`select metadata from public.audit_logs where entity_id=$1 and action='customers.delete'`, [c])
    expect(log).toHaveLength(1)
    expect(log[0].metadata.name).toBe('Ada Obi')
  })

  it('refuses to delete a customer who has bought something, and says to archive instead', async () => {
    const p = await product('Rice 1kg')
    await as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, JSON.stringify([{ product_id: p, quantity: 50, unit_cost: 500 }]), 'Opening', key()]))
    const c = (await q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Chidi Foods') returning id`, [biz]))[0].id
    await as(cashier, () => q('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6)', [biz, loc, c, JSON.stringify([{ product_id: p, quantity: 2 }]), JSON.stringify([{ method: 'cash', amount: 2000 }]), key()]))
    await expect(del(owner, 'customer', c)).rejects.toThrow(/cannot be deleted.*Archive it instead/)
    expect(await exists('customers', c)).toBe(true)
  })

  it('refuses a product with stock history but deletes one that was never used, with its packs', async () => {
    const used = (await q<{ id: string }>(`select id from public.products where name='Rice 1kg'`))[0].id
    await expect(del(owner, 'product', used)).rejects.toThrow(/cannot be deleted/)
    const fresh = await product('Unused Soap')
    expect(Number((await q<{ v: string }>('select count(*) as v from public.product_packs where product_id=$1', [fresh]))[0].v)).toBe(1)
    await del(owner, 'product', fresh)
    expect(await exists('products', fresh)).toBe(false)
    expect(Number((await q<{ v: string }>('select count(*) as v from public.product_packs where product_id=$1', [fresh]))[0].v)).toBe(0)
  })

  it('needs the right permission for each kind of record', async () => {
    const fresh = await product('Guarded Item')
    await expect(del(cashier, 'product', fresh)).rejects.toThrow(/permission denied/)
    await expect(del(accountant, 'product', fresh)).rejects.toThrow(/permission denied/)
    await expect(del(outsider, 'product', fresh)).rejects.toThrow(/permission denied/)
    const s = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'MedSupply') returning id`, [biz]))[0].id
    await expect(del(cashier, 'supplier', s)).rejects.toThrow(/permission denied/)
    await del(owner, 'supplier', s)
    expect(await exists('suppliers', s)).toBe(false)
    await del(owner, 'product', fresh)
  })

  it('refuses a supplier that has been bought from', async () => {
    const p = (await q<{ id: string }>(`select id from public.products where name='Rice 1kg'`))[0].id
    const s = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Alpha') returning id`, [biz]))[0].id
    await as(owner, () => q('select public.create_purchase($1,$2,$3::jsonb,$4,$5)', [biz, s, JSON.stringify([{ product_id: p, quantity: 5, unit_cost: 500 }]), 'PO', key()]))
    await expect(del(owner, 'supplier', s)).rejects.toThrow(/cannot be deleted/)
  })

  it('refuses a category that products use, and a location that has stock history', async () => {
    const p = (await q<{ id: string }>(`select id from public.products where name='Rice 1kg'`))[0].id
    await db.exec(`update public.products set category_id='${cat}' where id='${p}'`)
    await expect(del(manager, 'category', cat)).rejects.toThrow(/cannot be deleted/)
    await expect(del(owner, 'location', loc)).rejects.toThrow(/cannot be deleted/)
    const spare = (await q<{ id: string }>(`insert into public.inventory_locations (business_id,name) values ($1,'Spare shelf') returning id`, [biz]))[0].id
    await del(owner, 'location', spare)
    expect(await exists('inventory_locations', spare)).toBe(false)
  })

  it('never deletes an expense: money records are voided', async () => {
    await as(owner, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7)', [biz, 'rent', 5000, 'cash', 'October rent', new Date().toISOString().slice(0, 10), key()]))
    const e = (await q<{ id: string }>(`select id from public.expenses where business_id=$1 and description='October rent'`, [biz]))[0].id
    await expect(del(owner, 'expense', e)).rejects.toThrow(/unknown record type/)
    await expect(as(owner, () => q('delete from public.expenses where id=$1', [e]))).rejects.toThrow(/permission denied|cannot be deleted/)
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [e, 'entered by mistake', key()]))
    expect(await exists('expenses', e)).toBe(true) // a voided expense stays on record, outside every total
  })

  it('deletes a stock loss only after it was voided', async () => {
    const p = (await q<{ id: string }>(`select id from public.products where name='Rice 1kg'`))[0].id
    const r = (await as(owner, () => q<{ r: { loss_id: string } }>('select public.mart_record_loss($1,$2,$3,$4,$5,$6,$7) as r', [biz, p, loc, 1, 'damaged', 'torn bag', key()])))[0].r.loss_id
    await expect(del(owner, 'loss', r)).rejects.toThrow(/void this entry first/)
    await as(owner, () => q('select public.mart_void_loss($1,$2,$3)', [r, 'entered twice', key()]))
    await del(owner, 'loss', r)
    expect(await exists('stock_loss_records', r)).toBe(false)
  })

  it('deletes a lead, and refuses unknown kinds and other businesses records', async () => {
    const l = (await as(cashier, () => q<{ id: string }>(`insert into public.crm_leads (business_id,name) values ($1,'Walk-in lead') returning id`, [biz])))[0].id
    await expect(del(outsider, 'lead', l)).rejects.toThrow(/permission denied/)
    await del(cashier, 'lead', l)
    expect(await exists('crm_leads', l)).toBe(false)
    await expect(del(owner, 'planet', l)).rejects.toThrow(/unknown record type/)
  })
})
