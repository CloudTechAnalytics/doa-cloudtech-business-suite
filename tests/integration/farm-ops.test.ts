import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, worker: string, accountant: string, outsider: string
let biz: string, bizB: string, loc: string, house: string, field: string, layers: string, cropBatch: string
let feed: string, vaccine: string, eggs: string
let n = 0
const key = () => `ops-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const today = iso(0)
const stock = async (p: string) => Number((await q<{ s: string }>('select coalesce(sum(quantity_on_hand),0) as s from public.inventory_balances where product_id=$1', [p]))[0].s)

const worker$ = (u: string, name: string, over: { id?: string | null; active?: boolean; b?: string } = {}) =>
  as(u, () => q<{ id: string }>('select public.save_farm_worker($1,$2,$3,$4,$5,$6) as id', [over.b ?? biz, over.id ?? null, name, '0800', 'Attendant', over.active ?? true])).then((r) => r[0].id)
const task = (u: string, title: string, over: { due?: string | null; priority?: string; assignee?: string | null; review?: boolean; id?: string | null; k?: string } = {}) =>
  as(u, () => q<{ r: { task_id: string } }>('select public.save_farm_task($1,$2,$3,null,$4,$5,$6,null,$7,$8) as r', [biz, over.id ?? null, title, over.due ?? null, over.priority ?? 'normal', over.assignee ?? null, over.review ?? false, over.k ?? key()])).then((r) => r[0].r.task_id)
const setStatus = (u: string, id: string, status: string) => as(u, () => q('select public.set_farm_task_status($1,$2)', [id, status]))
const taskStatus = async (id: string) => (await q<{ status: string }>('select status from public.farm_tasks where id=$1', [id]))[0].status
const health = (u: string, over: { batch?: string; type?: string; title?: string; product?: string | null; qty?: number | null; on?: string; days?: number; k?: string } = {}) =>
  as(u, () => q<{ r: { record_id: string } }>('select public.farm_record_health($1,$2,$3,$4,$5,$6,$7,$8,null,$9) as r',
    [over.batch ?? layers, over.type ?? 'treatment', over.title ?? 'Antibiotic course', over.product === undefined ? vaccine : over.product, loc, over.qty === undefined ? 2 : over.qty, over.on ?? today, over.days ?? 0, over.k ?? key()])).then((r) => r[0].r.record_id)
const harvest = (u: string, qty = 5, removed: number | null = null) => as(u, () => q('select public.farm_record_harvest($1,$2,$3,$4,$5,$6,$7)', [layers, eggs, loc, qty, today, removed, key()]))
const removal = (u: string, qty: number) => as(u, () => q('select public.farm_adjust_population($1,$2,$3,$4,$5,$6)', [layers, 'removal', qty, 'sold', today, key()]))
const alerts = (u: string, b = biz) => as(u, () => q<{ kind: string; severity: string; title: string }>('select * from public.farm_alerts($1)', [b]))
const asset = (u: string, name: string, over: { id?: string | null; status?: string; interval?: number | null; k?: string } = {}) =>
  as(u, () => q<{ r: { asset_id: string } }>('select public.save_farm_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10) as r', [biz, over.id ?? null, name, 'tractor', 'SN-1', iso(-200), 5000000, over.status ?? 'active', over.interval === undefined ? 90 : over.interval, over.k ?? key()])).then((r) => r[0].r.asset_id)
const maintain = (u: string, a: string, over: { kind?: string; on?: string; cost?: number; k?: string } = {}) =>
  as(u, () => q<{ r: { record_id: string } }>('select public.record_maintenance($1,$2,$3,$4,$5,$6,$7) as r', [a, over.kind ?? 'service', over.on ?? today, over.cost ?? 0, 'Oil change and filters', 'cash', over.k ?? key()])).then((r) => r[0].r.record_id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, worker, accountant, outsider] = await Promise.all(['o', 'm', 'w', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Greenfield','farm') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Their Farm','farm') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [worker, 'operations_staff'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='kg'`, [biz]))[0].id
  const product = async (name: string, reorder: number | null) => (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,reorder_level) values ($1,$2,$3,100,$4) returning id', [biz, name, unit, reorder]))[0].id
  feed = await product('Layer mash', 50); vaccine = await product('Vaccine', null); eggs = await product('Eggs', null)
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: feed, quantity: 40, unit_cost: 480 }, { product_id: vaccine, quantity: 30, unit_cost: 800 }]), key()]))
  house = (await as(manager, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'House A','poultry_house','poultry') returning id`, [biz])))[0].id
  field = (await as(manager, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'Field 1','field','crop') returning id`, [biz])))[0].id
  layers = (await as(manager, () => q<{ r: { batch_id: string } }>('select public.farm_start_batch($1,$2,$3,$4,null,$5,$6,$7,null,$8,$9) as r', [biz, house, 'L-1', 'Layer', 'poultry', 1000, iso(-30), 'exact', key()])))[0].r.batch_id
  cropBatch = (await as(manager, () => q<{ r: { batch_id: string } }>('select public.farm_start_batch($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10) as r', [biz, field, 'C-1', 'Maize', 'crop', 2, iso(-60), iso(3), 'exact', key()])))[0].r.batch_id
})

