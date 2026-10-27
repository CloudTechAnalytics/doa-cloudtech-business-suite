import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, viewer: string, other: string
let biz: string, customer: string
let n = 0
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
type Stage = { id: string; name: string; kind: string; probability: number; position: number; deals: number }
const stages = async (b = biz) => (await as(owner, () => q<{ r: Stage[] }>('select public.crm_list_stages($1) as r', [b])))[0].r
const sid = async (name: string, b = biz) => (await stages(b)).find((s) => s.name === name)!.id
const fresh = async () => (await as(owner, () => q<{ id: string }>(`select public.create_business('CRM ${n++}','general') as id`)))[0].id
const saveStage = (u: string, b: string, id: string | null, name: string, p: number) => as(u, () => q<{ id: string }>('select public.crm_save_stage($1,$2,$3,$4) as id', [b, id, name, p])).then((r) => r[0].id)
const deal = (b: string, title = `Deal ${n++}`, value = 1000, cust = customer) => as(owner, () => q<{ id: string }>('select public.crm_save_deal($1,null,$2,$3,null,$4,null,null,$5) as id', [b, title, cust, value, ''])).then((r) => r[0].id)
const imp = (u: string, b: string, kind: string, r: unknown[]) => as(u, () => q<{ r: { created: number; duplicates: number[]; invalid: { row: number; reason: string }[] } }>('select public.crm_import($1,$2,$3::jsonb) as r', [b, kind, JSON.stringify(r)])).then((x) => x[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, viewer, other] = await Promise.all(['o', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = await fresh()
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [viewer]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'viewer'])); await as(viewer, () => q('select public.accept_my_invitations()'))
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Acme') returning id`, [biz])))[0].id
})

