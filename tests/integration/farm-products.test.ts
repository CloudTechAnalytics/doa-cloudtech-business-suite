import { beforeAll, describe, expect, it } from 'vitest'
import * as farm from '@/demo/demoFarm'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { loadFarmProducts } from '@/industries/farm/services/farmApi'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

// ------------------------------------------------------------- database
let db: Db
let owner: string, manager: string, worker: string, cashier: string, other: string
let biz: string, bizB: string, loc: string, house: string
let n = 0
const key = () => `fp-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)

const create = (u: string, b: string, name: string, over: Partial<{ area: string; source: string; species: string | null; unit: string; price: number; k: string }> = {}) =>
  as(u, () => q<{ r: { product_id: string } }>('select public.farm_create_product($1,$2,null,$3,$4,$5,$6,$7,null,$8) as r',
    [b, name, over.area ?? 'poultry', over.source ?? 'produce', over.species ?? null, over.unit ?? 'each', over.price ?? 1800, over.k ?? key()])).then((r) => r[0].r.product_id)
const listed = () => q<{ id: string; name: string; available_quantity: string | null; source_kind: string; unit_code: string }>('select * from public.farm_products order by name')

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, worker, cashier, other] = await Promise.all(['o', 'm', 'w', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Greenfield','farm') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Their Farm','farm') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [worker, 'operations_staff'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  house = (await as(manager, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'House A','poultry_house','poultry') returning id`, [biz])))[0].id
})

describe('farm_create_product (database)', () => {
  it('lets the owner and a manager add a product; workers, cashiers and outsiders cannot', async () => {
    await create(owner, biz, 'Table eggs')
    await create(manager, biz, 'Catfish', { area: 'fish', unit: 'kg', price: 2500 })
    await expect(create(worker, biz, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(create(cashier, biz, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(create(other, biz, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(create(owner, bizB, 'Nope')).rejects.toThrow(/permission denied/)
  })

  it('creates a shared product plus a farm profile, and tracks stock only for produce', async () => {
    const id = await create(owner, biz, 'Smoked fish', { area: 'fish', unit: 'kg' })
    const [p] = await q<{ tracks_stock: boolean; product_type: string; selling_price: string }>('select tracks_stock, product_type, selling_price from public.products where id=$1', [id])
    expect(p).toMatchObject({ tracks_stock: true, product_type: 'finished_good' })
    const manure = await create(owner, biz, 'Manure', { area: 'general', source: 'other' })
    expect((await q<{ tracks_stock: boolean }>('select tracks_stock from public.products where id=$1', [manure]))[0].tracks_stock).toBe(false)
  })

  it('is idempotent: the same key creates one product', async () => {
    const k = key()
    const a = await create(owner, biz, 'Idem product', { k })
    const b = await create(owner, biz, 'Idem product', { k })
    expect(b).toBe(a)
    expect(await q('select 1 from public.products where business_id=$1 and name=$2', [biz, 'Idem product'])).toHaveLength(1)
  })

  it('validates name, price, unit and livestock species; rejects duplicate names', async () => {
    await expect(create(owner, biz, 'x')).rejects.toThrow(/at least 2 characters/)
    await expect(create(owner, biz, 'Neg', { price: -1 })).rejects.toThrow(/price cannot be negative/)
    await expect(create(owner, biz, 'BadUnit', { unit: 'parsec' })).rejects.toThrow(/unknown unit/)
    await expect(create(owner, biz, 'Live', { source: 'livestock', species: null, unit: 'each' })).rejects.toThrow(/species/)
    await expect(create(owner, biz, 'Table eggs')).rejects.toThrow(/duplicate|unique/)
  })

  it('derives availability: produce from stock on hand, livestock from active batches, other is null', async () => {
    const eggs = (await listed()).find((p) => p.name === 'Table eggs')!
    expect(Number(eggs.available_quantity)).toBe(0)
    await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: eggs.id, quantity: 40, unit_cost: 5 }]), key()]))
    const batch = (await as(manager, () => q<{ r: { batch_id: string } }>('select public.farm_start_batch($1,$2,$3,$4,null,$5,$6,$7,null,$8,$9) as r', [biz, house, 'L-1', 'Layer', 'poultry', 500, today, 'exact', key()])))[0].r.batch_id
    await create(owner, biz, 'Spent layers', { source: 'livestock', species: 'layer', unit: 'each' })
    await as(manager, () => q('select public.farm_record_mortality($1,$2,$3,$4,$5)', [batch, 20, 'disease', today, key()]))
    const after = await as(owner, listed)
    expect(Number(after.find((p) => p.name === 'Table eggs')!.available_quantity)).toBe(40)
    expect(Number(after.find((p) => p.name === 'Spent layers')!.available_quantity)).toBe(480)
    expect(after.find((p) => p.name === 'Manure')?.available_quantity ?? null).toBeNull()
  })

  it('shows another business only its own products', async () => {
    await create(other, bizB, 'Their eggs')
    const mine = await as(owner, listed)
    expect(mine.map((p) => p.name)).not.toContain('Their eggs')
    expect((await as(other, listed)).map((p) => p.name)).toEqual(['Their eggs'])
  })
})