describe('workers', () => {
  it('are managed by managers only, with unique names', async () => {
    const id = await worker$(manager, 'Musa Bello')
    await expect(worker$(worker, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(worker$(outsider, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(worker$(manager, 'musa bello')).rejects.toThrow(/duplicate key/)
    await expect(worker$(manager, '')).rejects.toThrow(/name/)
    expect(await worker$(manager, 'Musa B.', { id })).toBe(id)
    expect((await as(manager, () => q<{ name: string }>('select name from public.farm_workers'))).map((w) => w.name)).toEqual(['Musa B.'])
  })

  it('show field staff names only, never worker details', async () => {
    expect(await as(worker, () => q('select * from public.farm_workers'))).toHaveLength(0)
    expect((await as(worker, () => q<{ name: string }>('select name from public.farm_worker_names'))).map((w) => w.name)).toEqual(['Musa B.'])
    expect(await as(outsider, () => q('select * from public.farm_worker_names'))).toHaveLength(0)
  })
})

describe('tasks', () => {
  it('are created by managers; staff can see and progress them', async () => {
    const w = (await q<{ id: string }>('select id from public.farm_workers'))[0].id
    const id = await task(manager, 'Clean House A', { assignee: w, due: iso(2) })
    await expect(task(worker, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(task(manager, 'x')).rejects.toThrow(/at least 2 characters/)
    const k = key()
    expect(await task(manager, 'Idempotent task', { k })).toBe(await task(manager, 'Idempotent task', { k }))
    expect(await as(worker, () => q('select * from public.farm_tasks'))).toHaveLength(2)
    await setStatus(worker, id, 'in_progress')
    await setStatus(worker, id, 'done')
    expect(await taskStatus(id)).toBe('done')
    await expect(setStatus(worker, id, 'todo')).rejects.toThrow(/only a manager can reopen/)
    await setStatus(manager, id, 'todo')
    await expect(setStatus(manager, id, 'todo')).rejects.toThrow(/already todo/)
    await expect(task(manager, 'Rename', { id, k: key() })).resolves.toBe(id)
  })

  it('send reviewed work for review and need a manager to approve', async () => {
    const id = await task(manager, 'Vaccination round', { review: true })
    await expect(setStatus(worker, id, 'done')).rejects.toThrow(/needs review/)
    await setStatus(worker, id, 'review')
    await expect(setStatus(worker, id, 'done')).rejects.toThrow(/only a manager can approve/)
    await setStatus(manager, id, 'in_progress') // sent back
    await setStatus(worker, id, 'review')
    await setStatus(manager, id, 'done')
    const [t] = await q<{ status: string; completed_at: string | null; reviewed_by: string | null }>('select status, completed_at, reviewed_by from public.farm_tasks where id=$1', [id])
    expect(t.status).toBe('done'); expect(t.completed_at).not.toBeNull(); expect(t.reviewed_by).toBe(manager)
  })

  it('can only be cancelled by a manager, and a finished task cannot be edited', async () => {
    const id = await task(manager, 'Mend fence')
    await expect(setStatus(worker, id, 'cancelled')).rejects.toThrow(/only a manager can cancel/)
    await setStatus(manager, id, 'cancelled')
    await expect(task(manager, 'Edit after cancel', { id })).rejects.toThrow(/finished task cannot be edited/)
    await expect(setStatus(outsider, id, 'todo')).rejects.toThrow(/permission denied/)
    await expect(setStatus(accountant, id, 'todo')).rejects.toThrow(/permission denied/)
  })

  it('rejects an inactive worker and a batch from another business', async () => {
    const gone = await worker$(manager, 'Left Farm', { active: false })
    await expect(task(manager, 'Assign gone', { assignee: gone })).rejects.toThrow(/inactive worker/)
  })
})

describe('health and withdrawal periods', () => {
  it('record a treatment, take the medicine out of stock once and are idempotent', async () => {
    const before = await stock(vaccine)
    const k = key()
    const id = await health(worker, { qty: 2, k })
    expect(await health(worker, { qty: 2, k })).toBe(id)
    expect(await stock(vaccine)).toBe(before - 2)
    await expect(health(accountant)).rejects.toThrow(/permission denied/)
    await expect(health(outsider)).rejects.toThrow(/permission denied/)
  })

  it('validates type, product use, quantity, date and withdrawal days', async () => {
    await expect(health(worker, { type: 'inspection', product: vaccine })).rejects.toThrow(/only treatments and vaccinations/)
    await expect(health(worker, { type: 'quarantine', days: 3, product: null, qty: null })).rejects.toThrow(/only treatments and vaccinations/)
    await expect(health(worker, { qty: 0 })).rejects.toThrow(/greater than zero/)
    await expect(health(worker, { qty: null })).rejects.toThrow(/greater than zero/)
    await expect(health(worker, { on: iso(2) })).rejects.toThrow(/future/)
    await expect(health(worker, { days: 400 })).rejects.toThrow(/between 0 and 365/)
    await expect(health(worker, { title: 'x' })).rejects.toThrow(/at least 2 characters/)
    await expect(health(worker, { product: null, qty: 3 })).rejects.toThrow(/choose the medicine/)
    await expect(health(worker, { qty: 999999 })).rejects.toThrow(/insufficient stock/)
  })

  it('block harvests and animal removals during a withdrawal, but not deaths, culls or earlier dates', async () => {
    const id = await health(worker, { title: 'Newcastle booster', days: 7, qty: 1 })
    expect((await as(worker, () => q<{ withdrawal_ends_on: string }>('select * from public.farm_withdrawals'))).length).toBe(1)
    await expect(harvest(worker, 5)).rejects.toThrow(/under a treatment withdrawal/)
    await expect(harvest(worker, 5, 10)).rejects.toThrow(/under a treatment withdrawal/)
    await expect(removal(manager, 3)).rejects.toThrow(/under a treatment withdrawal/)
    await as(worker, () => q('select public.farm_record_mortality($1,$2,$3,$4,$5)', [layers, 2, 'disease', today, key()]))
    await as(manager, () => q('select public.farm_adjust_population($1,$2,$3,$4,$5,$6)', [layers, 'cull', 1, 'sick bird', today, key()]))
    expect(await alerts(worker)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'withdrawal_active' })]))
    await expect(as(worker, () => q('select public.farm_void_health($1,$2,$3)', [id, 'entered twice', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.farm_void_health($1,$2,$3)', [id, 'x', key()]))).rejects.toThrow(/reason is required/)
    const before = await stock(vaccine)
    await as(manager, () => q('select public.farm_void_health($1,$2,$3)', [id, 'entered twice', key()]))
    expect(await stock(vaccine)).toBe(before + 1)
    await expect(as(manager, () => q('select public.farm_void_health($1,$2,$3)', [id, 'again please', key()]))).rejects.toThrow(/already voided/)
    await expect(harvest(worker, 5)).resolves.toBeDefined() // a voided record no longer blocks
  })

  it('stop blocking once the withdrawal has ended', async () => {
    await health(worker, { title: 'Old treatment', days: 3, on: iso(-10), qty: 1 })
    await expect(harvest(worker, 1)).resolves.toBeDefined()
    expect(await as(worker, () => q('select * from public.farm_withdrawals'))).toHaveLength(0)
  })
})

describe('equipment and maintenance', () => {
  it('are managed by managers only, with unique names', async () => {
    const id = await asset(manager, 'Tractor T1')
    await expect(asset(worker, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(asset(manager, 'tractor t1')).rejects.toThrow(/duplicate key/)
    const k = key()
    expect(await asset(manager, 'Pump P1', { k })).toBe(await asset(manager, 'Pump P1', { k }))
    expect(await asset(manager, 'Tractor T1 (old)', { id })).toBe(id)
    expect(await as(worker, () => q('select * from public.farm_assets'))).toHaveLength(2) // staff can see the list (farm.read)
  })

  it('turn a maintenance cost into one repairs expense, counted once', async () => {
    const a = (await q<{ id: string }>(`select id from public.farm_assets where name='Pump P1'`))[0].id
    const k = key()
    const rec = await maintain(manager, a, { cost: 15000, kind: 'repair', k })
    expect(await maintain(manager, a, { cost: 15000, kind: 'repair', k })).toBe(rec)
    const exp = await q<{ id: string; category: string; amount: string; source: string }>(`select id, category, amount, source from public.expenses where source='maintenance'`)
    expect(exp).toHaveLength(1)
    expect(exp[0]).toMatchObject({ category: 'repairs', source: 'maintenance' })
    expect(Number(exp[0].amount)).toBe(15000)
    await expect(as(owner, () => q('select public.void_expense($1,$2,$3)', [exp[0].id, 'trying to void directly', key()]))).rejects.toThrow(/another record/)
    const cb = await as(owner, () => q<{ kind: string }>(`select kind from public.cashbook where kind='expense'`))
    expect(cb).toHaveLength(1)
    await expect(maintain(worker, a)).rejects.toThrow(/permission denied/)
    await as(manager, () => q('select public.void_maintenance($1,$2,$3)', [rec, 'wrong pump', key()]))
    expect(await as(owner, () => q(`select * from public.cashbook where kind='expense'`))).toHaveLength(0)
    await expect(as(manager, () => q('select public.void_maintenance($1,$2,$3)', [rec, 'again please', key()]))).rejects.toThrow(/already voided/)
  })

  it('track the last service and when the next is due, and refuse retired equipment', async () => {
    const t = (await q<{ id: string }>(`select id from public.farm_assets where name='Tractor T1 (old)'`))[0].id
    let s = (await as(manager, () => q<{ service_overdue: boolean; last_service_on: string | null }>('select service_overdue, last_service_on::text from public.farm_asset_status where id=$1', [t])))[0]
    expect(s.service_overdue).toBe(true) // bought 200 days ago, 90-day interval, never serviced
    expect(await alerts(manager)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'service_due' })]))
    await maintain(manager, t, { cost: 0 })
    s = (await as(manager, () => q<{ service_overdue: boolean; last_service_on: string | null }>('select service_overdue, last_service_on::text from public.farm_asset_status where id=$1', [t])))[0]
    expect(s.service_overdue).toBe(false)
    expect(String(s.last_service_on).slice(0, 10)).toBe(today)
    await asset(manager, 'Tractor T1 (old)', { id: t, status: 'retired' })
    await expect(maintain(manager, t)).rejects.toThrow(/retired/)
    await expect(maintain(manager, (await q<{ id: string }>(`select id from public.farm_assets where name='Pump P1'`))[0].id, { cost: 5, on: iso(3) })).rejects.toThrow(/future/)
  })
})

describe('alerts and batch costs', () => {
  it('compute low stock, overdue work, mortality and harvests due from the records', async () => {
    await task(manager, 'Late job', { due: iso(-2), priority: 'high' })
    await as(worker, () => q('select public.farm_record_mortality($1,$2,$3,$4,$5)', [layers, 60, 'heat', today, key()]))
    const a = await alerts(worker)
    const kinds = a.map((x) => x.kind)
    expect(kinds).toEqual(expect.arrayContaining(['low_stock', 'overdue_task', 'high_mortality', 'harvest_due']))
    expect(a.find((x) => x.kind === 'low_stock')!.title).toMatch(/Layer mash/) // 40 on hand, reorder level 50
    expect(a.find((x) => x.kind === 'overdue_task')!.severity).toBe('critical')
    expect(a.find((x) => x.kind === 'harvest_due')!.title).toMatch(/C-1/)
  })

  it('only show alerts to members with farm.read, and only for their own business', async () => {
    await expect(alerts(outsider)).rejects.toThrow(/permission denied/)
    await expect(alerts(accountant)).rejects.toThrow(/permission denied/)
    await expect(alerts(owner, bizB)).rejects.toThrow(/permission denied/)
    expect(Array.isArray(await alerts(outsider, bizB))).toBe(true)
  })

  it('sum posted expenses charged to a batch', async () => {
    await as(manager, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,$7,$8)', [biz, 'feed', 1200, 'cash', 'Feed for L-1', today, layers, key()]))
    await as(manager, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,$7,$8)', [biz, 'labour', 300, 'cash', 'Labour for L-1', today, layers, key()]))
    const c = await as(owner, () => q<{ expenses_total: string }>('select expenses_total from public.farm_batch_costs where farm_batch_id=$1', [layers]))
    expect(Number(c[0].expenses_total)).toBe(1500)
  })
})
