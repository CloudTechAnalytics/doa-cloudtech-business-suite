import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, viewer: string, other: string
let biz: string, bizB: string, shop: string
let customer: string, lead: string, otherCustomer: string
let n = 0
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const deal = (u: string, b: string, o: { id?: string | null; title?: string; customer?: string | null; lead?: string | null; value?: number; expected?: string | null } = {}) =>
  as(u, () => q<{ id: string }>('select public.crm_save_deal($1,$2,$3,$4,$5,$6,$7,null,$8) as id', [b, o.id ?? null, o.title ?? `Deal ${n++}`, o.customer === undefined ? customer : o.customer, o.lead ?? null, o.value ?? 1000, o.expected ?? null, ''])).then((r) => r[0].id)
const move = (u: string, id: string, stage: string, reason: string | null = null) => as(u, () => q('select public.crm_move_deal($1,$2,$3)', [id, stage, reason]))
const stage = async (id: string) => (await q<{ stage: string }>('select stage from public.crm_deals where id=$1', [id]))[0].stage
const lines = (...l: [string, number, number][]) => J(l.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price })))
const quote = (u: string, b: string, o: { id?: string | null; deal?: string | null; customer?: string | null; lines?: string; discount?: number } = {}) =>
  as(u, () => q<{ id: string }>('select public.crm_save_quote($1,$2,$3,$4,null,null,$5::jsonb,$6,$7) as id', [b, o.id ?? null, o.deal ?? null, o.customer === undefined ? customer : o.customer, o.lines ?? lines(['Service', 2, 500]), o.discount ?? 0, ''])).then((r) => r[0].id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, viewer, other] = await Promise.all(['o', 'c', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  // A business with no industry: just the apps.
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Other Co','general') as id`)))[0].id
  shop = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[cashier, 'cashier'], [viewer, 'viewer']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Acme Ltd') returning id`, [biz])))[0].id
  lead = (await as(owner, () => q<{ id: string }>(`insert into public.crm_leads (business_id,name) values ($1,'Prospect Ltd') returning id`, [biz])))[0].id
  otherCustomer = (await as(other, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Their customer') returning id`, [bizB])))[0].id
})

describe('a business with no industry', () => {
  it('has the shared apps and none of an industry\'s modules', async () => {
    const mods = (await as(owner, () => q<{ code: string }>('select module_code as code from public.my_modules($1) where usable', [biz]))).map((m) => m.code)
    for (const m of ['customers', 'sales', 'inventory', 'purchases', 'suppliers', 'expenses', 'reports']) expect(mods, m).toContain(m)
    expect(mods.filter((m) => /^(retail|farm|bakery|pharmacy|school)-/.test(m))).toEqual([])
    expect((await q<{ primary_industry_code: string }>('select primary_industry_code from public.businesses where id=$1', [biz]))[0].primary_industry_code).toBe('general')
  })
})

describe('deals', () => {
  it('are created as new with a history entry, on a customer or a lead', async () => {
    const a = await deal(owner, biz, { title: 'Website for Acme', value: 250000, expected: '2030-01-31' })
    const b = await deal(owner, biz, { title: 'Prospect order', customer: null, lead })
    expect(await stage(a)).toBe('new'); expect(await stage(b)).toBe('new')
    expect((await q<{ to_stage: string; from_stage: string | null }>('select from_stage, to_stage from public.crm_deal_events where deal_id=$1', [a]))).toEqual([{ from_stage: null, to_stage: 'new' }])
    expect((await q<{ value: string }>('select value from public.crm_deals where id=$1', [a]))[0].value).toBe('250000.00')
  })

  it('need something to be about, a contact in this business, and a value that is not negative', async () => {
    await expect(deal(owner, biz, { title: '  ' })).rejects.toThrow(/enter what the deal is for/)
    await expect(deal(owner, biz, { customer: null })).rejects.toThrow(/choose the customer or lead/)
    await expect(deal(owner, biz, { value: -5 })).rejects.toThrow(/cannot be negative/)
    await expect(deal(owner, biz, { customer: otherCustomer })).rejects.toThrow(/customer not found/)
  })

  it('can be changed, and move through stages with every change recorded', async () => {
    const id = await deal(owner, biz, { title: 'Move me' })
    await deal(owner, biz, { id, title: 'Moved', value: 5000 })
    expect((await q<{ title: string; value: string }>('select title, value from public.crm_deals where id=$1', [id]))[0]).toEqual({ title: 'Moved', value: '5000.00' })
    await move(owner, id, 'qualified'); await move(owner, id, 'proposal'); await move(owner, id, 'won')
    expect(await stage(id)).toBe('won')
    expect((await q<{ closed_at: string | null }>('select closed_at from public.crm_deals where id=$1', [id]))[0].closed_at).not.toBeNull()
    expect((await q<{ f: string | null; t: string }>('select from_stage f, to_stage t from public.crm_deal_events where deal_id=$1 order by at, to_stage', [id])).map((e) => `${e.f}>${e.t}`).sort()).toEqual(['new>qualified', 'null>new', 'proposal>won', 'qualified>proposal'])
    await move(owner, id, 'negotiation') // reopening clears the close date
    expect((await q<{ closed_at: string | null }>('select closed_at from public.crm_deals where id=$1', [id]))[0].closed_at).toBeNull()
  })

  it('cannot be lost without saying why, and keep the reason', async () => {
    const id = await deal(owner, biz, { title: 'Will be lost' })
    await expect(move(owner, id, 'lost')).rejects.toThrow(/say why the deal was lost/)
    await expect(move(owner, id, 'lost', '  ')).rejects.toThrow(/say why/)
    await move(owner, id, 'lost', 'Chose a competitor')
    expect((await q<{ stage: string; lost_reason: string }>('select stage, lost_reason from public.crm_deals where id=$1', [id]))[0]).toEqual({ stage: 'lost', lost_reason: 'Chose a competitor' })
    await move(owner, id, 'new')
    expect((await q<{ lost_reason: string | null }>('select lost_reason from public.crm_deals where id=$1', [id]))[0].lost_reason).toBeNull()
    await expect(move(owner, id, 'archived')).rejects.toThrow(/choose a stage/)
  })

  it('are for people who manage customers; others only read, and other businesses see nothing', async () => {
    const id = await deal(owner, biz, { title: 'Guarded' })
    await expect(deal(viewer, biz)).rejects.toThrow(/permission denied/)
    await expect(move(viewer, id, 'won')).rejects.toThrow(/permission denied/)
    await expect(move(other, id, 'won')).rejects.toThrow(/permission denied/)
    expect((await as(viewer, () => q('select id from public.crm_deals where id=$1', [id]))).length).toBe(1)
    expect((await as(other, () => q('select id from public.crm_deals where id=$1', [id]))).length).toBe(0)
    await expect(as(owner, () => q('update public.crm_deals set stage = $2 where id = $1', [id, 'won']))).rejects.toThrow()
    await expect(as(owner, () => q('insert into public.crm_deals (business_id, title, customer_id) values ($1,$2,$3)', [biz, 'direct', customer]))).rejects.toThrow()
  })

  it('keep a customer or lead from being deleted while they point at it', async () => {
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Has a deal') returning id`, [biz])))[0].id
    await deal(owner, biz, { customer: c })
    await expect(as(owner, () => q(`select public.delete_record('customer',$1)`, [c]))).rejects.toThrow(/cannot be deleted/)
  })
})

describe('quotes', () => {
  it('are numbered per business and add up on the server', async () => {
    const a = await quote(owner, biz, { lines: lines(['Design', 2, 1500.5], ['Hosting', 1, 999.99]), discount: 100 })
    const b = await quote(owner, biz)
    const [qa] = await q<{ number: string; subtotal: string; total: string; status: string }>('select number, subtotal, total, status from public.crm_quotes where id=$1', [a])
    expect(qa).toEqual({ number: 'QUO-000001', subtotal: '4000.99', total: '3900.99', status: 'draft' })
    expect((await q<{ number: string }>('select number from public.crm_quotes where id=$1', [b]))[0].number).toBe('QUO-000002')
    const c = (await as(other, () => q<{ id: string }>('select public.crm_save_quote($1,null,null,$2,null,null,$3::jsonb,0,$4) as id', [bizB, otherCustomer, lines(['X', 1, 1]), ''])))[0].id
    expect((await q<{ number: string }>('select number from public.crm_quotes where id=$1', [c]))[0].number).toBe('QUO-000001')
  })

  it('check the lines, the discount and who the quote is for', async () => {
    await expect(quote(owner, biz, { lines: '[]' })).rejects.toThrow(/at least one line/)
    await expect(quote(owner, biz, { lines: lines(['', 1, 5]) })).rejects.toThrow(/needs a description/)
    await expect(quote(owner, biz, { lines: lines(['A', 0, 5]) })).rejects.toThrow(/quantity above zero/)
    await expect(quote(owner, biz, { lines: lines(['A', 1, -5]) })).rejects.toThrow(/price of zero or more/)
    await expect(quote(owner, biz, { lines: J([{ description: 'A', quantity: 'x', unit_price: 1 }]) })).rejects.toThrow(/must be numbers/)
    await expect(quote(owner, biz, { discount: 5000 })).rejects.toThrow(/discount cannot be more/)
    await expect(quote(owner, biz, { customer: null })).rejects.toThrow(/choose the customer, lead or deal/)
    await expect(quote(owner, biz, { customer: otherCustomer })).rejects.toThrow()
  })

  it('can be edited as a draft, then only moved sent, then accepted or declined', async () => {
    const id = await quote(owner, biz)
    await quote(owner, biz, { id, lines: lines(['Changed', 3, 100]) })
    expect((await q<{ total: string }>('select total from public.crm_quotes where id=$1', [id]))[0].total).toBe('300.00')
    await expect(as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'accepted']))).rejects.toThrow(/draft quote cannot be marked accepted/)
    await as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'sent']))
    await expect(quote(owner, biz, { id })).rejects.toThrow(/can no longer be changed/)
    await as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'accepted']))
    await expect(as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'declined']))).rejects.toThrow(/accepted quote cannot be marked declined/)
    await expect(as(viewer, () => q('select public.crm_set_quote_status($1,$2)', [id, 'sent']))).rejects.toThrow(/permission denied/)
  })
})