describe('farm_update_product (database)', () => {
  it('lets the owner rename, reprice and deactivate; workers and outsiders cannot', async () => {
    const id = await create(owner, biz, 'Brown eggs')
    await as(owner, () => q('select public.farm_update_product($1,$2,$3,null,false)', [id, 'Brown eggs (crate)', 2000]))
    const [p] = await q<{ name: string; selling_price: string; status: string }>('select name, selling_price, status from public.products where id=$1', [id])
    expect(p).toMatchObject({ name: 'Brown eggs (crate)', status: 'archived' })
    expect(Number(p.selling_price)).toBe(2000)
    await expect(as(worker, () => q('select public.farm_update_product($1,$2,$3,null,true)', [id, 'Hacked', 1]))).rejects.toThrow(/permission denied/)
    await expect(as(other, () => q('select public.farm_update_product($1,$2,$3,null,true)', [id, 'Hacked', 1]))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q('select public.farm_update_product($1,$2,$3,null,true)', [id, 'Ok', -5]))).rejects.toThrow(/price cannot be negative/)
  })

  it('does not touch a product that has no farm profile', async () => {
    const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='kg'`, [biz]))[0].id
    const plain = (await as(owner, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,5) returning id', [biz, 'Plain', unit])))[0].id
    await expect(as(owner, () => q('select public.farm_update_product($1,$2,$3,null,true)', [plain, 'Renamed', 9]))).rejects.toThrow(/permission denied/)
  })
})

// ------------------------------------------------------------- demo mirror
const B = 'b-farm'
const dkey = () => `dfp-${n++}-abcdefgh`
const input = (name: string, over: Partial<farm.NewDemoProduct> = {}): farm.NewDemoProduct => ({ name, sku: '', area: 'poultry', source: 'produce', species: '', unit: 'each', price: 100, description: '', ...over })

describe('demo farm products mirror the database rules', () => {
  beforeAll(() => { demoSignIn('owner@demo.test', 'demo1234'); farm.ensureDemoFarm(B) })

  it('seeds starter products with profiles and derives availability', async () => {
    const list = await loadFarmProducts(B)
    expect(list.map((p) => p.name)).toEqual(expect.arrayContaining(['Table eggs (crate)', 'Catfish (kg)', 'Spent layers (live)']))
    expect(list.find((p) => p.name === 'Spent layers (live)')!.available).toBe(4820) // the seeded Layer batch: 5000 - 120 - 60
  })

  it('lets the owner add and edit; validates; rejects duplicates; is idempotent', async () => {
    const k = dkey()
    expect(farm.demoCreateFarmProduct(B, input('Duck eggs'), k)).toBeNull()
    expect(farm.demoCreateFarmProduct(B, input('Duck eggs'), k)).toBeNull() // same key: no second row
    expect((await loadFarmProducts(B)).filter((p) => p.name === 'Duck eggs')).toHaveLength(1)
    expect(farm.demoCreateFarmProduct(B, input('Duck eggs'), dkey())).toMatch(/duplicate key/)
    expect(farm.demoCreateFarmProduct(B, input('x'), dkey())).toMatch(/at least 2 characters/)
    expect(farm.demoCreateFarmProduct(B, input('Neg', { price: -1 }), dkey())).toMatch(/price cannot be negative/)
    expect(farm.demoCreateFarmProduct(B, input('Live x', { source: 'livestock' }), dkey())).toMatch(/species/)
    expect(farm.demoCreateFarmProduct(B, input('Manure', { source: 'other', area: 'general' }), dkey())).toBeNull()
    const manure = (await loadFarmProducts(B)).find((p) => p.name === 'Manure')!
    expect(manure.available).toBeNull()
    expect(farm.demoUpdateFarmProduct(B, manure.id, { name: 'Manure (bag)', price: 500, active: false })).toBeNull()
    const after = (await loadFarmProducts(B)).find((p) => p.id === manure.id)!
    expect(after).toMatchObject({ name: 'Manure (bag)', price: 500, active: false })
  })

  it('refuses a role without farm.manage', () => {
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    expect(farm.demoCreateFarmProduct('b-retail', input('Nope'), dkey())).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
  })
})