describe('pipeline stages', () => {
  it('start with the six usual stages and their chances, Won and Lost last', async () => {
    expect((await stages()).map((s) => `${s.name}:${s.probability}:${s.kind}`)).toEqual(['New:10:open', 'Qualified:25:open', 'Proposal:50:open', 'Negotiation:75:open', 'Won:100:won', 'Lost:0:lost'])
  })

  it('can be added, renamed and given a different chance of winning, but not duplicated', async () => {
    const b = await fresh()
    const visit = await saveStage(owner, b, null, 'Site visit', 40)
    let list = await stages(b); expect(list.map((s) => s.name)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Site visit', 'Won', 'Lost'])
    await saveStage(owner, b, visit, 'Survey', 35)
    list = await stages(b); expect(list.find((s) => s.id === visit)).toMatchObject({ name: 'Survey', probability: 35 })
    await expect(saveStage(owner, b, null, ' survey ', 10)).rejects.toThrow(/already a stage with this name/)
    await expect(saveStage(owner, b, null, '  ', 10)).rejects.toThrow(/enter a name/)
    await expect(saveStage(owner, b, null, 'X', 101)).rejects.toThrow(/between 0 and 100/)
  })

  it('keep Won at 100 and Lost at 0: only their names can change', async () => {
    const b = await fresh()
    const won = await sid('Won', b)
    await saveStage(owner, b, won, 'Closed won', 5)
    expect((await stages(b)).find((s) => s.id === won)).toMatchObject({ name: 'Closed won', probability: 100, kind: 'won' })
  })

  it('can be reordered, and the order must list every open stage once', async () => {
    const b = await fresh()
    const open = (await stages(b)).filter((s) => s.kind === 'open').map((s) => s.id)
    await as(owner, () => q('select public.crm_reorder_stages($1,$2::uuid[])', [b, [...open].reverse()]))
    expect((await stages(b)).filter((s) => s.kind === 'open').map((s) => s.name)).toEqual(['Negotiation', 'Proposal', 'Qualified', 'New'])
    await expect(as(owner, () => q('select public.crm_reorder_stages($1,$2::uuid[])', [b, open.slice(1)]))).rejects.toThrow(/every open stage once/)
    await expect(as(owner, () => q('select public.crm_reorder_stages($1,$2::uuid[])', [b, [open[0], open[0], open[1], open[2]]]))).rejects.toThrow(/every open stage once/)
  })

  it('cannot be removed while deals are in them, nor Won or Lost, nor the last open stage; an empty one can', async () => {
    const b = await fresh()
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'C') returning id`, [b])))[0].id
    const d = await deal(b, 'In New', 100, c)
    const del = (id: string) => as(owner, () => q('select public.crm_delete_stage($1)', [id]))
    await expect(del(await sid('New', b))).rejects.toThrow(/move the deals out of this stage/)
    await expect(del(await sid('Won', b))).rejects.toThrow(/always part of the pipeline/)
    await del(await sid('Negotiation', b)); expect((await stages(b)).map((s) => s.name)).not.toContain('Negotiation')
    for (const name of ['Qualified', 'Proposal']) await del(await sid(name, b))
    await expect(del(await sid('New', b))).rejects.toThrow(/move the deals|at least one open stage/)
    void d
  })

  it('are per business, and only people who manage customers can change them', async () => {
    const b = await fresh()
    await expect(saveStage(viewer, biz, null, 'Nope', 10)).rejects.toThrow(/permission denied/)
    await expect(saveStage(other, biz, null, 'Nope', 10)).rejects.toThrow(/permission denied/)
    await saveStage(owner, b, null, 'Only here', 10)
    expect((await stages()).map((s) => s.name)).not.toContain('Only here')
    expect((await as(other, () => q('select id from public.crm_stages where business_id=$1', [biz]))).length).toBe(0)
    await expect(as(owner, () => q('update public.crm_stages set probability = 99 where business_id=$1', [biz]))).rejects.toThrow()
  })
})

describe('activities', () => {
  it('can be calls, meetings, emails or to-dos, on a customer, a lead or a deal, with an outcome when done', async () => {
    const d = await deal(biz)
    await as(owner, () => q(`insert into public.crm_tasks (business_id, deal_id, kind, title, due_at) values ($1,$2,'call','Call about the deal', now() + interval '1 day')`, [biz, d]))
    await as(owner, () => q(`insert into public.crm_tasks (business_id, customer_id, kind, title) values ($1,$2,'meeting','Meet Acme')`, [biz, customer]))
    const t = (await q<{ id: string; kind: string; deal_id: string | null }>(`select id, kind, deal_id from public.crm_tasks where business_id=$1 and deal_id=$2`, [biz, d]))[0]
    expect(t).toMatchObject({ kind: 'call', deal_id: d })
    await as(owner, () => q(`update public.crm_tasks set status='done', outcome='Agreed on price' where id=$1`, [t.id]))
    expect((await q<{ outcome: string; completed_at: string | null }>('select outcome, completed_at from public.crm_tasks where id=$1', [t.id]))[0]).toMatchObject({ outcome: 'Agreed on price' })
    expect((await q<{ completed_at: string | null }>('select completed_at from public.crm_tasks where id=$1', [t.id]))[0].completed_at).not.toBeNull()
  })

  it('must be about something, and only about this business', async () => {
    await expect(as(owner, () => q(`insert into public.crm_tasks (business_id, title) values ($1,'Floating')`, [biz]))).rejects.toThrow()
    const other2 = await fresh(); const od = await deal(other2, 'Elsewhere', 1, (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'E') returning id`, [other2])))[0].id)
    await expect(as(owner, () => q(`insert into public.crm_tasks (business_id, deal_id, title) values ($1,$2,'Wrong business')`, [biz, od]))).rejects.toThrow()
    await expect(as(owner, () => q(`insert into public.crm_tasks (business_id, customer_id, kind, title) values ($1,$2,'fax','Bad kind')`, [biz, customer]))).rejects.toThrow()
  })

  it('can be logged on a deal as calls, meetings and notes, but only by people who manage customers', async () => {
    const d = await deal(biz)
    await as(owner, () => q(`insert into public.crm_interactions (business_id, deal_id, kind, summary) values ($1,$2,'meeting','Met on site')`, [biz, d]))
    expect((await as(viewer, () => q('select kind from public.crm_interactions where deal_id=$1', [d]))).length).toBe(1)
    await expect(as(viewer, () => q(`insert into public.crm_interactions (business_id, deal_id, kind, summary) values ($1,$2,'call','x')`, [biz, d]))).rejects.toThrow()
    await expect(as(owner, () => q(`insert into public.crm_interactions (business_id, deal_id, kind, summary) values ($1,$2,'telepathy','x')`, [biz, d]))).rejects.toThrow()
  })

  it('a deal gets a next step, kept by the database', async () => {
    const d = await deal(biz)
    await as(owner, () => q('select public.crm_set_next_step($1,$2)', [d, 'Send proposal Friday']))
    expect((await q<{ next_step: string }>('select next_step from public.crm_deals where id=$1', [d]))[0].next_step).toBe('Send proposal Friday')
    await expect(as(viewer, () => q('select public.crm_set_next_step($1,$2)', [d, 'x']))).rejects.toThrow(/permission denied/)
  })
})

describe('leads', () => {
  it('can be rated hot, warm or cold and given an owner who is on the business', async () => {
    const l = (await as(owner, () => q<{ id: string }>(`insert into public.crm_leads (business_id, name, rating, owner_id) values ($1,'Hot one','hot',$2) returning id`, [biz, owner])))[0].id
    expect((await q<{ rating: string; owner_id: string }>('select rating, owner_id from public.crm_leads where id=$1', [l]))[0]).toEqual({ rating: 'hot', owner_id: owner })
    await as(owner, () => q(`update public.crm_leads set rating='cold', owner_id=null where id=$1`, [l]))
    await expect(as(owner, () => q(`update public.crm_leads set rating='lukewarm' where id=$1`, [l]))).rejects.toThrow()
    await expect(as(owner, () => q(`update public.crm_leads set owner_id=$2 where id=$1`, [l, other]))).rejects.toThrow()
  })
})

