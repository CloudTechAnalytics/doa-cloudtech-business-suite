import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, viewer: string, staff: string, outsider: string
let biz: string, shop: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const at = (days: number, hour = 9) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString() }

type Opts = { id?: string | null; title?: string; start?: string; end?: string; repeat?: string; until?: string | null; visibility?: string; remind?: number | null; attendees?: string[]; url?: string; kind?: string; allDay?: boolean; b?: string }
const save = (u: string, o: Opts = {}) => as(u, () => q<{ id: string }>(
  'select public.calendar_save_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,null,null,$15,$16::uuid[]) as id',
  [o.b ?? biz, o.id ?? null, o.title ?? 'Stock-taking', '', 'Shop floor', o.url ?? '', o.kind ?? 'meeting', o.allDay ?? false, o.start ?? at(1), o.end ?? at(1, 10), o.repeat ?? 'none', o.until ?? null, o.visibility ?? 'business', o.remind === undefined ? 30 : o.remind, '', o.attendees ?? []],
)).then((r) => r[0].id)
const event = async (id: string) => (await q<{ title: string; skip_dates: string[]; repeat: string; created_by: string }>('select title, skip_dates::text[] as skip_dates, repeat, created_by from public.calendar_events where id=$1', [id]))[0]
const visible = (u: string) => as(u, () => q<{ id: string }>('select id from public.calendar_events')).then((r) => r.map((x) => x.id))

beforeAll(async () => {
  db = await createDb()
  ;[owner, viewer, staff, outsider] = await Promise.all(['o', 'v', 's', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  shop = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other Shop','general') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[viewer, 'viewer'], [staff, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
})

describe('the Calendar app', () => {
  it('is on for Business apps by default, free in every plan, and an app of its own', async () => {
    const mods = await as(owner, () => q<{ module_code: string; enabled: boolean }>('select module_code, enabled from public.my_modules($1)', [biz]))
    expect(mods.find((m) => m.module_code === 'calendar')).toMatchObject({ enabled: true })
    const plans = await q<{ code: string; included: boolean }>(`select p.code, pm.included from public.plan_modules pm join public.modules m on m.id = pm.module_id join public.subscription_plans p on p.id = pm.plan_id where m.code = 'calendar'`)
    expect(plans.length).toBeGreaterThan(0); expect(plans.every((p) => p.included)).toBe(true)
    expect((await q<{ module: string }>(`select module from public.app_modules where app = 'calendar'`)).map((r) => r.module)).toEqual(['calendar'])
    expect((await q<{ a: string[] }>('select public._business_apps($1) as a', [biz]))[0].a).toContain('calendar')
  })
  it('can be switched on in a shop but is not offered to a school', async () => {
    const school = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
    const retail = (await as(owner, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
    const has = async (b: string) => (await as(owner, () => q<{ module_code: string; enabled: boolean }>('select module_code, enabled from public.my_modules($1)', [b]))).find((m) => m.module_code === 'calendar')
    expect(await has(retail)).toMatchObject({ enabled: false }); expect(await has(school)).toBeUndefined()
  })
})

describe('events', () => {
  it('are made by people who can manage the calendar, with the title, times, kind and a reminder', async () => {
    const id = await save(staff, { title: 'Supplier visit', kind: 'appointment', remind: 10 })
    expect(await event(id)).toMatchObject({ title: 'Supplier visit', created_by: staff })
    expect((await q<{ kind: string; remind_minutes: number }>('select kind, remind_minutes from public.calendar_events where id=$1', [id]))[0]).toEqual({ kind: 'appointment', remind_minutes: 10 })
  })
  it('are checked: a title, an end after the start, a real kind and link, a sensible repeat, at most 50 invited', async () => {
    await expect(save(owner, { title: '   ' })).rejects.toThrow(/title/)
    await expect(save(owner, { start: at(2, 10), end: at(2, 9) })).rejects.toThrow(/cannot end before it starts/)
    await expect(save(owner, { kind: 'party' })).rejects.toThrow()
    await expect(save(owner, { url: 'ftp://nope' })).rejects.toThrow()
    await expect(save(owner, { repeat: 'weekly', until: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) })).rejects.toThrow(/cannot end before the first event/)
    await expect(save(owner, { remind: -5 })).rejects.toThrow()
    await expect(save(owner, { attendees: Array.from({ length: 51 }, () => '00000000-0000-0000-0000-000000000000') })).rejects.toThrow(/at most 50/)
  })
  it('need the manage permission: a viewer can look but not add, change or delete', async () => {
    await expect(save(viewer)).rejects.toThrow(/permission denied/)
    const id = await save(owner, { title: 'Owner only' })
    await expect(save(viewer, { id, title: 'Hijack' })).rejects.toThrow(/permission denied/)
    await expect(as(viewer, () => q('select public.calendar_delete_event($1)', [id]))).rejects.toThrow(/permission denied/)
    expect((await visible(viewer))).toContain(id)
  })
  it('are closed to other businesses, in both directions', async () => {
    const id = await save(owner, { title: 'Ours' })
    expect(await visible(outsider)).not.toContain(id)
    await expect(save(outsider, { b: biz })).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.calendar_delete_event($1)', [id]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.calendar_respond($1,$2)', [id, 'accepted']))).rejects.toThrow(/permission denied/)
    expect(await event(id)).toBeTruthy()
  })
  it('can be written only through the functions, never straight into the table', async () => {
    await expect(as(owner, () => q(`insert into public.calendar_events (business_id, title, starts_at, ends_at) values ($1,'Sneaky',now(),now())`, [biz]))).rejects.toThrow()
    const id = await save(owner, { title: 'Guarded' })
    await expect(as(owner, () => q(`update public.calendar_events set title = 'Changed' where id = $1`, [id]))).rejects.toThrow()
    await expect(as(owner, () => q('delete from public.calendar_events where id = $1', [id]))).rejects.toThrow()
  })
})

