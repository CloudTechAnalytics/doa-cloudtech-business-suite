import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, engineer: string, owner: string, other: string
let shop: string, school: string, keep: string, loc: string
let n = 0
const key = () => `pg-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)

/** How many rows in the whole database belong to a business, counted across every table that has a business_id column. */
async function rowsOf(b: string) {
  const tables = await q<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not like 'platform\\_%' order by 1`)
  let total = 0
  for (const { t } of tables) total += Number((await q<{ c: string }>(`select count(*) as c from public.${t} where business_id = $1`, [b]))[0].c)
  total += Number((await q<{ c: string }>('select count(*) as c from public.businesses where id = $1', [b]))[0].c)
  return total
}
const guardsOn = async () => Number((await q<{ c: string }>(`select count(*) as c from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not tg.tgisinternal and tg.tgenabled = 'D'`))[0].c)

beforeAll(async () => {
  db = await createDb()
  ;[root, engineer, owner, other] = await Promise.all(['root', 'eng', 'owner', 'other'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${engineer}', 'engineer')`)
  shop = (await as(owner, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
  school = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  keep = (await as(other, () => q<{ id: string }>(`select public.create_business('Neighbour Shop','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)

  // A shop with stock, a sale and a payment: these tables are append-only and must still be erasable by a purge.
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [shop]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [shop]))[0].id
  const widget = (await as(owner, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,tracks_stock) values ($1,$2,$3,$4,true) returning id', [shop, 'Widget', unit, 1000])))[0].id
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [shop, loc, J([{ product_id: widget, quantity: 20, unit_cost: 600 }]), key()]))
  await as(owner, () => q('select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5)', [shop, loc, J([{ product_id: widget, quantity: 2 }]), J([{ method: 'cash', amount: 2000 }]), key()]))

  // A school with students, bills and payments (more append-only tables, and a long chain of foreign keys).
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [school]))
  const cls = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [school]))[0].id
  await as(owner, () => q(`select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)`, [school, J({ first: 'Ada', last: 'Obi', class_id: cls, dob: '2018-05-01' }), J([{ name: 'Mrs Obi', email: 'obi@example.com', relationship: 'mother', primary: true }]), key()]))
  const term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1 and is_current', [school]))[0].id
  await as(owner, () => q(`select public.school_save_fee_item($1,null,'Tuition',50000,null,null,false,true)`, [school]))
  await as(owner, () => q('select public.school_generate_bills($1,$2,null,null,$3)', [school, term, key()]))
  const bill = (await q<{ id: string }>('select id from public.school_bills where business_id=$1', [school]))[0].id
  await as(owner, () => q(`select public.school_record_payment($1,10000,'cash',null,$2)`, [bill, key()]))

  // A neighbour's business that must not be touched.
  await as(other, () => q(`insert into public.customers (business_id,name) values ($1,'Neighbour customer')`, [keep]))
})

describe('permanently deleting a business', () => {
  it('has real data to delete in the append-only tables', async () => {
    expect(await rowsOf(shop)).toBeGreaterThan(10)
    expect(await rowsOf(school)).toBeGreaterThan(30)
    expect(Number((await q<{ c: string }>('select count(*) as c from public.payments where business_id=$1', [shop]))[0].c)).toBeGreaterThan(0)
    expect(Number((await q<{ c: string }>('select count(*) as c from public.stock_movements where business_id=$1', [shop]))[0].c)).toBeGreaterThan(0)
    expect(Number((await q<{ c: string }>('select count(*) as c from public.school_payments where business_id=$1', [school]))[0].c)).toBeGreaterThan(0)
  })

  it('is for platform owners only, needs the exact name and a reason', async () => {
    const call = (u: string, name: string, reason: string) => as(u, () => q('select public.platform_purge_business($1,$2,$3)', [shop, name, reason]))
    await expect(call(owner, 'Corner Shop', 'we asked')).rejects.toThrow(/permission denied/)
    await expect(call(engineer, 'Corner Shop', 'we asked')).rejects.toThrow(/permission denied/)
    await expect(call(root, 'Corner Shop', '')).rejects.toThrow(/say why/)
    await expect(call(root, 'corner shop', 'wrong case')).rejects.toThrow(/exactly/)
    await expect(call(root, 'Something else', 'wrong name')).rejects.toThrow(/exactly/)
    expect(await rowsOf(shop)).toBeGreaterThan(10) // nothing was deleted by the refused attempts
  })

  it('erases a shop completely, leaves the neighbour alone, and turns the guards back on', async () => {
    const neighbour = await rowsOf(keep)
    const r = (await as(root, () => q<{ r: { rows_deleted: number; tables: number } }>(`select public.platform_purge_business($1,'Corner Shop','Owner asked for permanent deletion, in writing') as r`, [shop])))[0].r
    expect(Number(r.rows_deleted)).toBeGreaterThan(10)
    expect(await rowsOf(shop)).toBe(0)
    expect(await rowsOf(keep)).toBe(neighbour)
    expect(await guardsOn()).toBe(0)
    await expect(db.exec(`insert into public.audit_logs (business_id, action, entity_type) values ('${keep}', 'x', 'y'); update public.audit_logs set action = 'z'`)).rejects.toThrow(/cannot be changed/)
  })

  it('erases a school completely, including its students, bills and payments', async () => {
    await as(root, () => q(`select public.platform_purge_business($1,'Bright School','School closed, records to be destroyed')`, [school]))
    expect(await rowsOf(school)).toBe(0)
    expect(Number((await q<{ c: string }>('select count(*) as c from public.school_students'))[0].c)).toBe(0)
    expect(await guardsOn()).toBe(0)
  })

  it('keeps the platform log of what was deleted and why, and says so in the audit list', async () => {
    const log = (await as(root, () => q<{ r: { action: string; business: string; reason: string }[] }>('select public.platform_audit(20) as r')))[0].r
    const purges = log.filter((l) => l.action === 'business.purge')
    expect(purges.map((p) => p.business).sort()).toEqual(['Bright School', 'Corner Shop'])
    expect(purges.find((p) => p.business === 'Corner Shop')!.reason).toBe('Owner asked for permanent deletion, in writing')
    await expect(as(root, () => q('select public.platform_purge_business($1,$2,$3)', [shop, 'Corner Shop', 'again']))).rejects.toThrow(/business not found/)
  })

  it('also works on a business that was already archived', async () => {
    const b = (await as(other, () => q<{ id: string }>(`select public.create_business('Old Bakery','bakery') as id`)))[0].id
    await as(root, () => q(`select public.platform_archive_business($1,'Closed first')`, [b]))
    await as(root, () => q(`select public.platform_purge_business($1,'Old Bakery','Now erase it for good')`, [b]))
    expect(await rowsOf(b)).toBe(0)
  })
})
