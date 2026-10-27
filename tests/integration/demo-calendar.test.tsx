import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, buildQuickActions, sidebarEntries } from '@/app/navigation/navigation'
import { STANDALONE_APPS, appState } from '@/core/app-catalogue/apps'
import { startWithApp } from '@/core/app-catalogue/startWithApp'
import { getIndustry } from '@/core/industry-registry'
import { getCalendar, demoCalendarEvents } from '@/demo/demoCalendar'
import { demoCreateBusiness, demoModuleStatuses, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import { deleteEvent, listEvents, respond, saveEvent, skipOccurrence } from '@/modules/calendar/calendarApi'
import { dueReminders, expand, newDraft } from '@/modules/calendar/calendarLogic'
import type { Draft } from '@/modules/calendar/calendarLogic'
import { calendarModule } from '@/modules/calendar/manifest'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const soon = (days: number, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d }
const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const draft = (o: Partial<Draft> = {}): Draft => ({ ...newDraft(soon(1)), title: 'Stock-taking', start: local(soon(1)), end: local(soon(1, 10)), ...o })
const wide = [new Date(Date.now() - 400 * 86400000), new Date(Date.now() + 400 * 86400000)] as const
const all = () => listEvents(biz, ...wide)
let biz: string
let cashier: string | null = null

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general'); await getIndustry('general').afterCreate?.(biz, {})
  // a second person on the business, so there is someone to invite and to be refused
  getDemoState().members.push({ id: 'mcal', businessId: biz, userId: 'u-cashier', email: 'cashier@demo.test', name: 'Demo Cashier', role: 'cashier', status: 'active' })
  cashier = 'u-cashier'
})