describe('who can change an event', () => {
  it('is whoever made it, or someone who manages the business; other staff cannot', async () => {
    const id = await save(staff, { title: 'Staff event' })
    await save(owner, { id, title: 'Owner renamed it' }) // the owner manages settings
    expect((await event(id)).title).toBe('Owner renamed it')
    const mine = await save(owner, { title: 'Owner event' })
    await expect(save(staff, { id: mine, title: 'Nope' })).rejects.toThrow(/only the person who made this event/)
    await expect(as(staff, () => q('select public.calendar_delete_event($1)', [mine]))).rejects.toThrow(/only the person who made this event/)
    const own = await save(staff, { title: 'Delete me' })
    await as(staff, () => q('select public.calendar_delete_event($1)', [own]))
  })
  it('writes the delete to the audit log before the event goes', async () => {
    const id = await save(owner, { title: 'Audited' })
    await as(owner, () => q('select public.calendar_delete_event($1)', [id]))
    expect(await q('select 1 from public.calendar_events where id=$1', [id])).toHaveLength(0)
    expect((await q<{ metadata: { name: string } }>(`select metadata from public.audit_logs where entity_id=$1 and action='calendar_events.delete'`, [id]))[0].metadata.name).toBe('Audited')
  })
})

describe('private events and invitations', () => {
  it('are seen by the maker and the people invited, and by nobody else', async () => {
    const id = await save(owner, { title: 'Review', visibility: 'private', attendees: [staff] })
    expect(await visible(owner)).toContain(id); expect(await visible(staff)).toContain(id)
    expect(await visible(viewer)).not.toContain(id); expect(await visible(outsider)).not.toContain(id)
    expect(await as(viewer, () => q('select 1 from public.calendar_attendees where event_id=$1', [id]))).toHaveLength(0) // the invitations are private too
  })
  it('can only invite people who are on the business, and keep each answer when the event is changed', async () => {
    await expect(save(owner, { attendees: [outsider] })).rejects.toThrow(/people who are on this business/)
    const id = await save(owner, { title: 'Team lunch', attendees: [staff, viewer] })
    await as(staff, () => q('select public.calendar_respond($1,$2)', [id, 'accepted']))
    await save(owner, { id, title: 'Team lunch (moved)', attendees: [staff] }) // viewer is taken off, staff keeps the answer
    const att = await q<{ user_id: string; response: string }>('select user_id, response from public.calendar_attendees where event_id=$1', [id])
    expect(att).toEqual([{ user_id: staff, response: 'accepted' }])
  })
  it('are answered by the person invited, for themselves only, with a real answer', async () => {
    const id = await save(owner, { title: 'Parent call', attendees: [staff] })
    await expect(as(staff, () => q('select public.calendar_respond($1,$2)', [id, 'attending']))).rejects.toThrow(/accepted, declined or maybe/)
    await as(staff, () => q('select public.calendar_respond($1,$2)', [id, 'maybe']))
    expect((await q<{ response: string }>('select response from public.calendar_attendees where event_id=$1 and user_id=$2', [id, staff]))[0].response).toBe('maybe')
    await expect(as(viewer, () => q('select public.calendar_respond($1,$2)', [id, 'accepted']))).rejects.toThrow(/not invited/)
  })
})

describe('repeating events', () => {
  it('can lose single days without losing the series, and only if they repeat', async () => {
    const id = await save(owner, { title: 'Weekly review', repeat: 'weekly' })
    await as(owner, () => q('select public.calendar_skip_occurrence($1,$2)', [id, '2031-03-04']))
    await as(owner, () => q('select public.calendar_skip_occurrence($1,$2)', [id, '2031-03-04'])) // the same day twice is one entry
    await as(owner, () => q('select public.calendar_skip_occurrence($1,$2)', [id, '2031-02-25']))
    expect((await event(id)).skip_dates.map((d) => String(d).slice(0, 10))).toEqual(['2031-02-25', '2031-03-04'])
    const once = await save(owner, { title: 'One-off' })
    await expect(as(owner, () => q('select public.calendar_skip_occurrence($1,$2)', [once, '2031-03-04']))).rejects.toThrow(/does not repeat/)
    await expect(as(staff, () => q('select public.calendar_skip_occurrence($1,$2)', [id, '2031-03-11']))).rejects.toThrow(/only the person who made/)
  })
  it('forget the skipped days when the event stops repeating', async () => {
    const id = await save(owner, { title: 'Was weekly', repeat: 'weekly' })
    await as(owner, () => q('select public.calendar_skip_occurrence($1,$2)', [id, '2031-03-04']))
    await save(owner, { id, title: 'Was weekly', repeat: 'none' })
    expect(await event(id)).toMatchObject({ repeat: 'none', skip_dates: [] })
  })
})

describe('the platform console counts the new app', () => {
  it('counts events as use of the Calendar app', async () => {
    const [act] = await q<{ a: { calendar: { records: number; last_at: string | null } } }>('select public._app_activity($1) as a', [biz])
    expect(act.a.calendar.records).toBeGreaterThan(0); expect(act.a.calendar.last_at).not.toBeNull()
    const none = (await q<{ a: { calendar: { records: number } } }>('select public._app_activity($1) as a', [shop]))[0].a.calendar
    expect(none.records).toBe(0)
  })
})