describe('the CRM report', () => {
  it('adds up the pipeline, wins, losses and follow-ups for one business only', async () => {
    const fresh = (await as(owner, () => q<{ id: string }>(`select public.create_business('Report Co','general') as id`)))[0].id
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'R') returning id`, [fresh])))[0].id
    const d = (value: number) => as(owner, () => q<{ id: string }>('select public.crm_save_deal($1,null,$2,$3,null,$4,null,null,$5) as id', [fresh, `D${value}`, c, value, ''])).then((r) => r[0].id)
    const [a, b, w, l] = [await d(1000), await d(2000), await d(5000), await d(300)]
    await move(owner, b, 'proposal'); await move(owner, w, 'won'); await move(owner, l, 'lost', 'Price')
    await as(owner, () => q(`insert into public.crm_tasks (business_id, customer_id, title, due_at) values ($1,$2,'Call back', now() - interval '2 days')`, [fresh, c]))
    void a
    const r = (await as(owner, () => q<{ r: { open_value: number; open_deals: number; won_this_month: number; win_rate: number; overdue_tasks: number; stages: { stage: string; deals: number }[]; lost_reasons: { reason: string }[] } }>('select public.crm_report($1) as r', [fresh])))[0].r
    expect(Number(r.open_value)).toBe(3000); expect(Number(r.open_deals)).toBe(2); expect(Number(r.won_this_month)).toBe(5000); expect(Number(r.win_rate)).toBe(50); expect(Number(r.overdue_tasks)).toBe(1)
    expect(r.stages.map((s) => `${s.stage}:${s.deals}`)).toEqual(['new:1', 'qualified:0', 'proposal:1', 'negotiation:0', 'won:1', 'lost:1'])
    expect(r.lost_reasons.map((x) => x.reason)).toEqual(['Price'])
    await expect(as(other, () => q('select public.crm_report($1)', [fresh]))).rejects.toThrow(/permission denied/)
  })
})