describe('events in the demo mirror', () => {
  it('are added with their details, and listed with who made them', async () => {
    expect(await saveEvent(biz, draft({ title: 'Supplier visit', kind: 'appointment', location: 'Shop floor', remindMinutes: 10 }))).toBeNull()
    const e = (await all()).find((x) => x.title === 'Supplier visit')!
    expect(e).toMatchObject({ kind: 'appointment', location: 'Shop floor', remindMinutes: 10, visibility: 'business', createdBy: 'u-owner', repeat: 'none' })
  })
  it('are checked like the database: a title, an end after the start, a real link, a sensible repeat and reminder, at most 50 invited', async () => {
    expect(await saveEvent(biz, draft({ title: '   ' }))).toMatch(/title/)
    expect(await saveEvent(biz, draft({ start: local(soon(2, 10)), end: local(soon(2, 9)) }))).toMatch(/cannot end before it starts/)
    expect(await saveEvent(biz, draft({ meetingUrl: 'ftp://nope' }))).toMatch(/http/)
    expect(await saveEvent(biz, draft({ repeat: 'weekly', repeatUntil: '2001-01-01' }))).toMatch(/cannot end before the first event/)
    expect(await saveEvent(biz, draft({ remindMinutes: -5 }))).toMatch(/reminder/)
    expect(await saveEvent(biz, draft({ attendees: Array.from({ length: 51 }, (_, i) => `u${i}`) }))).toMatch(/at most 50/)
  })
  it('can only invite people on the business, and keep each answer when the event is changed', async () => {
    expect(await saveEvent(biz, draft({ attendees: ['u-nobody'] }))).toMatch(/people who are on this business/)
    expect(await saveEvent(biz, draft({ title: 'Team lunch', attendees: [cashier!, 'u-owner'] }))).toBeNull()
    const id = (await all()).find((x) => x.title === 'Team lunch')!.id
    as('cashier@demo.test'); expect(await respond(biz, id, 'accepted')).toBeNull(); as('owner@demo.test')
    expect(await saveEvent(biz, { ...draft({ title: 'Team lunch (moved)', attendees: [cashier!] }), id })).toBeNull()
    const e = (await all()).find((x) => x.id === id)!
    expect(e.attendees).toEqual([{ userId: cashier, name: 'Demo Cashier', response: 'accepted' }]); expect(e.title).toBe('Team lunch (moved)')
  })
  it('can be private: seen by the maker and the people invited, and by nobody else', async () => {
    expect(await saveEvent(biz, draft({ title: 'Review', visibility: 'private', attendees: [cashier!] }))).toBeNull()
    const titles = async () => (await all()).map((e) => e.title)
    expect(await titles()).toContain('Review')
    as('cashier@demo.test'); expect(await titles()).toContain('Review')
    getDemoState().members.push({ id: 'mcal2', businessId: biz, userId: 'u-acct', email: 'accountant@demo.test', name: 'Demo Accountant', role: 'accountant', status: 'active' })
    as('accountant@demo.test'); expect(await titles()).not.toContain('Review'); expect(await titles()).toContain('Supplier visit')
    as('owner@demo.test')
  })
  it('are answered by the person invited, for themselves, with a real answer', async () => {
    expect(await saveEvent(biz, draft({ title: 'Parent call', attendees: [cashier!] }))).toBeNull()
    const id = (await all()).find((x) => x.title === 'Parent call')!.id
    as('cashier@demo.test'); expect(await respond(biz, id, 'attending' as never)).toMatch(/accepted, declined or maybe/); expect(await respond(biz, id, 'maybe')).toBeNull()
    expect((await all()).find((x) => x.id === id)!.attendees[0].response).toBe('maybe')
    as('accountant@demo.test'); expect(await respond(biz, id, 'accepted')).toMatch(/not invited|permission/); as('owner@demo.test')
  })
  it('can be changed or deleted by the maker or someone who manages the business, and by nobody else', async () => {
    as('cashier@demo.test'); expect(await saveEvent(biz, draft({ title: 'Cashier event' }))).toBeNull()
    const id = (await all()).find((x) => x.title === 'Cashier event')!.id
    as('owner@demo.test'); expect(await saveEvent(biz, { ...draft({ title: 'Owner renamed it' }), id })).toBeNull() // the owner manages settings
    const mine = (await all()).find((x) => x.title === 'Supplier visit')!.id
    as('cashier@demo.test'); expect(await saveEvent(biz, { ...draft({ title: 'Nope' }), id: mine })).toMatch(/only the person who made this event/); expect(await deleteEvent(biz, mine)).toMatch(/only the person who made this event/)
    expect(await deleteEvent(biz, id)).toBeNull(); as('owner@demo.test')
  })
  it('need the manage permission: a viewer can look but not add', async () => {
    getDemoState().members.push({ id: 'mcal3', businessId: biz, userId: 'u-viewer', email: 'viewer@demo.test', name: 'Demo Viewer', role: 'viewer', status: 'active' })
    const hasViewer = getDemoState().members.some((m) => m.email === 'viewer@demo.test')
    if (!hasViewer) return
    as('viewer@demo.test')
    expect(await saveEvent(biz, draft())).toMatch(/permission denied/)
    as('owner@demo.test')
  })
  it('delete for good, with the people invited', async () => {
    expect(await saveEvent(biz, draft({ title: 'Delete me', attendees: [cashier!] }))).toBeNull()
    const id = (await all()).find((x) => x.title === 'Delete me')!.id
    expect(await deleteEvent(biz, id)).toBeNull()
    expect((await all()).some((x) => x.id === id)).toBe(false); expect(getCalendar().attendees.some((a) => a.eventId === id)).toBe(false)
    expect(await deleteEvent(biz, id)).toMatch(/permission denied/)
  })
})

