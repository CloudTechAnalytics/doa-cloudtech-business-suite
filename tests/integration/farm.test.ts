import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, worker: string, cashier: string, other: string
let biz: string, bizB: string, loc: string
let house: string, pond: string
let feed: string, eggs: string, service: string, bProduct: string
let n = 0
const key = () => `farm-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)

const startBatch = (u: string, code: string, unit = house, type = 'poultry', opening = 1000, basis = 'exact', k = key()) =>
  as(u, () => q<{ r: { batch_id: string } }>('select public.farm_start_batch($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10) as r', [biz, unit, code, 'Layer', null, type, opening, today, basis, k])).then((r) => r[0].r.batch_id)
const summary = async (batch: string) => (await q<Record<string, string>>('select * from public.farm_batch_summaries where id=$1', [batch]))[0]
const pop = async (batch: string) => Number((await summary(batch)).current_population)
const stock = async (p: string) => Number((await q<{ quantity_on_hand: string }>('select quantity_on_hand from public.inventory_balances where product_id=$1 and location_id=$2', [p, loc]))[0]?.quantity_on_hand ?? 0)
const mortality = (u: string, batch: string, qty: number, cause = 'disease', k = key()) => as(u, () => q<{ r: { event_id: string } }>('select public.farm_record_mortality($1,$2,$3,$4,$5) as r', [batch, qty, cause, today, k])).then((r) => r[0].r.event_id)
const feeding = (u: string, batch: string, qty: number, product = feed, k = key()) => as(u, () => q<{ r: { feed_id: string } }>('select public.farm_record_feeding($1,$2,$3,$4,$5,null,$6) as r', [batch, product, loc, qty, today, k])).then((r) => r[0].r.feed_id)
const harvest = (u: string, batch: string, qty: number, removed: number | null = null, k = key()) => as(u, () => q<{ r: { harvest_id: string } }>('select public.farm_record_harvest($1,$2,$3,$4,$5,$6,$7) as r', [batch, eggs, loc, qty, today, removed, k])).then((r) => r[0].r.harvest_id)
const newProduct = (u: string, b: string, name: string, tracks = true) => as(u, async () => {
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='kg'`, [b]))[0].id
  return (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,tracks_stock) values ($1,$2,$3,10,$4) returning id', [b, name, unit, tracks]))[0].id
})

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
  feed = await newProduct(owner, biz, 'Layer mash')
  eggs = await newProduct(owner, biz, 'Eggs')
  service = await newProduct(owner, biz, 'Service', false)
  bProduct = await newProduct(other, bizB, 'Their feed')
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: feed, quantity: 500, unit_cost: 400 }]), key()]))
  house = (await as(manager, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type,capacity) values ($1,'House A','poultry_house','poultry',2000) returning id`, [biz])))[0].id
  pond = (await as(manager, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'Pond 1','pond','fish') returning id`, [biz])))[0].id
})

