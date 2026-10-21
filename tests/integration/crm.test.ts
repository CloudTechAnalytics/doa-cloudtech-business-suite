import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, viewer: string, other: string
let biz: string, bizB: string
let n = 0
const key = () => `crm-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const newLead = (u: string, b: string, name: string, email: string | null = null, phone: string | null = null) =>
  as(u, () => q<{ id: string }>('insert into public.crm_leads (business_id,name,email,phone,source) values ($1,$2,$3,$4,$5) returning id', [b, name, email, phone, 'referral'])).then((r) => r[0].id)
const convert = (u: string, lead: string, k = key()) => as(u, () => q<{ r: { customer_id: string; created: boolean } }>('select public.convert_lead($1,$2) as r', [lead, k])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, viewer, other] = await Promise.all(['o', 'c', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Other','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[cashier, 'cashier'], [viewer, 'viewer']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
})

describe('leads become customers without duplicates', () => {
  it('creates a customer and links the lead', async () => {
    const lead = await newLead(owner, biz, 'Bola Supermarket', 'bola@example.com', '0805')
    const r = await convert(owner, lead)
    expect(r.created).toBe(true)
    const [l] = await q<{ status: string; customer_id: string }>('select status, customer_id from public.crm_leads where id=$1', [lead])
    expect(l).toEqual({ status: 'converted', customer_id: r.customer_id })
    const [c] = await q<{ name: string; source: string }>('select name, source from public.customers where id=$1', [r.customer_id])
    expect(c).toEqual({ name: 'Bola Supermarket', source: 'referral' })
  })

  it('reuses an existing customer with the same email (any case) or phone', async () => {
    const existing = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name,email,phone) values ($1,'Ada Stores','Ada@Example.com','0803') returning id`, [biz])))[0].id
    const byEmail = await convert(owner, await newLead(owner, biz, 'Ada (lead)', 'ada@example.com'))
    expect(byEmail).toEqual({ customer_id: existing, created: false })
    const byPhone = await convert(owner, await newLead(owner, biz, 'Ada phone lead', null, '0803'))
    expect(byPhone.customer_id).toBe(existing)
    expect((await q('select 1 from public.customers where lower(email)=\'ada@example.com\'')).length).toBe(1)
  })

  it('does not match customers from another business', async () => {
    await as(other, () => q(`insert into public.customers (business_id,name,email) values ($1,'Theirs','shared@example.com')`, [bizB]))
    const r = await convert(owner, await newLead(owner, biz, 'Shared lead', 'shared@example.com'))
    expect(r.created).toBe(true)
  })

  it('is idempotent, and a converted lead cannot be converted or edited back', async () => {
    const lead = await newLead(owner, biz, 'Once Only')
    const k = key()
    const a = await convert(owner, lead, k)
    const b = await convert(owner, lead, k)
    expect(b).toEqual(a)
    await expect(convert(owner, lead)).rejects.toThrow(/already converted/)
    await expect(as(owner, () => q(`update public.crm_leads set status='new' where id=$1`, [lead]))).rejects.toThrow(/check constraint/)
  })

  it('cannot mark a lead converted by hand or attach it to a customer directly', async () => {
    const lead = await newLead(owner, biz, 'Sneaky')
    await expect(as(owner, () => q(`update public.crm_leads set status='converted' where id=$1`, [lead]))).rejects.toThrow(/check constraint/)
    await expect(as(owner, () => q('update public.crm_leads set customer_id = gen_random_uuid() where id=$1', [lead]))).rejects.toThrow(/permission denied/)
  })

  it('carries notes, follow-ups and tags over to the customer', async () => {
    const lead = await newLead(owner, biz, 'Carry Over', 'carry@example.com')
    await as(owner, () => q(`insert into public.crm_interactions (business_id,lead_id,kind,summary) values ($1,$2,'call','Asked for prices')`, [biz, lead]))
    await as(owner, () => q(`insert into public.crm_tasks (business_id,lead_id,title) values ($1,$2,'Send quote')`, [biz, lead]))
    const tag = (await as(owner, () => q<{ id: string }>(`insert into public.crm_tags (business_id,name) values ($1,'wholesale') on conflict do nothing returning id`, [biz])))[0]?.id
      ?? (await q<{ id: string }>(`select id from public.crm_tags where business_id=$1 and lower(name)='wholesale'`, [biz]))[0].id
    await as(owner, () => q('insert into public.crm_entity_tags (business_id,tag_id,lead_id) values ($1,$2,$3)', [biz, tag, lead]))
    const { customer_id } = await convert(owner, lead)
    const h = await as(owner, () => q<{ h: { kind: string; detail: string }[] }>('select public.customer_history($1) as h', [customer_id]))
    expect(h[0].h.map((e) => e.detail)).toEqual(expect.arrayContaining(['Asked for prices', 'Send quote']))
    expect((await q('select 1 from public.crm_entity_tags where customer_id=$1', [customer_id])).length).toBe(1)
  })
})

