import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, storekeeper: string, cashier: string, outsider: string
let biz: string, main: string, product: string
let n = 0
const key = () => `loc-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const add = (u: string, name: string, type = 'shelf') => as(u, () => q<{ id: string }>('insert into public.inventory_locations (business_id, name, location_type) values ($1,$2,$3) returning id', [biz, name, type])).then((r) => r[0].id)
const archive = (u: string, id: string) => as(u, () => q(`update public.inventory_locations set status='archived' where id=$1`, [id]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, storekeeper, cashier, outsider] = await Promise.all(['o', 's', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('CityMart','retail') as id`)))[0].id
  await as(outsider, () => q(`select public.create_business('Other','retail')`))
  for (const [u, role] of [[storekeeper, 'inventory_officer'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  main = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  product = (await as(owner, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,null,$2,null,null,null,null,$3,$4,$5,null,null,null,false,true,$6::jsonb,$7) as r', [biz, 'Rice 1kg', 'each', 500, 1000, '[]', key()])))[0].r.product_id
})

describe('stock locations', () => {
  it('starts every business with one Main store', async () => {
    const l = await q<{ name: string; status: string }>('select name, status from public.inventory_locations where business_id=$1', [biz])
    expect(l).toEqual([{ name: 'Main store', status: 'active' }])
  })

  it('lets staff who adjust stock add and rename locations; cashiers and outsiders cannot', async () => {
    const shelf = await add(storekeeper, 'Shelf 1')
    await as(storekeeper, () => q(`update public.inventory_locations set name='Front shelf' where id=$1`, [shelf]))
    expect((await q<{ name: string }>('select name from public.inventory_locations where id=$1', [shelf]))[0].name).toBe('Front shelf')
    await expect(add(cashier, 'Cashier shelf')).rejects.toThrow()
    await expect(as(outsider, () => q('insert into public.inventory_locations (business_id, name) values ($1,$2)', [biz, 'Intruder']))).rejects.toThrow()
    await expect(add(owner, 'front shelf')).resolves.toBeTruthy() // names are unique, not case-folded: a different spelling is allowed
    await expect(add(owner, 'Front shelf')).rejects.toThrow(/duplicate key|unique/)
  })

  it('refuses to archive a location that still holds stock, and allows it once it is empty', async () => {
    const cold = await add(owner, 'Cold room', 'warehouse')
    await as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, cold, JSON.stringify([{ product_id: product, quantity: 10, unit_cost: 500 }]), 'Delivery', key()]))
    await expect(archive(owner, cold)).rejects.toThrow(/move or sell the stock/)
    await as(owner, () => q(`select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5)`, [biz, cold, JSON.stringify([{ product_id: product, quantity: 10 }]), JSON.stringify([{ method: 'cash', amount: 10000 }]), key()]))
    await archive(owner, cold)
    expect((await q<{ status: string }>('select status from public.inventory_locations where id=$1', [cold]))[0].status).toBe('archived')
  })

  it('does not accept stock into an archived location', async () => {
    const old = (await q<{ id: string }>(`select id from public.inventory_locations where name='Cold room'`))[0].id
    await expect(as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, old, JSON.stringify([{ product_id: product, quantity: 1, unit_cost: 500 }]), 'x', key()]))).rejects.toThrow(/location/)
  })

  it('always keeps one active location', async () => {
    await db.exec(`update public.inventory_locations set status='archived' where business_id='${biz}' and id <> '${main}' and status='active'`)
    await expect(archive(owner, main)).rejects.toThrow(/at least one active location/)
  })

  it('can restore an archived location', async () => {
    const old = (await q<{ id: string }>(`select id from public.inventory_locations where name='Cold room'`))[0].id
    await as(owner, () => q(`update public.inventory_locations set status='active' where id=$1`, [old]))
    expect((await q<{ status: string }>('select status from public.inventory_locations where id=$1', [old]))[0].status).toBe('active')
  })
})
