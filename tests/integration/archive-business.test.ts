import { beforeAll, describe, expect, it } from 'vitest'
import { demoArchiveBusiness, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, outsider: string
let biz: string

const createBiz = (name: string) => rows<{ id: string }>(db, `select public.create_business($1, 'retail') as id`, [name]).then((r) => r[0].id)
const archive = (b: string, name: string) => rows(db, 'select public.archive_business($1, $2)', [b, name])
const visible = () => rows<{ id: string }>(db, 'select id from public.businesses')

beforeAll(async () => {
  db = await createDb()
  owner = await createUser(db, 'owner@example.com')
  cashier = await createUser(db, 'cashier@example.com')
  outsider = await createUser(db, 'outsider@example.com')
  biz = await asUser(db, owner, () => createBiz('CityMart'))
  await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'cashier@example.com', 'cashier')`, [biz]))
  await asUser(db, cashier, () => rows(db, 'select public.accept_my_invitations()'))
})

describe('archive_business (live path)', () => {
  it('rejects staff, outsiders and anonymous callers', async () => {
    await expect(asUser(db, cashier, () => archive(biz, 'CityMart'))).rejects.toThrow(/only the owner/)
    await expect(asUser(db, outsider, () => archive(biz, 'CityMart'))).rejects.toThrow(/only the owner/)
    await expect(asUser(db, null, () => archive(biz, 'CityMart'))).rejects.toThrow()
    expect(await asUser(db, owner, visible)).toHaveLength(1)
  })

  it('needs the exact business name', async () => {
    await expect(asUser(db, owner, () => archive(biz, 'citymart'))).rejects.toThrow(/exactly/)
    await expect(asUser(db, owner, () => archive(biz, ''))).rejects.toThrow(/exactly/)
    expect(await asUser(db, owner, visible)).toHaveLength(1)
  })

  it('archives for everyone, keeps the records, and cannot be repeated', async () => {
    await asUser(db, owner, () => archive(biz, ' CityMart '))
    expect(await asUser(db, owner, visible)).toHaveLength(0)
    expect(await asUser(db, cashier, visible)).toHaveLength(0)
    const [row] = await rows<{ status: string; archived_at: string | null }>(db, 'select status, archived_at from public.businesses where id = $1', [biz])
    expect(row.status).toBe('archived')
    expect(row.archived_at).not.toBeNull()
    expect(await rows(db, 'select 1 from public.business_members where business_id = $1', [biz])).toHaveLength(2)
    await expect(asUser(db, owner, () => archive(biz, 'CityMart'))).rejects.toThrow(/only the owner/)
  })
})

describe('demoArchiveBusiness (mirrors the rules)', () => {
  it('is owner-only, needs the exact name and hides the business', () => {
    demoSignIn('cashier@demo.test', 'demo1234')
    expect(demoArchiveBusiness('b-retail', 'CityMart')).toMatch(/only the owner/)
    demoSignOut()
    demoSignIn('owner@demo.test', 'demo1234')
    expect(demoArchiveBusiness('b-retail', 'wrong')).toMatch(/exactly/)
    const name = getDemoState().businesses.find((b) => b.id === 'b-retail')!.name
    expect(demoArchiveBusiness('b-retail', name)).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === 'b-retail')?.archived).toBe(true)
    expect(demoArchiveBusiness('b-retail', name)).toMatch(/only the owner/)
    demoSignOut()
  })
})
