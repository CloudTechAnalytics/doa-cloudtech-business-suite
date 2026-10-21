import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

/**
 * Data-driven isolation checks. They discover every public table at run time, so a business-owned table
 * added by a future migration is covered automatically (and fails here if it forgets RLS).
 */
let db: Db
let userA: string, userB: string, cashierA: string
let bizA: string, bizB: string
let n = 0
const key = () => `sec-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify

let scoped: string[] = []

beforeAll(async () => {
  db = await createDb()
  ;[userA, userB, cashierA] = await Promise.all(['a', 'b', 'c'].map((p) => createUser(db, `${p}@example.com`)))
  bizA = (await as(userA, () => q<{ id: string }>(`select public.create_business('A Farm','farm') as id`)))[0].id
  bizB = (await as(userB, () => q<{ id: string }>(`select public.create_business('B Bakery','bakery') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(userA, () => q(`select public.invite_member($1,'c@example.com','cashier')`, [bizA]))
  await as(cashierA, () => q('select public.accept_my_invitations()'))

  // Give business A real data in every shared area so the checks are not vacuous.
  await as(userA, () => q(`select public.enable_module($1,'customers')`, [bizA]))
  await as(userA, () => q(`select public.enable_module($1,'purchases')`, [bizA]))
  await as(userA, () => q(`select public.enable_module($1,'suppliers')`, [bizA]))
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='kg'`, [bizA]))[0].id
  const loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [bizA]))[0].id
  const product = (await as(userA, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,100) returning id', [bizA, 'Feed', unit])))[0].id
  await as(userA, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [bizA, loc, J([{ product_id: product, quantity: 100, unit_cost: 50 }]), key()]))
  const cust = (await as(userA, () => q<{ id: string }>(`insert into public.customers (business_id,name,email) values ($1,'Buyer','buyer@example.com') returning id`, [bizA])))[0].id
  await as(userA, () => q('select public.set_customer_credit_limit($1, 10000)', [cust]))
  await as(userA, () => q('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6)', [bizA, loc, cust, J([{ product_id: product, quantity: 2 }]), J([{ method: 'cash', amount: 100 }]), key()]))
  const sup = (await as(userA, () => q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Supplier') returning id`, [bizA])))[0].id
  await as(userA, () => q('select public.create_purchase($1,$2,$3::jsonb,null,$4)', [bizA, sup, J([{ product_id: product, quantity: 5, unit_cost: 40 }]), key()]))
  const lead = (await as(userA, () => q<{ id: string }>(`insert into public.crm_leads (business_id,name) values ($1,'Lead') returning id`, [bizA])))[0].id
  await as(userA, () => q(`insert into public.crm_interactions (business_id,lead_id,kind,summary) values ($1,$2,'note','hello')`, [bizA, lead]))
  await as(userA, () => q(`insert into public.crm_tasks (business_id,lead_id,title) values ($1,$2,'Call')`, [bizA, lead]))
  await as(userA, () => q(`insert into public.crm_tags (business_id,name) values ($1,'vip')`, [bizA]))

  scoped = (await q<{ table_name: string }>(`select c.table_name from information_schema.columns c join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE' order by 1`)).map((r) => r.table_name)
})

describe('row-level security is on everywhere', () => {
  it('every public table has RLS enabled', async () => {
    const t = await q<{ relname: string; relrowsecurity: boolean }>(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)
    expect(t.length).toBeGreaterThan(40)
    expect(t.filter((x) => !x.relrowsecurity).map((x) => x.relname)).toEqual([])
  })

  it('the sweep actually covers the business-owned tables', () => {
    expect(scoped.length).toBeGreaterThan(35)
    expect(scoped).toEqual(expect.arrayContaining(['sales', 'products', 'stock_movements', 'customers', 'crm_leads', 'audit_logs', 'payments', 'business_members', 'branches']))
  })

  it('anonymous callers have no table privileges at all', async () => {
    for (const t of ['businesses', 'sales', 'customers', 'audit_logs']) {
      await expect(as(null, () => q(`select * from public.${t}`)), t).rejects.toThrow(/permission denied/)
    }
  })
})

