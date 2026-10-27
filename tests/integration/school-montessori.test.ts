import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, guide: string, guide2: string, parent: string, outsider: string
let biz: string, ch: string, lower: string, ada: string, bola: string, cyril: string, term1: string
let n = 0
const key = () => `mo-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const names = async (b: string, t: string, where = '') => (await q<{ name: string }>(`select name from public.${t} where business_id=$1 ${where} order by name`, [b])).map((r) => r.name)
const fresh = async (type: string) => {
  const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('M ${n++}','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q(`select public.school_setup($1,$2,'2026/2027',current_date - 20)`, [b, type]))
  return b
}
const reg = async (first: string, cls: string, guardians: unknown[] = []) => (await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [biz, J({ first, last: 'Child', class_id: cls }), J(guardians), key()])))[0].r.student_id
const work = async (area: string, name: string) => (await q<{ id: string }>(`select w.id from public.school_works w join public.school_subjects s on s.id = w.subject_id where s.business_id=$1 and s.name=$2 and w.name=$3`, [biz, area, name]))[0].id
const area = async (name: string) => (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, name]))[0].id
const record = (u: string, w: string, items: unknown[]) => as(u, () => q('select public.school_record_progress($1,$2,$3::jsonb) as n', [biz, w, J(items)]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, guide, guide2, parent, outsider] = await Promise.all(['o', 'g', 'g2', 'p', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = await fresh('montessori')
  for (const [u, e, r] of [[guide, 'g@example.com', 'teacher'], [guide2, 'g2@example.com', 'teacher'], [parent, 'p@example.com', 'parent']] as const) { await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, e, r])); await as(u, () => q('select public.accept_my_invitations()')) }
  ch = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Children''s House'`, [biz]))[0].id
  lower = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Lower Elementary'`, [biz]))[0].id
  ada = await reg('Ada', ch, [{ name: 'Mrs Child', email: 'p@example.com', relationship: 'mother', primary: true }]); bola = await reg('Bola', ch); cyril = await reg('Cyril', lower)
  term1 = (await q<{ id: string }>(`select id from public.school_terms where business_id=$1 order by starts_on limit 1`, [biz]))[0].id
  await as(parent, () => q('select public.school_claim_links($1)', [biz]))
  await as(owner, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'Guide G', 'g@example.com', 'Guide'])); await as(guide, () => q('select public.school_claim_links($1)', [biz]))
  const st = (await q<{ id: string }>('select id from public.school_staff where business_id=$1', [biz]))[0].id
  await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, st, J([{ class_id: ch, subject_id: null, class_teacher: true }])]))
})

describe('a Montessori school', () => {
  it('starts with the four environments with their age ranges, the curriculum areas and the standard works', async () => {
    expect(await names(biz, 'school_classes')).toEqual(["Children's House", 'Lower Elementary', 'Toddler Community', 'Upper Elementary'])
    expect((await q<{ name: string; description: string }>(`select name, description from public.school_classes where business_id=$1 and name='Children''s House'`, [biz]))[0].description).toBe('Ages 3 to 6 years')
    expect(await names(biz, 'school_subjects')).toEqual(['Art and Music', 'Cultural Studies', 'Grace and Courtesy', 'Language', 'Mathematics', 'Practical Life', 'Sensorial'])
    expect(await names(biz, 'school_departments')).toEqual([])
    const pl = await q<{ name: string }>(`select w.name from public.school_works w join public.school_subjects s on s.id = w.subject_id where s.business_id=$1 and s.name='Practical Life' order by w.position`, [biz])
    expect(pl.length).toBeGreaterThan(10); expect(pl[0].name).toBe('Pouring dry materials')
    expect((await q('select 1 from public.school_class_subjects cs join public.school_classes c on c.id = cs.class_id where c.id = $1', [ch])).length).toBe(7)
  })

  it('is its own kind: "all" never includes Montessori and a Montessori school refuses other stages', async () => {
    const all = await fresh('combined')
    expect(await names(all, 'school_classes', `and stage = 'montessori'`)).toEqual([])
    expect(await names(all, 'school_subjects', `and levels && array['montessori']`)).toEqual([])
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Extra',1,null,true,'montessori')`, [all]))).rejects.toThrow(/cannot have montessori environments/)
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Primary 1',3,null,true,'primary')`, [biz]))).rejects.toThrow(/cannot have primary classes/)
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Elementary Two',5,null,true,'montessori')`, [biz]))).resolves.toBeTruthy()
  })
})

