import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, engineer: string, support: string, owner: string, partner: string, clerk: string
let biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const call = async <T = unknown>(u: string, sql: string, params: unknown[] = []) => (await as(u, () => q<{ r: T }>(`select ${sql} as r`, params)))[0].r
const member = async (u: string) => (await q<{ status: string; role: string }>(`select m.status, r.name as role from public.business_members m join public.roles r on r.id = m.role_id where m.business_id = $1 and m.user_id = $2`, [biz, u]))[0]
const business = async () => (await q<{ name: string; legal_name: string | null; timezone: string; status: string; owner_user_id: string }>('select name, legal_name, timezone, status, owner_user_id from public.businesses where id = $1', [biz]))[0]

beforeAll(async () => {
  db = await createDb()
  ;[root, engineer, support, owner, partner, clerk] = await Promise.all(['root', 'eng', 'sup', 'owner', 'partner', 'clerk'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${engineer}', 'engineer'), ('${support}', 'support')`)
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Green Farm','farm') as id`)))[0].id
  await as(owner, () => q(`select public.invite_member($1,'partner@example.com','business_admin')`, [biz]))
  await as(partner, () => q('select public.accept_my_invitations()'))
  await as(owner, () => q(`select public.invite_member($1,'clerk@example.com','cashier')`, [biz]))
  await as(clerk, () => q('select public.accept_my_invitations()'))
})

describe('editing a business from the console', () => {
  it('needs a platform engineer, a reason and valid details, and is logged', async () => {
    await expect(call(support, `public.platform_update_business('${biz}','New Name',null,'Africa/Lagos','fix')`)).rejects.toThrow(/permission denied/)
    await expect(call(owner, `public.platform_update_business('${biz}','New Name',null,'Africa/Lagos','fix')`)).rejects.toThrow(/permission denied/)
    await expect(call(engineer, `public.platform_update_business('${biz}','New Name',null,'Africa/Lagos','')`)).rejects.toThrow(/say why/)
    await expect(call(engineer, `public.platform_update_business('${biz}','','x','Africa/Lagos','fix')`)).rejects.toThrow(/business name/)
    await expect(call(engineer, `public.platform_update_business('${biz}','New Name',null,'Mars/Base','fix')`)).rejects.toThrow(/time zone/)
    await as(engineer, () => q(`select public.platform_update_business($1,'Green Farms Ltd','Green Farms Limited','Africa/Accra','Corrected the registered name')`, [biz]))
    expect(await business()).toMatchObject({ name: 'Green Farms Ltd', legal_name: 'Green Farms Limited', timezone: 'Africa/Accra' })
    const log = await call<{ action: string; reason: string }[]>(support, 'public.platform_audit(10)')
    expect(log.find((l) => l.action === 'business.update')!.reason).toBe('Corrected the registered name')
  })
})

describe('stopping one person from a business', () => {
  it('suspends, restores and removes a member, and the member really loses access', async () => {
    const active = async () => (await as(clerk, () => q<{ r: boolean }>('select public.is_active_member($1) as r', [biz])))[0].r
    expect(await active()).toBe(true)
    await expect(call(support, `public.platform_set_member_status('${biz}','${clerk}','suspended','left the firm')`)).rejects.toThrow(/permission denied/)
    await expect(call(engineer, `public.platform_set_member_status('${biz}','${clerk}','paused','left the firm')`)).rejects.toThrow(/choose active/)
    await as(engineer, () => q(`select public.platform_set_member_status($1,$2,'suspended','Freeing a seat')`, [biz, clerk]))
    expect((await member(clerk)).status).toBe('suspended'); expect(await active()).toBe(false)
    await as(engineer, () => q(`select public.platform_set_member_status($1,$2,'active','Back at work')`, [biz, clerk]))
    expect(await active()).toBe(true)
    await as(engineer, () => q(`select public.platform_set_member_status($1,$2,'revoked','Left the business')`, [biz, clerk]))
    expect((await member(clerk)).status).toBe('revoked'); expect(await active()).toBe(false)
    await expect(call(engineer, `public.platform_set_member_status('${biz}','${root}','suspended','not a member')`)).rejects.toThrow(/not a member/)
  })

  it('will not stop the owner until ownership has moved', async () => {
    await expect(call(engineer, `public.platform_set_member_status('${biz}','${owner}','suspended','mistake')`)).rejects.toThrow(/owns the business/)
    expect((await member(owner)).status).toBe('active')
  })
})

describe('moving ownership', () => {
  it('is for platform owners only, to an active member', async () => {
    await expect(call(engineer, `public.platform_transfer_ownership('${biz}','partner@example.com','agreed')`)).rejects.toThrow(/permission denied/)
    await expect(call(root, `public.platform_transfer_ownership('${biz}','partner@example.com','')`)).rejects.toThrow(/say why/)
    await expect(call(root, `public.platform_transfer_ownership('${biz}','stranger@example.com','agreed')`)).rejects.toThrow(/not an active member/)
    await expect(call(root, `public.platform_transfer_ownership('${biz}','clerk@example.com','agreed')`)).rejects.toThrow(/not an active member/) // removed earlier
    await expect(call(root, `public.platform_transfer_ownership('${biz}','owner@example.com','agreed')`)).rejects.toThrow(/already owns/)
  })

  it('makes the new owner the owner and the old one an admin, and logs it', async () => {
    await as(root, () => q(`select public.platform_transfer_ownership($1,'PARTNER@example.com','Owner retired, agreed in writing')`, [biz]))
    expect((await business()).owner_user_id).toBe(partner)
    expect(await member(partner)).toMatchObject({ role: 'owner', status: 'active' })
    expect(await member(owner)).toMatchObject({ role: 'business_admin', status: 'active' })
    const log = await call<{ action: string; reason: string }[]>(support, 'public.platform_audit(20)')
    expect(log.find((l) => l.action === 'business.transfer_ownership')!.reason).toBe('Owner retired, agreed in writing')
  })
})

describe('deleting a business', () => {
  it('is for platform owners only, needs a reason, archives rather than erases, and locks everyone out', async () => {
    await expect(call(engineer, `public.platform_archive_business('${biz}','closing down')`)).rejects.toThrow(/permission denied/)
    await expect(call(root, `public.platform_archive_business('${biz}','')`)).rejects.toThrow(/say why/)
    await as(root, () => q(`select public.platform_archive_business($1,'Owner asked us to close it')`, [biz]))
    expect((await business()).status).toBe('archived')
    expect(Number((await q<{ n: string }>('select count(*) as n from public.business_members where business_id = $1', [biz]))[0].n)).toBe(3) // records are kept
    expect((await as(partner, () => q<{ r: boolean }>('select public.is_active_member($1) as r', [biz])))[0].r).toBe(false)
    await expect(call(root, `public.platform_archive_business('${biz}','again')`)).rejects.toThrow(/business not found/)
    await expect(call(engineer, `public.platform_update_business('${biz}','Zombie',null,'Africa/Lagos','edit after delete')`)).rejects.toThrow(/business not found/)
  })
})