describe('Business B can never read Business A', () => {
  it('sees no rows belonging to A in any business-owned table', async () => {
    for (const t of scoped) {
      const seen = await as(userB, () => q(`select 1 from public.${t} where business_id = $1`, [bizA]).catch((e: Error) => {
        // a table with no SELECT grant at all is also a valid way to deny
        if (/permission denied/.test(e.message)) return []
        throw e
      }))
      expect(seen, t).toHaveLength(0)
    }
  })

  it('business A itself does see its data (the checks are not vacuous)', async () => {
    const populated: string[] = []
    for (const t of ['products', 'stock_movements', 'inventory_balances', 'customers', 'sales', 'sale_items', 'payments', 'purchases', 'purchase_items', 'suppliers', 'crm_leads', 'crm_interactions', 'crm_tasks', 'crm_tags', 'business_members', 'branches', 'business_modules', 'subscriptions']) {
      const r = await as(userA, () => q(`select 1 from public.${t} where business_id = $1 limit 1`, [bizA]))
      if (r.length) populated.push(t)
    }
    expect(populated).toHaveLength(18)
  })
})

describe('Business B can never write to A', () => {
  it('cannot insert a row into A in any business-owned table', async () => {
    for (const t of scoped) {
      const attempt = as(userB, () => q(`insert into public.${t} (business_id) values ($1)`, [bizA]))
      await expect(attempt, t).rejects.toThrow(/permission denied|row-level security/)
    }
  })

  it('cannot update or delete A rows (zero rows touched, or denied outright)', async () => {
    for (const t of scoped) {
      for (const sql of [`update public.${t} set business_id = business_id where business_id = $1`, `delete from public.${t} where business_id = $1`]) {
        const r = await as(userB, () => db.query(sql, [bizA]).then((x) => x.affectedRows ?? 0).catch((e: Error) => {
          if (/permission denied/.test(e.message)) return 0
          throw e
        }))
        expect(r, `${t}: ${sql.split(' ')[0]}`).toBe(0)
      }
    }
  })

  it('cannot move its own rows into A by rewriting business_id', async () => {
    for (const t of ['products', 'customers', 'branches', 'crm_leads', 'suppliers']) {
      await expect(as(userB, () => q(`update public.${t} set business_id = $1 where business_id = $2`, [bizA, bizB])), t).rejects.toThrow(/permission denied|row-level security|violates/)
    }
  })

  it('cannot call business operations against A with a forged business id', async () => {
    const loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [bizA]))[0].id
    const product = (await q<{ id: string }>('select id from public.products where business_id=$1 limit 1', [bizA]))[0].id
    const calls: [string, unknown[]][] = [
      ['select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [bizA, loc, J([{ product_id: product, quantity: 1 }]), key()]],
      ['select public.post_sale($1,$2,null,$3::jsonb,null,$4)', [bizA, loc, J([{ product_id: product, quantity: 1 }]), key()]],
      ['select public.invite_member($1,$2,$3)', [bizA, 'x@example.com', 'viewer']],
      ['select public.enable_module($1,$2)', [bizA, 'purchases']],
      ['select public.change_industry($1,$2,true)', [bizA, 'retail']],
    ]
    for (const [sql, params] of calls) await expect(as(userB, () => q(sql, params)), sql).rejects.toThrow(/permission denied|only the owner/)
  })
})

describe('roles inside a business', () => {
  it('a cashier cannot read the audit log, staff invitations or financial controls of their own business', async () => {
    expect(await as(cashierA, () => q('select * from public.audit_logs where business_id=$1', [bizA]))).toHaveLength(0)
    expect(await as(cashierA, () => q('select * from public.business_invitations where business_id=$1', [bizA]))).toHaveLength(0)
    await expect(as(cashierA, () => q('select public.change_industry($1,$2,true)', [bizA, 'retail']))).rejects.toThrow(/only the owner/)
  })

  it('removing a member removes every kind of access immediately', async () => {
    const m = (await q<{ id: string }>('select id from public.business_members where business_id=$1 and user_id=$2', [bizA, cashierA]))[0].id
    expect((await as(cashierA, () => q('select * from public.products where business_id=$1', [bizA]))).length).toBeGreaterThan(0)
    await as(userA, () => q(`select public.set_member_status($1,'revoked')`, [m]))
    for (const t of ['products', 'sales', 'customers', 'crm_leads', 'stock_movements']) {
      expect(await as(cashierA, () => q(`select * from public.${t} where business_id=$1`, [bizA])), t).toHaveLength(0)
    }
  })
})

