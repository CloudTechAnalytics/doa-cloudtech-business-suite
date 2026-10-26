import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, parent: string, parent2: string, teacher: string
let biz: string
let n = 0
const key = () => `pc-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const contactOf = async (email: string) => (await q<{ phone: string | null; address: string | null }>('select phone, address from public.school_guardians where business_id = $1 and email = $2', [biz, email]))[0]

beforeAll(async () => {
  db = await createDb()
  ;[owner, parent, parent2, teacher] = await Promise.all(['o', 'p1', 'p2', 't'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, email, role] of [[parent, 'p1@example.com', 'parent'], [parent2, 'p2@example.com', 'parent'], [teacher, 't@example.com', 'teacher']] as const) {
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
  const cls = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [biz]))[0].id
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Ada', last: 'Obi', class_id: cls }), J([{ name: 'Mrs Obi', email: 'p1@example.com', phone: '0801', relationship: 'mother', primary: true }]), key()]))
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Bayo', last: 'Ade', class_id: cls }), J([{ name: 'Mr Ade', email: 'p2@example.com', phone: '0802', relationship: 'father', primary: true }]), key()]))
  await as(parent, () => q('select public.school_claim_links($1)', [biz]))
  await as(parent2, () => q('select public.school_claim_links($1)', [biz]))
})

describe('a new school gets the My Classes page', () => {
  it('has the module switched on and tied to the teaching permission', async () => {
    const m = await q<{ required_permission: string; status: string }>(`select m.required_permission, bm.status from public.modules m join public.business_modules bm on bm.module_id = m.id where m.code = 'school-my-classes' and bm.business_id = $1`, [biz])
    expect(m[0]).toMatchObject({ required_permission: 'school.teach', status: 'enabled' })
  })
})

describe('a parent keeping their own contact details up to date', () => {
  it('changes only the record that belongs to their own login', async () => {
    await as(parent, () => q(`select public.school_update_my_contact($1,'0803 111 2222','12 Palm Street, Lagos')`, [biz]))
    expect(await contactOf('p1@example.com')).toEqual({ phone: '0803 111 2222', address: '12 Palm Street, Lagos' })
    expect((await contactOf('p2@example.com')).phone).toBe('0802') // another family is untouched
  })

  it('can clear a field, and refuses silly lengths', async () => {
    await as(parent, () => q(`select public.school_update_my_contact($1,'','')`, [biz]))
    expect(await contactOf('p1@example.com')).toEqual({ phone: null, address: null })
    await expect(as(parent, () => q('select public.school_update_my_contact($1,$2,null)', [biz, 'x'.repeat(41)]))).rejects.toThrow(/too long/)
    await expect(as(parent, () => q('select public.school_update_my_contact($1,null,$2)', [biz, 'x'.repeat(301)]))).rejects.toThrow(/too long/)
  })

  it('is closed to teachers, staff without the parent permission, and people from outside', async () => {
    await expect(as(teacher, () => q(`select public.school_update_my_contact($1,'1','1')`, [biz]))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q(`select public.school_update_my_contact($1,'1','1')`, [biz]))).rejects.toThrow(/permission denied/)
    const stranger = await createUser(db, 'stranger@example.com')
    await expect(as(stranger, () => q(`select public.school_update_my_contact($1,'1','1')`, [biz]))).rejects.toThrow(/permission denied/)
  })

  it('says so plainly when no guardian record is linked to the login yet', async () => {
    const newcomer = await createUser(db, 'newparent@example.com')
    await as(owner, () => q(`select public.invite_member($1,'newparent@example.com','parent')`, [biz]))
    await as(newcomer, () => q('select public.accept_my_invitations()'))
    await expect(as(newcomer, () => q(`select public.school_update_my_contact($1,'1','1')`, [biz]))).rejects.toThrow(/no parent or guardian record/)
  })
})