describe('recording progress', () => {
  it('lets the guide record for children in their own environment only, and managers for anyone', async () => {
    const w = await work('Practical Life', 'Pouring water')
    await record(guide, w, [{ student_id: ada, status: 'introduced' }, { student_id: bola, status: 'practising', note: 'Spills less each day' }])
    await expect(record(guide, w, [{ student_id: cyril, status: 'introduced' }])).rejects.toThrow(/permission denied/)
    await expect(record(guide2, w, [{ student_id: ada, status: 'mastered' }])).rejects.toThrow(/permission denied/)
    await expect(record(parent, w, [{ student_id: ada, status: 'mastered' }])).rejects.toThrow(/permission denied/)
    await record(owner, w, [{ student_id: cyril, status: 'mastered' }])
    expect((await q<{ student_id: string; status: string }>('select student_id, status from public.school_work_progress where work_id=$1', [w])).length).toBe(3)
  })

  it('moves a child along, keeps the date, and clears with a null status', async () => {
    const w = await work('Practical Life', 'Pouring water')
    await record(guide, w, [{ student_id: ada, status: 'mastered' }])
    const row = (await q<{ status: string; on_date: string }>('select status, on_date::text from public.school_work_progress where student_id=$1 and work_id=$2', [ada, w]))[0]
    expect(row.status).toBe('mastered'); expect(row.on_date).toBe((await q<{ d: string }>('select current_date::text as d'))[0].d)
    await record(guide, w, [{ student_id: ada, status: null }])
    expect(await q('select 1 from public.school_work_progress where student_id=$1 and work_id=$2', [ada, w])).toHaveLength(0)
    await expect(record(guide, w, [{ student_id: bola, status: 'expert' }])).rejects.toThrow(/introduced, practising or mastered/)
    await expect(record(guide, w, [])).rejects.toThrow(/choose the children/)
  })

  it('shows progress to the guide and the child\'s parent, and to nobody else', async () => {
    const w = await work('Sensorial', 'Pink tower')
    await record(owner, w, [{ student_id: ada, status: 'practising' }, { student_id: cyril, status: 'practising' }])
    expect((await as(parent, () => q<{ student_id: string }>('select student_id from public.school_work_progress where work_id=$1', [w]))).map((r) => r.student_id)).toEqual([ada])
    expect((await as(guide, () => q<{ student_id: string }>('select student_id from public.school_work_progress where work_id=$1', [w]))).map((r) => r.student_id)).toEqual([ada])
    expect(await as(outsider, () => q('select 1 from public.school_work_progress'))).toHaveLength(0)
  })
})

describe('the works list and the progress report', () => {
  it('is changed by managers only, keeping progress on the works that stay', async () => {
    const lang = await area('Language'); const sp = await work('Language', 'Sandpaper letters')
    await record(owner, sp, [{ student_id: ada, status: 'introduced' }])
    await expect(as(guide, () => q('select public.school_save_works($1,$2,$3)', [biz, lang, ['x']]))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.school_save_works($1,$2,$3::text[])', [biz, lang, ['Sandpaper letters', 'Phonogram work', '  ', 'Reading books']]))
    expect((await q<{ name: string }>('select name from public.school_works where subject_id=$1 order by position', [lang])).map((r) => r.name)).toEqual(['Sandpaper letters', 'Phonogram work', 'Reading books'])
    expect(await q('select 1 from public.school_work_progress where student_id=$1 and work_id=$2', [ada, sp])).toHaveLength(1)
  })

  it('builds the report: each area with its works, where the child is, counts and the guide\'s note', async () => {
    const pl = await area('Practical Life'); const w = await work('Practical Life', 'Spooning')
    await record(guide, w, [{ student_id: ada, status: 'mastered' }])
    await as(guide, () => q('select public.school_save_progress_note($1,$2,$3,$4,$5)', [biz, ada, term1, pl, 'Works with great care.']))
    await expect(as(guide, () => q('select public.school_save_progress_note($1,$2,$3,$4,$5)', [biz, cyril, term1, pl, 'no']))).rejects.toThrow(/permission denied/)
    const r = (await as(parent, () => q<{ r: { student: { name: string; age: string }; areas: { subject: string; note: string | null; works: { name: string; status: string | null }[] }[]; term: string; school: { name: string } } }>('select public.school_progress_report($1,$2) as r', [ada, term1])))[0].r
    expect(r.student).toMatchObject({ name: 'Ada Child', age: 'Ages 3 to 6 years' }); expect(r.term).toBe('First Term')
    expect(r.areas.map((a) => a.subject)).toEqual(['Art and Music', 'Cultural Studies', 'Grace and Courtesy', 'Language', 'Mathematics', 'Practical Life', 'Sensorial'])
    const practical = r.areas.find((a) => a.subject === 'Practical Life')!
    expect(practical.note).toBe('Works with great care.'); expect(practical.works.find((x) => x.name === 'Spooning')!.status).toBe('mastered'); expect(practical.works.find((x) => x.name === 'Pouring dry materials')!.status).toBeNull()
    await expect(as(parent, () => q('select public.school_progress_report($1,$2)', [bola, term1]))).rejects.toThrow(/permission denied/)
    await as(guide, () => q('select public.school_save_progress_note($1,$2,$3,$4,$5)', [biz, ada, term1, pl, '']))
    expect(await q('select 1 from public.school_progress_notes where student_id=$1', [ada])).toHaveLength(0)
  })

  it('goes with the child when the child is deleted', async () => {
    const x = await reg('Gone Soon', ch)
    await record(owner, await work('Sensorial', 'Red rods'), [{ student_id: x, status: 'introduced' }])
    await as(owner, () => q('select public.school_delete_student($1,$2)', [x, 'Entered twice by mistake']))
    expect(await q('select 1 from public.school_work_progress where student_id=$1', [x])).toHaveLength(0)
  })
})

describe('switching a school to and from Montessori', () => {
  it('builds the environments, areas and works when a primary school becomes Montessori, and removes unused ones going back', async () => {
    const b = await fresh('primary')
    const set = (type: string) => as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, type, '{1,2,3,4,5}']))
    await set('montessori')
    expect(await names(b, 'school_classes', 'and active')).toEqual(["Children's House", 'Lower Elementary', 'Toddler Community', 'Upper Elementary'])
    expect((await q('select 1 from public.school_works w join public.school_subjects s on s.id = w.subject_id where s.business_id=$1', [b])).length).toBeGreaterThan(50)
    await set('primary')
    expect(await names(b, 'school_classes', 'and active')).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(await names(b, 'school_subjects', `and levels && array['montessori']`)).toEqual([])
  })
})
