import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let ada: string, bola: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const titleOf = async (u: string) => (await q<{ t: string | null }>('select job_title as t from public.profiles where id = $1', [u]))[0].t

beforeAll(async () => {
  db = await createDb()
  ;[ada, bola] = await Promise.all(['ada', 'bola'].map((p) => createUser(db, `${p}@example.com`)))
})

describe('a person describing their own job', () => {
  it('starts empty, so the app shows the role', async () => { expect(await titleOf(ada)).toBeNull() })

  it('lets someone set and clear their own title', async () => {
    await as(ada, () => q(`update public.profiles set job_title = 'Principal' where id = $1`, [ada]))
    expect(await titleOf(ada)).toBe('Principal')
    await as(ada, () => q(`update public.profiles set job_title = null where id = $1`, [ada]))
    expect(await titleOf(ada)).toBeNull()
  })

  it('keeps it short and not blank', async () => {
    await expect(as(ada, () => q(`update public.profiles set job_title = $2 where id = $1`, [ada, 'x'.repeat(61)]))).rejects.toThrow(/job_title/)
    await expect(as(ada, () => q(`update public.profiles set job_title = '   ' where id = $1`, [ada]))).rejects.toThrow(/job_title/)
    await as(ada, () => q(`update public.profiles set job_title = $2 where id = $1`, [ada, 'x'.repeat(60)]))
    expect((await titleOf(ada))!.length).toBe(60)
  })

  it('cannot be set for someone else', async () => {
    await as(bola, () => q(`update public.profiles set job_title = 'Director' where id = $1`, [ada]))
    expect((await titleOf(ada))!.startsWith('x')).toBe(true) // unchanged: the update matched no rows for Bola
    await as(bola, () => q(`update public.profiles set job_title = 'Director' where id = $1`, [bola]))
    expect(await titleOf(bola)).toBe('Director')
  })
})
