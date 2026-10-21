import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, staff: string, outsider: string, unconfirmed: string
let farm: string, bakery: string

const createBiz = (name: string, industry: string) =>
  rows<{ create_business: string }>(db, 'select public.create_business($1, $2)', [name, industry]).then((r) => r[0].create_business)
const memberRow = (business: string, user: string) =>
  rows<{ id: string }>(db, 'select id from public.business_members where business_id = $1 and user_id = $2', [business, user]).then((r) => r[0].id)

beforeAll(async () => {
  db = await createDb()
  owner = await createUser(db, 'owner@example.com')
  staff = await createUser(db, 'staff@example.com')
  outsider = await createUser(db, 'outsider@example.com')
  unconfirmed = await createUser(db, 'pending@example.com', false)
  farm = await asUser(db, owner, () => createBiz('Greenfield Farms', 'farm'))
  bakery = await asUser(db, owner, () => createBiz('Sunrise Bakery', 'bakery'))
})

describe('multi-business ownership', () => {
  it('lets one user own two businesses with different industries', async () => {
    const list = await asUser(db, owner, () => rows<{ name: string; primary_industry_code: string }>(db, 'select name, primary_industry_code from public.businesses order by name'))
    expect(list.map((b) => b.primary_industry_code)).toEqual(['farm', 'bakery'])
  })

  it('creates owner membership and a default branch', async () => {
    const r = await asUser(db, owner, () => rows<{ role: string }>(db, `select r.name as role from public.business_members m join public.roles r on r.id = m.role_id where m.business_id = $1`, [farm]))
    expect(r).toEqual([{ role: 'owner' }])
    const b = await asUser(db, owner, () => rows(db, 'select 1 from public.branches where business_id = $1', [farm]))
    expect(b).toHaveLength(1)
  })

  it('rejects unavailable industries and anonymous callers', async () => {
    await expect(asUser(db, owner, () => createBiz('Pharma', 'pharmacy'))).rejects.toThrow(/not available/)
    await expect(asUser(db, null, () => createBiz('Anon', 'retail'))).rejects.toThrow()
  })
})