describe('customer history joins other modules safely', () => {
  it('includes sales for users who can read sales, and omits them otherwise', async () => {
    const cust = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Buyer') returning id`, [biz])))[0].id
    await as(owner, () => q('select public.set_customer_credit_limit($1, 100000)', [cust]))
    const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
    const loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
    const prod = (await as(owner, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,tracks_stock) values ($1,$2,$3,500,false) returning id', [biz, 'Svc', unit])))[0].id
    await as(owner, () => q('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6)', [biz, loc, cust, JSON.stringify([{ product_id: prod, quantity: 1 }]), '[]', key()]))
    const asOwner = await as(owner, () => q<{ h: { kind: string }[] }>('select public.customer_history($1) as h', [cust]))
    expect(asOwner[0].h.some((e) => e.kind === 'sale')).toBe(true)
  })

  it('refuses callers without CRM read access, including other businesses', async () => {
    const cust = (await q<{ id: string }>('select id from public.customers where business_id=$1 limit 1', [biz]))[0].id
    await expect(as(other, () => q('select public.customer_history($1)', [cust]))).rejects.toThrow(/permission denied/)
  })
})

describe('permissions and tenant boundaries', () => {
  it('lets a cashier manage leads and notes but not credit limits; a viewer is read-only', async () => {
    const lead = await newLead(cashier, biz, 'Cashier lead')
    await as(cashier, () => q(`insert into public.crm_interactions (business_id,lead_id,kind,summary) values ($1,$2,'note','Walk-in enquiry')`, [biz, lead]))
    await expect(newLead(viewer, biz, 'Viewer lead')).rejects.toThrow(/row-level security/)
    expect((await as(viewer, () => q('select * from public.crm_leads where business_id=$1', [biz]))).length).toBeGreaterThan(0)
  })

  it('never lets the browser choose the creator of a record', async () => {
    const lead = await as(cashier, () => q<{ id: string; created_by: string }>(`insert into public.crm_leads (business_id,name) values ($1,'Who made me') returning id, created_by`, [biz]))
    expect(lead[0].created_by).toBe(cashier)
    await expect(as(cashier, () => q('insert into public.crm_leads (business_id,name,created_by) values ($1,$2,$3)', [biz, 'x', owner]))).rejects.toThrow(/permission denied/)
  })

  it('keeps leads, notes, tasks and tags invisible to other businesses', async () => {
    for (const t of ['crm_leads', 'crm_interactions', 'crm_tasks', 'crm_tags', 'crm_entity_tags']) {
      expect(await as(other, () => q(`select * from public.${t} where business_id=$1`, [biz])), t).toHaveLength(0)
    }
    await expect(newLead(other, biz, 'Cross-tenant lead')).rejects.toThrow(/row-level security/)
  })

  it('rejects cross-business references: a task cannot be assigned to someone from another business, or point at their customer', async () => {
    const lead = await newLead(owner, biz, 'Task lead')
    await expect(as(owner, () => q(`insert into public.crm_tasks (business_id,lead_id,title,assigned_to) values ($1,$2,'Call',$3)`, [biz, lead, other]))).rejects.toThrow(/foreign key/)
    const theirCustomer = (await q<{ id: string }>('select id from public.customers where business_id=$1 limit 1', [bizB]))[0].id
    await expect(as(owner, () => q(`insert into public.crm_interactions (business_id,customer_id,kind,summary) values ($1,$2,'note','x')`, [biz, theirCustomer]))).rejects.toThrow(/foreign key/)
  })

  it('stamps completion time when a task is done', async () => {
    const lead = await newLead(owner, biz, 'Done lead')
    const t = (await as(owner, () => q<{ id: string }>(`insert into public.crm_tasks (business_id,lead_id,title) values ($1,$2,'Ring') returning id`, [biz, lead])))[0].id
    await as(owner, () => q(`update public.crm_tasks set status='done' where id=$1`, [t]))
    expect((await q<{ completed_at: string | null }>('select completed_at from public.crm_tasks where id=$1', [t]))[0].completed_at).not.toBeNull()
  })

  it('is unavailable when the CRM module is switched off, but stays readable', async () => {
    // retail enables the CRM module ("customers") by default; turn it off
    await as(owner, () => q(`select public.disable_module($1,'customers')`, [biz]))
    await expect(newLead(owner, biz, 'Blocked')).rejects.toThrow(/row-level security/)
    expect((await as(owner, () => q('select * from public.crm_leads where business_id=$1', [biz]))).length).toBeGreaterThan(0)
    await as(owner, () => q(`select public.enable_module($1,'customers')`, [biz]))
  })
})