describe('production units and batches', () => {
  it('only farm.manage can create units; workers and cashiers cannot', async () => {
    await expect(as(worker, () => q(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'X','pen','livestock')`, [biz]))).rejects.toThrow(/row-level security/)
    await expect(as(cashier, () => q('select * from public.farm_units'))).resolves.toHaveLength(0)
  })

  it('starts a batch with its opening event, once per idempotency key', async () => {
    const k = key()
    const a = await startBatch(manager, 'B-001', house, 'poultry', 1000, 'exact', k)
    const b = await startBatch(manager, 'B-001', house, 'poultry', 1000, 'exact', k)
    expect(b).toBe(a)
    expect(await pop(a)).toBe(1000)
    expect((await q('select 1 from public.farm_batch_events where farm_batch_id=$1', [a])).length).toBe(1)
  })

  it('rejects a unit/production mismatch, duplicate codes, bad quantities and unauthorised users', async () => {
    await expect(startBatch(manager, 'B-002', pond, 'poultry')).rejects.toThrow(/is for fish production/)
    await expect(startBatch(manager, 'B-001')).rejects.toThrow(/duplicate key/)
    await expect(startBatch(manager, 'B-003', house, 'poultry', 0)).rejects.toThrow(/check constraint/)
    await expect(startBatch(worker, 'B-004')).rejects.toThrow(/permission denied/)
  })
})

describe('population ledger', () => {
  let batch: string
  beforeAll(async () => { batch = await startBatch(manager, 'POP-1', house, 'poultry', 100) })

  it('workers can record mortality; the population and rate follow the ledger', async () => {
    await mortality(worker, batch, 4)
    await mortality(worker, batch, 6, 'heat stress')
    const s = await summary(batch)
    expect([Number(s.current_population), Number(s.mortality_total), Number(s.entering_total)]).toEqual([90, 10, 100])
  })

  it('refuses mortality above the population on exact counts, and requires a cause', async () => {
    await expect(mortality(worker, batch, 91)).rejects.toThrow(/only 90 remain/)
    await expect(mortality(worker, batch, 1, '')).rejects.toThrow(/cause is required/)
    await expect(mortality(worker, batch, 0)).rejects.toThrow(/greater than zero/)
    expect(await pop(batch)).toBe(90)
  })

  it('a retried mortality record is not counted twice', async () => {
    const k = key()
    await mortality(worker, batch, 2, 'disease', k)
    await mortality(worker, batch, 2, 'disease', k)
    expect(await pop(batch)).toBe(88)
  })

  it('corrections are new rows that fold back into mortality (never edits)', async () => {
    const ev = await mortality(manager, batch, 3, 'counted twice')
    expect(Number((await summary(batch)).mortality_total)).toBe(15)
    await as(manager, () => q('select public.farm_reverse_event($1,$2,$3)', [ev, 'entered twice', key()]))
    const s = await summary(batch)
    expect([Number(s.current_population), Number(s.mortality_total)]).toEqual([88, 12])
    await expect(as(manager, () => q('select public.farm_reverse_event($1,$2,$3)', [ev, 'again', key()]))).rejects.toThrow(/already reversed/)
    await expect(as(worker, () => q('select public.farm_reverse_event($1,$2,$3)', [ev, 'worker', key()]))).rejects.toThrow(/permission denied/)
  })

  it('does not allow reversing the opening event', async () => {
    const [open] = await q<{ id: string }>(`select id from public.farm_batch_events where farm_batch_id=$1 and event_type='opening'`, [batch])
    await expect(as(manager, () => q('select public.farm_reverse_event($1,$2,$3)', [open.id, 'nope', key()]))).rejects.toThrow(/cannot be reversed/)
  })

  it('culling and manual adjustments need farm.manage', async () => {
    await expect(as(worker, () => q(`select public.farm_adjust_population($1,'cull',1,'sick',$2,$3)`, [batch, today, key()]))).rejects.toThrow(/permission denied/)
    await as(manager, () => q(`select public.farm_adjust_population($1,'cull',2,'sick birds culled',$2,$3)`, [batch, today, key()]))
    expect(await pop(batch)).toBe(86)
    await as(manager, () => q(`select public.farm_adjust_population($1,'adjustment',1,'recount found one more',$2,$3)`, [batch, today, key()]))
    expect(await pop(batch)).toBe(87)
  })

  it('estimated fish counts record an explicit adjustment instead of refusing or hiding the shortfall', async () => {
    const fish = await startBatch(manager, 'FISH-1', pond, 'fish', 100, 'estimated')
    await as(manager, () => q(`select public.farm_adjust_population($1,'removal',120,'sold whole batch',$2,$3)`, [fish, today, key()]))
    expect(await pop(fish)).toBe(0)
    const adj = await q<{ reason: string; quantity: string }>(`select reason, quantity from public.farm_batch_events where farm_batch_id=$1 and event_type='adjustment'`, [fish])
    expect(adj).toHaveLength(1)
    expect(adj[0].reason).toMatch(/exceeded the estimated population/)
    expect(Number(adj[0].quantity)).toBe(20)
  })

  it('events are immutable and there is no direct write path', async () => {
    await expect(db.query('update public.farm_batch_events set quantity = 5')).rejects.toThrow(/immutable/)
    await expect(db.query('delete from public.farm_batch_events')).rejects.toThrow(/immutable/)
    await expect(as(manager, () => q(`insert into public.farm_batch_events (business_id,farm_batch_id,event_type,quantity,reason) values ($1,$2,'adjustment',50,'sneaky')`, [biz, batch]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q(`insert into public.farm_batches (business_id,farm_unit_id,batch_code,production_type,species_or_crop,opening_quantity,start_date) values ($1,$2,'X','poultry','x',5,current_date)`, [biz, house]))).rejects.toThrow(/permission denied/)
  })
})

describe('feeding uses the shared inventory exactly once', () => {
  let batch: string
  beforeAll(async () => { batch = await startBatch(manager, 'FEED-1', house, 'poultry', 200) })

  it('deducts stock and records the batch feed total', async () => {
    const before = await stock(feed)
    await feeding(worker, batch, 50)
    expect(await stock(feed)).toBe(before - 50)
    expect(Number((await summary(batch)).feed_total)).toBe(50)
    const [m] = await q<{ movement_type: string; quantity_delta: string }>(`select movement_type, quantity_delta from public.stock_movements where source_type='farm_feed' order by created_at desc limit 1`)
    expect(m).toEqual({ movement_type: 'production_consumption', quantity_delta: '-50.0000' })
  })

  it('a retried request does not deduct twice', async () => {
    const before = await stock(feed)
    const k = key()
    await feeding(worker, batch, 10, feed, k); await feeding(worker, batch, 10, feed, k)
    expect(await stock(feed)).toBe(before - 10)
  })

  it('refuses more than is in stock and leaves no partial record', async () => {
    const records = (await q('select 1 from public.farm_feed_records')).length
    await expect(feeding(worker, batch, 99999)).rejects.toThrow(/insufficient stock/)
    expect((await q('select 1 from public.farm_feed_records')).length).toBe(records)
  })

  it('rejects non-stock products, other businesses products and unauthorised users', async () => {
    await expect(feeding(worker, batch, 1, service)).rejects.toThrow(/invalid feed product/)
    await expect(feeding(worker, batch, 1, bProduct)).rejects.toThrow(/invalid feed product/)
    await expect(feeding(cashier, batch, 1)).rejects.toThrow(/permission denied/)
  })

  it('voiding restores the stock and the feed total, once, and only for managers', async () => {
    const id = await feeding(worker, batch, 20)
    const before = await stock(feed)
    await expect(as(worker, () => q('select public.farm_void_feeding($1,$2,$3)', [id, 'mistake', key()]))).rejects.toThrow(/permission denied/)
    await as(manager, () => q('select public.farm_void_feeding($1,$2,$3)', [id, 'wrong batch', key()]))
    expect(await stock(feed)).toBe(before + 20)
    await expect(as(manager, () => q('select public.farm_void_feeding($1,$2,$3)', [id, 'again', key()]))).rejects.toThrow(/already voided/)
    expect(await as(owner, () => q('select * from public.inventory_reconcile($1)', [biz]))).toHaveLength(0)
  })
})

describe('harvests add produce to the shared inventory', () => {
  let batch: string
  beforeAll(async () => { batch = await startBatch(manager, 'HARV-1', house, 'poultry', 300) })

  it('adds produce to stock and records the harvest total', async () => {
    const before = await stock(eggs)
    await harvest(worker, batch, 40)
    expect(await stock(eggs)).toBe(before + 40)
    expect(Number((await summary(batch)).harvest_total)).toBe(40)
  })

  it('harvesting live animals also removes them from the population, atomically', async () => {
    const stockBefore = await stock(eggs); const popBefore = await pop(batch)
    await harvest(worker, batch, 100, 25)
    expect(await pop(batch)).toBe(popBefore - 25)
    expect(await stock(eggs)).toBe(stockBefore + 100)
    // more animals than exist: nothing is posted at all
    await expect(harvest(worker, batch, 5, 99999)).rejects.toThrow(/remain in batch/)
    expect(await stock(eggs)).toBe(stockBefore + 100)
    expect(await pop(batch)).toBe(popBefore - 25)
  })

  it('a retried harvest is not added twice', async () => {
    const before = await stock(eggs); const k = key()
    await harvest(worker, batch, 7, null, k); await harvest(worker, batch, 7, null, k)
    expect(await stock(eggs)).toBe(before + 7)
  })

  it('voiding removes the produce and corrects the population', async () => {
    const id = await harvest(worker, batch, 10, 5)
    const [stockBefore, popBefore] = [await stock(eggs), await pop(batch)]
    await as(manager, () => q('select public.farm_void_harvest($1,$2,$3)', [id, 'entered in error', key()]))
    expect(await stock(eggs)).toBe(stockBefore - 10)
    expect(await pop(batch)).toBe(popBefore + 5)
  })

  it('cannot void a harvest whose produce has already been used', async () => {
    const id = await harvest(worker, batch, 3)
    await db.exec(`select public._post_movement('${biz}','${eggs}','${loc}','sale',-${await stock(eggs)},null,'sale',null,gen_random_uuid(),null)`)
    await expect(as(manager, () => q('select public.farm_void_harvest($1,$2,$3)', [id, 'oops', key()]))).rejects.toThrow(/insufficient stock/)
    await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: eggs, quantity: 500 }]), key()]))
  })

  it('a harvest-linked event cannot be reversed on its own', async () => {
    const [ev] = await q<{ id: string }>(`select removal_event_id as id from public.farm_harvests where removal_event_id is not null and status='posted' limit 1`)
    await expect(as(manager, () => q('select public.farm_reverse_event($1,$2,$3)', [ev.id, 'direct', key()]))).rejects.toThrow(/void the harvest/)
  })
})

describe('closing a batch', () => {
  it('requires explicit confirmation to write off remaining animals, then locks the batch', async () => {
    const batch = await startBatch(manager, 'CLOSE-1', house, 'poultry', 50)
    await expect(as(manager, () => q('select public.farm_close_batch($1,$2,false,$3)', [batch, 'cycle finished', key()]))).rejects.toThrow(/50 animals remain/)
    await expect(as(worker, () => q('select public.farm_close_batch($1,$2,true,$3)', [batch, 'x', key()]))).rejects.toThrow(/permission denied/)
    await as(manager, () => q('select public.farm_close_batch($1,$2,true,$3)', [batch, 'cycle finished', key()]))
    const s = await summary(batch)
    expect([s.status, Number(s.current_population)]).toEqual(['closed', 0])
    await expect(mortality(worker, batch, 1)).rejects.toThrow(/is closed/)
    await expect(feeding(worker, batch, 1)).rejects.toThrow(/is closed/)
    await expect(harvest(worker, batch, 1)).rejects.toThrow(/is closed/)
    await expect(as(manager, () => q('select public.farm_close_batch($1,$2,true,$3)', [batch, 'again', key()]))).rejects.toThrow(/already closed/)
  })
})

describe('daily log, modules and tenant boundaries', () => {
  it('workers can log activity, and the creator is set by the database', async () => {
    const batch = (await q<{ id: string }>(`select id from public.farm_batches where batch_code='B-001'`))[0].id
    const r = await as(worker, () => q<{ created_by: string }>(`insert into public.farm_activity_logs (business_id,farm_batch_id,activity_type,notes) values ($1,$2,'water_check','pH 7.1') returning created_by`, [biz, batch]))
    expect(r[0].created_by).toBe(worker)
    await expect(as(worker, () => q('insert into public.farm_activity_logs (business_id,farm_batch_id,activity_type,notes,created_by) values ($1,$2,$3,$4,$5)', [biz, batch, 'other', 'x', owner]))).rejects.toThrow(/permission denied/)
    await expect(as(cashier, () => q(`insert into public.farm_activity_logs (business_id,farm_batch_id,activity_type,notes) values ($1,$2,'other','x')`, [biz, batch]))).rejects.toThrow(/row-level security/)
  })

  it('another business sees nothing and cannot act on this farm', async () => {
    const batch = (await q<{ id: string }>(`select id from public.farm_batches where batch_code='B-001'`))[0].id
    for (const t of ['farm_units', 'farm_batches', 'farm_batch_events', 'farm_feed_records', 'farm_harvests', 'farm_activity_logs', 'farm_batch_summaries']) {
      expect(await as(other, () => q(`select * from public.${t} where business_id=$1`, [biz])), t).toHaveLength(0)
    }
    await expect(mortality(other, batch, 1)).rejects.toThrow(/permission denied/)
    await expect(as(other, () => q('select public.farm_start_batch($1,$2,$3,$4,null,$5,5,$6,null,null,$7)', [biz, house, 'HACK', 'x', 'poultry', today, key()]))).rejects.toThrow(/permission denied/)
  })

  it('cannot start a batch in another business production unit (composite foreign key / unit check)', async () => {
    const theirs = (await as(other, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'House','poultry_house','poultry') returning id`, [bizB])))[0].id
    await expect(startBatch(manager, 'CROSS-1', theirs)).rejects.toThrow(/unknown or archived production unit/)
  })

  it('switching the feeding module off blocks new feeding but keeps history readable', async () => {
    const batch = (await q<{ id: string }>(`select id from public.farm_batches where batch_code='FEED-1'`))[0].id
    await as(owner, () => q(`select public.disable_module($1,'farm-feeding')`, [biz]))
    await expect(feeding(worker, batch, 1)).rejects.toThrow(/permission denied/)
    expect((await as(worker, () => q('select * from public.farm_feed_records where business_id=$1', [biz]))).length).toBeGreaterThan(0)
    await as(owner, () => q(`select public.enable_module($1,'farm-feeding')`, [biz]))
  })

  it('the farm module cannot be used on a retail business', async () => {
    const retail = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    await expect(as(owner, () => q(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'X','pen','livestock')`, [retail]))).rejects.toThrow(/row-level security/)
  })

  it('stock stays reconciled with the ledger after all farm operations', async () => {
    expect(await as(owner, () => q('select * from public.inventory_reconcile($1)', [biz]))).toHaveLength(0)
  })

  it('audits farm changes', async () => {
    const actions = new Set((await as(owner, () => q<{ action: string }>('select action from public.audit_logs where business_id=$1', [biz]))).map((a) => a.action))
    for (const a of ['farm_units.insert', 'farm_batches.insert', 'farm_feed_records.insert', 'farm_harvests.insert']) expect(actions, a).toContain(a)
  })
})