describe('invitations and membership lifecycle', () => {
  it('invites a staff member to one business only', async () => {
    await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'Staff@Example.com', 'cashier')`, [bakery]))
    // before accepting, nothing is visible
    expect(await asUser(db, staff, () => rows(db, 'select * from public.businesses'))).toHaveLength(0)
    const accepted = await asUser(db, staff, () => rows<{ n: number }>(db, 'select public.accept_my_invitations() as n'))
    expect(accepted[0].n).toBe(1)

    const visible = await asUser(db, staff, () => rows<{ id: string }>(db, 'select id from public.businesses'))
    expect(visible.map((b) => b.id)).toEqual([bakery])
  })

  it('hides the other business data from the staff member', async () => {
    expect(await asUser(db, staff, () => rows(db, 'select * from public.branches where business_id = $1', [farm]))).toHaveLength(0)
    expect(await asUser(db, staff, () => rows(db, 'select * from public.business_members where business_id = $1', [farm]))).toHaveLength(0)
  })

  it('does not accept invitations for unconfirmed email addresses', async () => {
    await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'pending@example.com', 'viewer')`, [farm]))
    const n = await asUser(db, unconfirmed, () => rows<{ n: number }>(db, 'select public.accept_my_invitations() as n'))
    expect(n[0].n).toBe(0)
  })

  it('blocks a cashier from managing staff or settings', async () => {
    await expect(asUser(db, staff, () => rows(db, `select public.invite_member($1, 'x@example.com', 'viewer')`, [bakery]))).rejects.toThrow(/permission denied/)
    const upd = await asUser(db, staff, () => db.query(`update public.businesses set name = 'Hacked' where id = $1`, [bakery]))
    expect(upd.affectedRows).toBe(0)
  })

  it('revoking a membership removes access immediately', async () => {
    const m = await memberRow(bakery, staff)
    await asUser(db, owner, () => rows(db, `select public.set_member_status($1, 'revoked')`, [m]))
    expect(await asUser(db, staff, () => rows(db, 'select * from public.businesses'))).toHaveLength(0)
    expect(await asUser(db, staff, () => rows(db, 'select * from public.branches'))).toHaveLength(0)
  })

  it('protects the owner membership', async () => {
    const m = await memberRow(bakery, owner)
    await expect(asUser(db, owner, () => rows(db, `select public.set_member_status($1, 'suspended')`, [m]))).rejects.toThrow(/cannot be changed/)
    await expect(asUser(db, owner, () => rows(db, `select public.set_member_role($1, 'viewer')`, [m]))).rejects.toThrow(/cannot be changed/)
  })

  it('prevents non-owners from granting administrator or owner roles', async () => {
    await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'staff@example.com', 'manager')`, [farm]))
    // staff is already a member of nothing in farm; accept, then try escalation as a manager
    await asUser(db, staff, () => rows(db, 'select public.accept_my_invitations()'))
    // managers lack staff.manage, so invite is denied
    await expect(asUser(db, staff, () => rows(db, `select public.invite_member($1, 'z@example.com', 'business_admin')`, [farm]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, owner, () => rows(db, `select public.invite_member($1, 'z@example.com', 'owner')`, [farm]))).rejects.toThrow(/owner role/)
  })
})

describe('cross-business protection (direct table access)', () => {
  it('outsider sees nothing', async () => {
    for (const t of ['businesses', 'business_members', 'branches', 'business_invitations']) {
      expect(await asUser(db, outsider, () => rows(db, `select * from public.${t}`))).toHaveLength(0)
    }
  })

  it('forbids direct writes to memberships, ownership and industry', async () => {
    await expect(asUser(db, outsider, () => db.query(`insert into public.business_members (business_id, user_id, role_id) select $1, $2, id from public.roles where name = 'owner'`, [farm, outsider]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, owner, () => db.query(`update public.businesses set owner_user_id = $2 where id = $1`, [farm, outsider]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, owner, () => db.query(`update public.businesses set primary_industry_code = 'retail' where id = $1`, [farm]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, owner, () => db.query(`delete from public.business_members where business_id = $1`, [farm]))).rejects.toThrow(/permission denied/)
  })

  it('cannot move a record to another business via update', async () => {
    const [b] = await asUser(db, owner, () => rows<{ id: string }>(db, 'select id from public.branches where business_id = $1', [farm]))
    await expect(asUser(db, owner, () => db.query(`update public.branches set business_id = $2 where id = $1`, [b.id, bakery]))).rejects.toThrow(/permission denied/)
  })

  it('a forged business id does not grant branch creation', async () => {
    await expect(asUser(db, outsider, () => db.query(`insert into public.branches (business_id, name, code) values ($1, 'Evil', 'EVIL')`, [farm]))).rejects.toThrow(/row-level security/)
  })

  it('prevents assigning a user to another business branch', async () => {
    const [farmBranch] = await rows<{ id: string }>(db, 'select id from public.branches where business_id = $1', [farm])
    // owner is a member of both businesses, but branch belongs to farm: pairing it with bakery must fail
    await expect(asUser(db, owner, () => db.query(`insert into public.user_branch_access (business_id, branch_id, user_id) values ($1, $2, $3)`, [bakery, farmBranch.id, owner]))).rejects.toThrow(/foreign key/)
  })

  it('branch restrictions limit visible branches', async () => {
    // starter plan allows one branch; upgrade (as the payment webhook would) before adding another
    await db.exec(`update public.subscriptions set plan_id = (select id from public.subscription_plans where code = 'growth')`)
    const extra = await asUser(db, owner, () => rows<{ id: string }>(db, `insert into public.branches (business_id, name, code) values ($1, 'Second', 'SEC') returning id`, [farm]))
    const [main] = await rows<{ id: string }>(db, `select id from public.branches where business_id = $1 and code = 'MAIN'`, [farm])
    await asUser(db, owner, () => db.query(`insert into public.user_branch_access (business_id, branch_id, user_id) values ($1, $2, $3)`, [farm, extra[0].id, staff]))
    const seen = await asUser(db, staff, () => rows<{ id: string }>(db, 'select id from public.branches where business_id = $1', [farm]))
    expect(seen.map((b) => b.id)).toEqual([extra[0].id])
    expect(seen.map((b) => b.id)).not.toContain(main.id)
  })

  it('profiles are only visible to self or co-members', async () => {
    const seen = await asUser(db, outsider, () => rows<{ id: string }>(db, 'select id from public.profiles'))
    expect(seen.map((p) => p.id)).toEqual([outsider])
    const ownerSees = await asUser(db, owner, () => rows<{ id: string }>(db, 'select id from public.profiles'))
    expect(ownerSees.map((p) => p.id)).toContain(staff)
  })
})
