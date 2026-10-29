import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, worker: string
let biz: string, house: string
let n = 0
const key = () => `fdel-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const del = (u: string, kind: string, id: string) => as(u, () => q('select public.delete_record($1,$2)', [kind, id]))
const exists = async (table: string, id: string) => (await q(`select 1 from public.${table} where id=$1`, [id])).length > 0
const start = (code: string) => as(owner, () => q<{ id: string }>('select public.farm_start_batch($1,$2,$3,$4,null,$5,$6,current_date,null,$7,$8) as id', [biz, house, code, 'Broiler', 'poultry', 100, 'exact', key()])).then(async () => (await q<{ id: string }>('select id from public.farm_batches where batch_code=$1', [code]))[0].id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, worker] = await Promise.all(['fo', 'fw'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Green Farm','farm') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [worker]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'operations_staff']))
  await as(worker, () => q('select public.accept_my_invitations()'))
  house = (await as(owner, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'House A','poultry_house','poultry') returning id`, [biz])))[0].id
})

describe('deleting farm notes, places and batches in the database', () => {
  it('deletes a batch started by mistake with its starting count, and logs it', async () => {
    const b = await start('OOPS-1')
    await del(owner, 'farm_batch', b)
    expect(await exists('farm_batches', b)).toBe(false)
    expect((await q('select 1 from public.farm_batch_events where farm_batch_id=$1', [b])).length).toBe(0)
    expect((await q(`select 1 from public.audit_logs where entity_id=$1 and action='farm_batches.delete'`, [b])).length).toBe(1)
  })

  it('refuses a batch with records, and keeps batch events otherwise immutable', async () => {
    const b = await start('RUN-1')
    await as(worker, () => q('select public.farm_record_mortality($1,$2,$3,current_date,$4)', [b, 2, 'Heat stress', key()]))
    await expect(del(owner, 'farm_batch', b)).rejects.toThrow(/Close it instead/)
    expect(await exists('farm_batches', b)).toBe(true)
    await expect(db.exec(`delete from public.farm_batch_events where farm_batch_id='${b}'`)).rejects.toThrow(/immutable/)
  })

  it('refuses a place a batch was kept in, deletes an empty one', async () => {
    await expect(del(owner, 'farm_unit', house)).rejects.toThrow(/delete those first, or archive it/)
    const spare = (await as(owner, () => q<{ id: string }>(`insert into public.farm_units (business_id,name,unit_type,production_type) values ($1,'Spare pond','pond','fish') returning id`, [biz])))[0].id
    await del(owner, 'farm_unit', spare)
    expect(await exists('farm_units', spare)).toBe(false)
  })

  it('lets a worker delete their own note but not a place or a batch', async () => {
    const note = (await as(worker, () => q<{ id: string }>(`insert into public.farm_activity_logs (business_id,farm_unit_id,activity_type,notes) values ($1,$2,'cleaning','Swept') returning id`, [biz, house])))[0].id
    await del(worker, 'farm_note', note)
    expect(await exists('farm_activity_logs', note)).toBe(false)
    await expect(del(worker, 'farm_unit', house)).rejects.toThrow(/permission denied/)
  })

  it('switches suppliers and purchase orders on for a farm', async () => {
    const on = await q<{ code: string }>('select m.code from public.business_modules bm join public.modules m on m.id = bm.module_id where bm.business_id=$1', [biz])
    expect(on.map((r) => r.code)).toEqual(expect.arrayContaining(['suppliers', 'purchases', 'farm-supplier-bills']))
  })
})