describe('import', () => {
  it('adds customers and leads, skips duplicates by email (any case) or phone, and reports rows it cannot read', async () => {
    const b = await fresh()
    await as(owner, () => q(`insert into public.customers (business_id,name,email,phone) values ($1,'Existing','old@example.com','0801')`, [b]))
    const r = await imp(owner, b, 'customers', [
      { name: 'Ada Obi', phone: '0803', email: 'ADA@example.com', company: 'Obi Stores', city: 'Lagos' },
      { name: 'Ada again', email: 'ada@example.com' }, // duplicate inside the file
      { name: 'Old', email: 'OLD@example.com' }, // already a customer
      { name: 'Phone dup', phone: '0801' }, // already a customer by phone
      { name: '', phone: '0805' }, // no name
      { name: 'Bad mail', email: 'not-an-email' },
      { name: 'Bola', phone: '0806' },
    ])
    expect(r.created).toBe(2); expect(r.duplicates).toEqual([2, 3, 4]); expect(r.invalid).toEqual([{ row: 5, reason: 'no name' }, { row: 6, reason: 'email is not valid' }])
    expect((await q<{ name: string; email: string | null; company: string | null; source: string }>('select name, email, company, source from public.customers where business_id=$1 and name in (\'Ada Obi\',\'Bola\') order by name', [b]))).toEqual([{ name: 'Ada Obi', email: 'ada@example.com', company: 'Obi Stores', source: 'import' }, { name: 'Bola', email: null, company: null, source: 'import' }])
    const leads = await imp(owner, b, 'leads', [{ name: 'Lead one', email: 'l1@example.com' }, { name: 'Ada Obi', email: 'ada@example.com' }])
    expect(leads.created).toBe(1); expect(leads.duplicates).toEqual([2]) // a customer already has that email
  })

  it('is refused for the wrong kind, an empty or oversized file, and for people who cannot manage customers', async () => {
    await expect(imp(owner, biz, 'suppliers', [{ name: 'x' }])).rejects.toThrow(/import customers or leads/)
    await expect(imp(owner, biz, 'customers', [])).rejects.toThrow(/no rows to import/)
    await expect(imp(owner, biz, 'customers', Array.from({ length: 501 }, (_, i) => ({ name: `P${i}` })))).rejects.toThrow(/at most 500/)
    await expect(imp(viewer, biz, 'customers', [{ name: 'x' }])).rejects.toThrow(/permission denied/)
    await expect(imp(other, biz, 'customers', [{ name: 'x' }])).rejects.toThrow(/permission denied/)
  })

  it('is all or nothing: a plan limit stops the whole file and nothing is half imported', async () => {
    await db.exec(`update public.subscription_plans set limits = limits || '{"customers": 3}'::jsonb where code = 'starter'`)
    const b = await fresh()
    await as(owner, () => q(`insert into public.customers (business_id,name) values ($1,'One')`, [b]))
    await expect(imp(owner, b, 'customers', [{ name: 'Two' }, { name: 'Three' }, { name: 'Four' }])).rejects.toThrow(/plan limit reached/)
    expect((await q('select id from public.customers where business_id=$1', [b])).length).toBe(1)
    await db.exec(`update public.subscription_plans set limits = limits - 'customers' where code = 'starter'`)
  })
})

describe('the richer report', () => {
  it('shows the forecast by month, who owns what, which lead sources win, and deals that have gone quiet', async () => {
    const b = await fresh()
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'R') returning id`, [b])))[0].id
    const l = (await as(owner, () => q<{ id: string }>(`insert into public.crm_leads (business_id,name,source) values ($1,'Insta lead','instagram') returning id`, [b])))[0].id
    const a = (await as(owner, () => q<{ id: string }>('select public.crm_save_deal($1,null,$2,$3,null,$4,$5::date,null,$6) as id', [b, 'Open one', c, 1000, '2031-03-15', ''])))[0].id
    const w = (await as(owner, () => q<{ id: string }>('select public.crm_save_deal($1,null,$2,null,$3,$4,null,null,$5) as id', [b, 'From Insta', l, 4000, ''])))[0].id
    const wonId = (await stages(b)).find((s) => s.name === 'Won')!.id
    await as(owner, () => q('select public.crm_move_deal($1,$2,null)', [w, wonId]))
    await db.exec(`update public.crm_deals set last_moved_at = now() - interval '30 days' where id = '${a}'`)
    const r = (await as(owner, () => q<{ r: { forecast: { month: string; weighted: number }[]; by_owner: { owner: string; open_deals: number }[]; by_source: { source: string; won: number; won_value: number }[]; stale_deals: number; weighted_value: number } }>('select public.crm_report($1) as r', [b])))[0].r
    expect(r.forecast).toEqual([expect.objectContaining({ month: '2031-03', weighted: 100 })])
    expect(r.by_owner[0]).toMatchObject({ open_deals: 1 })
    expect(r.by_source).toEqual([expect.objectContaining({ source: 'instagram', won: 1 })]); expect(Number(r.by_source[0].won_value)).toBe(4000)
    expect(Number(r.stale_deals)).toBe(1)
    // a logged call brings it back
    await as(owner, () => q(`insert into public.crm_interactions (business_id, deal_id, kind, summary) values ($1,$2,'call','Rang them')`, [b, a]))
    expect(Number((await as(owner, () => q<{ r: { stale_deals: number } }>('select public.crm_report($1) as r', [b])))[0].r.stale_deals)).toBe(0)
  })
})