describe('audit logging', () => {
  it('records important changes, readable only with audit.read', async () => {
    const entries = await as(userA, () => q<{ action: string }>('select action from public.audit_logs where business_id=$1', [bizA]))
    const actions = new Set(entries.map((e) => e.action))
    for (const a of ['business_members.insert', 'business_modules.insert', 'sales.insert', 'payments.insert', 'customers.update', 'subscriptions.insert']) expect(actions, a).toContain(a)
  })

  it('stores changed columns, never secrets or noise', async () => {
    const [row] = await as(userA, () => q<{ metadata: Record<string, unknown> }>(`select metadata from public.audit_logs where business_id=$1 and action='customers.update' order by occurred_at desc limit 1`, [bizA]))
    expect(row.metadata).toHaveProperty('credit_limit')
    expect(JSON.stringify(row.metadata)).not.toMatch(/idempotency|provider_/)
    expect(Object.keys(row.metadata)).not.toContain('updated_at')
  })

  it('does not log derived payment totals as separate sale changes', async () => {
    const saleUpdates = await as(userA, () => q<{ metadata: Record<string, unknown> }>(`select metadata from public.audit_logs where business_id=$1 and action='sales.update'`, [bizA]))
    for (const u of saleUpdates) expect(Object.keys(u.metadata)).not.toEqual(expect.arrayContaining(['amount_paid']))
  })

  it('cannot be edited, deleted or written to by anyone through the API', async () => {
    await expect(db.query('update public.audit_logs set action = $1', ['x'])).rejects.toThrow(/cannot be changed/)
    await expect(db.query('delete from public.audit_logs')).rejects.toThrow(/cannot be changed/)
    await expect(as(userA, () => q(`insert into public.audit_logs (business_id, action, entity_type) values ($1,'forged','x')`, [bizA]))).rejects.toThrow(/permission denied/)
  })

  it('tells A and B apart', async () => {
    expect(await as(userB, () => q('select * from public.audit_logs where business_id=$1', [bizA]))).toHaveLength(0)
    expect((await as(userB, () => q('select * from public.audit_logs where business_id=$1', [bizB]))).length).toBeGreaterThan(0)
  })
})

describe('subscription events and validated settings', () => {
  it('records subscription changes and rejects a replayed provider event', async () => {
    await db.query(`update public.subscriptions set status='past_due' where business_id=$1`, [bizA])
    const ev = await as(userA, () => q<{ event_type: string }>('select event_type from public.subscription_events where business_id=$1 order by created_at', [bizA]))
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(['subscription.created', 'subscription.status_changed']))
    const sub = (await q<{ id: string }>('select id from public.subscriptions where business_id=$1', [bizA]))[0].id
    await db.query(`insert into public.subscription_events (business_id, subscription_id, event_type, provider_event_reference) values ($1,$2,'payment','evt_1')`, [bizA, sub])
    await expect(db.query(`insert into public.subscription_events (business_id, subscription_id, event_type, provider_event_reference) values ($1,$2,'payment','evt_1')`, [bizA, sub])).rejects.toThrow(/duplicate key/)
    await expect(as(userA, () => q(`insert into public.subscription_events (business_id, subscription_id, event_type) values ($1,$2,'forged')`, [bizA, sub]))).rejects.toThrow(/permission denied/)
    await db.query(`update public.subscriptions set status='active' where business_id=$1`, [bizA])
  })

  it('accepts only known, well-formed business settings', async () => {
    const set = (settings: object) => as(userA, () => db.query('update public.businesses set settings=$2::jsonb where id=$1', [bizA, J(settings)]))
    await set({ tax_rate_percent: 7.5, allow_negative_stock: false, setup: { has_poultry: true, flock: 'broilers', n: 3 } })
    await expect(set({ farm_data: { anything: 1 } })).rejects.toThrow(/unknown business setting/)
    await expect(set({ tax_rate_percent: 150 })).rejects.toThrow(/between 0 and 100/)
    await expect(set({ tax_rate_percent: '7' })).rejects.toThrow(/between 0 and 100/)
    await expect(set({ allow_negative_stock: 'yes' })).rejects.toThrow(/true or false/)
    await expect(set({ setup: { nested: { a: 1 } } })).rejects.toThrow(/invalid setup answer/)
    await expect(set({ setup: { 'Bad Key': 1 } })).rejects.toThrow(/invalid setup answer/)
    await expect(set({ setup: 'x' })).rejects.toThrow(/setup must be an object/)
  })
})