describe('repeating events in the demo mirror', () => {
  it('lose single days without losing the series, and only if they repeat', async () => {
    expect(await saveEvent(biz, draft({ title: 'Weekly review', repeat: 'weekly' }))).toBeNull()
    const e = (await all()).find((x) => x.title === 'Weekly review')!
    expect(await skipOccurrence(biz, e.id, '2031-03-04')).toBeNull(); expect(await skipOccurrence(biz, e.id, '2031-03-04')).toBeNull(); expect(await skipOccurrence(biz, e.id, '2031-02-25')).toBeNull()
    expect((await all()).find((x) => x.id === e.id)!.skipDates).toEqual(['2031-02-25', '2031-03-04'])
    const once = (await all()).find((x) => x.title === 'Supplier visit')!
    expect(await skipOccurrence(biz, once.id, '2031-03-04')).toMatch(/does not repeat/)
  })
  it('forget skipped days when the event stops repeating', async () => {
    const e = (await all()).find((x) => x.title === 'Weekly review')!
    expect(await saveEvent(biz, { ...draft({ title: 'Weekly review', repeat: 'none' }), id: e.id })).toBeNull()
    expect((await all()).find((x) => x.id === e.id)).toMatchObject({ repeat: 'none', skipDates: [] })
  })
})

describe('reminders for the bell, from real events', () => {
  it('show an event whose reminder time has come, from what the API returns', async () => {
    const start = new Date(Date.now() + 20 * 60000)
    expect(await saveEvent(biz, draft({ title: 'Starts soon', start: local(start), end: local(new Date(start.getTime() + 3600000)), remindMinutes: 30 }))).toBeNull()
    const now = new Date()
    const list = await listEvents(biz, new Date(now.getTime() - 3600000), new Date(now.getTime() + 2 * 86400000))
    const due = dueReminders(expand(list, new Date(now.getTime() - 3600000), new Date(now.getTime() + 2 * 86400000)), now)
    expect(due.map((r) => r.title)).toContain('Starts soon')
  })
})

describe('the Calendar app', () => {
  it('is the seventh standalone app, in the Plan and meet group, with its own module', () => {
    const app = STANDALONE_APPS.find((a) => a.id === 'calendar')!
    expect(app).toMatchObject({ category: 'plan', modules: ['calendar'], home: 'calendar' }); expect(app.features.length).toBeGreaterThan(3); expect(app.worksWith.length).toBeGreaterThan(0)
  })
  it('opens on its own when you start with it, leaving the other apps off', async () => {
    const b = demoCreateBusiness('Planner', 'general')
    expect(await startWithApp(b, 'calendar')).toBeNull()
    const st = demoModuleStatuses(b)
    expect(appState(STANDALONE_APPS.find((a) => a.id === 'calendar')!, st)).toBe('active'); expect(appState(STANDALONE_APPS.find((a) => a.id === 'crm')!, st)).toBe('available')
  })
  it('can be added to a shop, which is offered it, and not to a school', () => {
    const shop = demoModuleStatuses(demoCreateBusiness('Corner Shop', 'retail')); const school = demoModuleStatuses(demoCreateBusiness('Bright School', 'school'))
    const app = STANDALONE_APPS.find((a) => a.id === 'calendar')!
    expect(appState(app, shop)).toBe('available'); expect(appState(app, school)).toBe('unavailable')
  })
  it('lists its four views in the sidebar, and a New event action in the Record menu', () => {
    expect(calendarModule.definition.sections!.map((s) => s.key)).toEqual(['week', 'month', 'day', 'agenda'])
    const entries = sidebarEntries(buildApps('general', new Set(['dashboard', 'calendar']))).filter((e) => e.kind === 'section' && e.module.code === 'calendar')
    expect(entries.map((e) => (e.kind === 'section' ? e.section.key : ''))).toEqual(['week', 'month', 'day', 'agenda'])
    expect(buildQuickActions('general', new Set(['dashboard', 'calendar'])).some((a) => a.label === 'New event' && a.to === '/app/calendar?new=1')).toBe(true)
  })
  it('is closed to a role that cannot read it', () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Closed Co', 'general')
    as('teacher@demo.test')
    expect(() => demoCalendarEvents(b, '2000-01-01', '2100-01-01')).toThrow(/permission denied/)
    as('owner@demo.test')
  })
})
