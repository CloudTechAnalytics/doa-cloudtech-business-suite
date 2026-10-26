import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, outsider: string, biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const theme = async () => (await q<{ t: string | null }>(`select settings ->> 'theme' as t from public.businesses where id = $1`, [biz]))[0].t

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, outsider] = await Promise.all(['o', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
  await as(owner, () => q(`select public.invite_member($1,'c@example.com','cashier')`, [biz]))
  await as(cashier, () => q('select public.accept_my_invitations()'))
})

describe('a business choosing its colour theme', () => {
  it('starts with no choice, which the app shows as the default Ocean theme', async () => { expect(await theme()).toBeNull() })

  it('lets the owner pick a named theme and keeps the rest of the settings', async () => {
    await as(owner, () => q(`update public.businesses set settings = settings || '{"tax_rate_percent": 7.5}'::jsonb where id = $1`, [biz]))
    await as(owner, () => q(`select public.set_business_theme($1,'violet')`, [biz]))
    expect(await theme()).toBe('violet')
    expect((await q<{ r: string }>(`select settings ->> 'tax_rate_percent' as r from public.businesses where id = $1`, [biz]))[0].r).toBe('7.5')
  })

  it('refuses anything that is not a named theme, however it is sent', async () => {
    await expect(as(owner, () => q(`select public.set_business_theme($1,'#ff0000')`, [biz]))).rejects.toThrow(/colour themes/)
    await expect(as(owner, () => q(`select public.set_business_theme($1,null)`, [biz]))).rejects.toThrow(/colour themes/)
    await expect(as(owner, () => q(`update public.businesses set settings = settings || '{"theme": "red; background:url(x)"}'::jsonb where id = $1`, [biz]))).rejects.toThrow(/colour themes/)
    expect(await theme()).toBe('violet')
  })

  it('is closed to people without settings access and to other businesses', async () => {
    await expect(as(cashier, () => q(`select public.set_business_theme($1,'rose')`, [biz]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q(`select public.set_business_theme($1,'rose')`, [biz]))).rejects.toThrow(/permission denied/)
    expect(await theme()).toBe('violet')
    const seen = await as(cashier, () => q<{ t: string }>(`select settings ->> 'theme' as t from public.businesses where id = $1`, [biz]))
    expect(seen[0].t).toBe('violet') // every member sees the business theme
  })
})
