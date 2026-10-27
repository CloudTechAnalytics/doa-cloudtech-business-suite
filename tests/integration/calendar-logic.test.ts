import { describe, expect, it } from 'vitest'
import {
  KINDS, addDays, addMonths, applyFilter, byDay, dayKey, draftFromEvent, dueReminders, expand, followupOverlays, invoiceOverlays, layoutDay, monthGrid, newDraft, occurrencesOf, parseDay, rangeTitle,
  reminderText, shiftAnchor, startOfWeek, timeLabel, toIcs, toRange, validateDraft, viewRange, weekDays, whenLabel,
} from '@/modules/calendar/calendarLogic'
import type { CalEvent } from '@/modules/calendar/calendarLogic'

// Dates are built in the local time zone, as the screens work, so these pass wherever they run.
const D = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const ev = (o: Partial<CalEvent> & { start?: Date; end?: Date } = {}): CalEvent => ({
  id: 'e1', title: 'Stock-taking', description: '', location: '', meetingUrl: null, kind: 'meeting', allDay: false, startsAt: (o.start ?? D(2031, 3, 3, 9)).toISOString(), endsAt: (o.end ?? D(2031, 3, 3, 10)).toISOString(),
  repeat: 'none', repeatUntil: null, skipDates: [], visibility: 'business', remindMinutes: null, createdBy: 'u1', attendees: [], ...o,
})
const days = (e: CalEvent, from: Date, to: Date) => occurrencesOf(e, from, to).map((o) => dayKey(o.start))

describe('dates', () => {
  it('adds months and clamps to the end of a shorter month, keeping the time of day', () => {
    expect(dayKey(addMonths(D(2031, 1, 31, 9, 30), 1))).toBe('2031-02-28'); expect(addMonths(D(2031, 1, 31, 9, 30), 1).getHours()).toBe(9)
    expect(dayKey(addMonths(D(2032, 1, 31), 1))).toBe('2032-02-29'); expect(dayKey(addMonths(D(2031, 12, 15), 1))).toBe('2032-01-15'); expect(dayKey(addMonths(D(2031, 3, 15), -3))).toBe('2030-12-15')
  })
  it('starts a week on Monday', () => {
    expect(dayKey(startOfWeek(D(2031, 3, 5)))).toBe('2031-03-03'); expect(dayKey(startOfWeek(D(2031, 3, 9)))).toBe('2031-03-03'); expect(dayKey(startOfWeek(D(2031, 3, 3)))).toBe('2031-03-03')
    expect(weekDays(D(2031, 3, 5)).map(dayKey)).toEqual(['2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07', '2031-03-08', '2031-03-09'])
  })
  it('turns a day into text and back', () => { expect(dayKey(parseDay('2031-03-04'))).toBe('2031-03-04'); expect(dayKey(addDays(D(2031, 3, 31), 1))).toBe('2031-04-01') })
  it('says a time in plain words', () => { expect(timeLabel(D(2031, 1, 1, 9))).toBe('9 am'); expect(timeLabel(D(2031, 1, 1, 12, 30))).toBe('12:30 pm'); expect(timeLabel(D(2031, 1, 1, 0))).toBe('12 am'); expect(timeLabel(D(2031, 1, 1, 23, 5))).toBe('11:05 pm') })
})

describe('repeating events', () => {
  const march = [D(2031, 3, 1), D(2031, 4, 1)] as const
  it('shows a one-off event only when it touches the range', () => {
    expect(days(ev(), ...march)).toEqual(['2031-03-03']); expect(days(ev(), D(2031, 4, 1), D(2031, 5, 1))).toEqual([])
  })
  it('repeats every day, week and weekday at the same time of day', () => {
    expect(days(ev({ repeat: 'daily' }), D(2031, 3, 1), D(2031, 3, 8))).toEqual(['2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07'])
    expect(days(ev({ repeat: 'weekly' }), ...march)).toEqual(['2031-03-03', '2031-03-10', '2031-03-17', '2031-03-24', '2031-03-31'])
    expect(days(ev({ repeat: 'weekdays', start: D(2031, 3, 7, 9), end: D(2031, 3, 7, 10) }), D(2031, 3, 1), D(2031, 3, 15))).toEqual(['2031-03-07', '2031-03-10', '2031-03-11', '2031-03-12', '2031-03-13', '2031-03-14'])
    expect(occurrencesOf(ev({ repeat: 'weekly' }), ...march).every((o) => o.start.getHours() === 9 && o.end.getHours() === 10)).toBe(true)
  })
  it('repeats monthly and yearly, clamping to a shorter month', () => {
    expect(days(ev({ repeat: 'monthly', start: D(2031, 1, 31, 9), end: D(2031, 1, 31, 10) }), D(2031, 1, 1), D(2031, 6, 1))).toEqual(['2031-01-31', '2031-02-28', '2031-03-31', '2031-04-30', '2031-05-31'])
    expect(days(ev({ repeat: 'yearly', start: D(2032, 2, 29, 9), end: D(2032, 2, 29, 10) }), D(2032, 1, 1), D(2034, 1, 1))).toEqual(['2032-02-29', '2033-02-28'])
  })
  it('stops after the last day (that whole day counts) and never shows a skipped day', () => {
    expect(days(ev({ repeat: 'daily', repeatUntil: '2031-03-05' }), ...march)).toEqual(['2031-03-03', '2031-03-04', '2031-03-05'])
    expect(days(ev({ repeat: 'weekly', skipDates: ['2031-03-10', '2031-03-24'] }), ...march)).toEqual(['2031-03-03', '2031-03-17', '2031-03-31'])
  })
  it('does not show a repeat before its first day, and finds the right days far from the start', () => {
    expect(days(ev({ repeat: 'daily' }), D(2031, 2, 1), D(2031, 3, 5))).toEqual(['2031-03-03', '2031-03-04'])
    const old = ev({ repeat: 'daily', start: D(2020, 1, 1, 9), end: D(2020, 1, 1, 10) })
    expect(days(old, ...march)).toHaveLength(31)
    const weekly = ev({ repeat: 'weekly', start: D(2020, 1, 6, 9), end: D(2020, 1, 6, 10) }) // a Monday
    expect(days(weekly, D(2031, 3, 1), D(2031, 3, 20)).every((k) => parseDay(k).getDay() === 1)).toBe(true); expect(days(weekly, D(2031, 3, 1), D(2031, 3, 20))).toHaveLength(3)
    expect(days(ev({ repeat: 'monthly', start: D(2015, 5, 12, 9), end: D(2015, 5, 12, 10) }), ...march)).toEqual(['2031-03-12'])
  })
  it('shows a long event on a repeat that began before the range', () => {
    const night = ev({ repeat: 'daily', start: D(2031, 3, 1, 22), end: D(2031, 3, 2, 6) })
    expect(days(night, D(2031, 3, 5), D(2031, 3, 6))).toEqual(['2031-03-04', '2031-03-05']) // the night that began on the 4th is still going on the morning of the 5th, and the one that begins that evening
  })
  it('sorts all-day events first and then by time, across events', () => {
    const list = expand([ev({ id: 'b', title: 'B', start: D(2031, 3, 3, 11), end: D(2031, 3, 3, 12) }), ev({ id: 'a', title: 'A', start: D(2031, 3, 3, 9), end: D(2031, 3, 3, 10) }), ev({ id: 'c', title: 'C', allDay: true, start: D(2031, 3, 3, 9), end: D(2031, 3, 3, 9) })], ...[D(2031, 3, 3), D(2031, 3, 4)] as const)
    expect(list.map((o) => o.title)).toEqual(['C', 'A', 'B'])
  })
})

describe('views', () => {
  it('draws six weeks starting on a Monday, and marks the days in the month', () => {
    const g = monthGrid(D(2031, 3, 15))
    expect(g).toHaveLength(6); expect(g.every((w) => w.length === 7)).toBe(true)
    expect(dayKey(g[0][0].date)).toBe('2031-02-24'); expect(g[0][0].inMonth).toBe(false); expect(g[0][5].inMonth).toBe(true) // Saturday 1 March
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31)
  })
  it('loads the right range for each view', () => {
    const a = D(2031, 3, 5, 14)
    expect(viewRange('day', a)).toEqual({ from: D(2031, 3, 5), to: D(2031, 3, 6) })
    expect(viewRange('week', a)).toEqual({ from: D(2031, 3, 3), to: D(2031, 3, 10) })
    expect(dayKey(viewRange('month', a).from)).toBe('2031-02-24'); expect(dayKey(viewRange('month', a).to)).toBe('2031-04-07')
    expect(viewRange('agenda', a)).toEqual({ from: D(2031, 3, 5), to: D(2031, 4, 4) })
  })
  it('moves by a page of the view', () => {
    const a = D(2031, 3, 31)
    expect(dayKey(shiftAnchor('day', a, 1))).toBe('2031-04-01'); expect(dayKey(shiftAnchor('week', a, -1))).toBe('2031-03-24'); expect(dayKey(shiftAnchor('month', a, 1))).toBe('2031-04-30'); expect(dayKey(shiftAnchor('agenda', a, -1))).toBe('2031-02-28')
  })
  it('titles each view', () => {
    const a = D(2031, 3, 5)
    expect(rangeTitle('month', a)).toBe('March 2031'); expect(rangeTitle('day', a)).toBe('Wednesday 5 March 2031'); expect(rangeTitle('week', a)).toBe('3 to 9 March 2031'); expect(rangeTitle('week', D(2031, 3, 31))).toBe('31 Mar to 6 Apr 2031')
  })
  it('describes when an event happens', () => {
    expect(whenLabel({ start: D(2031, 3, 5, 9), end: D(2031, 3, 5, 10, 30), allDay: false })).toBe('Wed 5 Mar, 9 am to 10:30 am')
    expect(whenLabel({ start: D(2031, 3, 5), end: D(2031, 3, 5), allDay: true })).toBe('Wed 5 Mar, all day')
    expect(whenLabel({ start: D(2031, 3, 5), end: D(2031, 3, 7), allDay: true })).toBe('Wed 5 Mar to Fri 7 Mar, all day')
  })
  it('puts a multi-day event on every day it spans, and not on the day after when it ends at midnight', () => {
    const three = expand([ev({ start: D(2031, 3, 3, 22), end: D(2031, 3, 5, 8) })], D(2031, 3, 1), D(2031, 3, 10))
    expect([...byDay(three).keys()]).toEqual(['2031-03-03', '2031-03-04', '2031-03-05'])
    const toMidnight = expand([ev({ start: D(2031, 3, 3, 20), end: D(2031, 3, 4, 0) })], D(2031, 3, 1), D(2031, 3, 10))
    expect([...byDay(toMidnight).keys()]).toEqual(['2031-03-03'])
  })
})

describe('placing events on a day', () => {
  const at = (id: string, sh: number, sm: number, eh: number, em: number) => expand([ev({ id, title: id, start: D(2031, 3, 3, sh, sm), end: D(2031, 3, 3, eh, em) })], D(2031, 3, 3), D(2031, 3, 4))[0]
  it('puts one event at its time with its length', () => {
    const [p] = layoutDay(D(2031, 3, 3), [at('a', 6, 0, 7, 30)])
    expect(p.top).toBeCloseTo(0.25); expect(p.height).toBeCloseTo(1.5 / 24); expect(p.col).toBe(0); expect(p.cols).toBe(1)
  })
  it('puts overlapping events side by side, and gives one that follows the full width back', () => {
    const placed = layoutDay(D(2031, 3, 3), [at('a', 9, 0, 10, 0), at('b', 9, 30, 10, 30), at('c', 11, 0, 12, 0)])
    const by = Object.fromEntries(placed.map((p) => [p.occ.title, p]))
    expect([by.a.col, by.a.cols]).toEqual([0, 2]); expect([by.b.col, by.b.cols]).toEqual([1, 2]); expect([by.c.col, by.c.cols]).toEqual([0, 1])
  })
  it('reuses a column when an earlier event has finished, and never makes an event too short to press', () => {
    const placed = layoutDay(D(2031, 3, 3), [at('a', 9, 0, 11, 0), at('b', 9, 30, 10, 0), at('c', 10, 0, 10, 30), at('d', 14, 0, 14, 0)])
    const by = Object.fromEntries(placed.map((p) => [p.occ.title, p]))
    expect(by.c.col).toBe(by.b.col) // b is over at 10, so c takes its place beside a
    expect(by.d.height).toBeCloseTo(20 / 1440)
  })
  it('leaves all-day events out of the time grid', () => {
    const all = expand([ev({ allDay: true, start: D(2031, 3, 3), end: D(2031, 3, 3) })], D(2031, 3, 3), D(2031, 3, 4))
    expect(layoutDay(D(2031, 3, 3), all)).toEqual([])
  })
})

describe('filters, overlays and reminders', () => {
  const occs = expand([ev({ id: 'm', kind: 'meeting', createdBy: 'me' }), ev({ id: 'd', kind: 'deadline', createdBy: 'other', attendees: [{ userId: 'me', name: 'Me', response: 'invited' }] }), ev({ id: 't', kind: 'task', createdBy: 'other' })], D(2031, 3, 1), D(2031, 4, 1))
  const base = { hiddenKinds: new Set<string>(), mineOnly: false, userId: 'me', showFollowups: true, showInvoices: true }
  it('hides the kinds that are switched off', () => { expect(applyFilter(occs, { ...base, hiddenKinds: new Set(['deadline']) }).map((o) => o.event.id).sort()).toEqual(['m', 't']) })
  it('shows only mine: made by me, or with me invited', () => { expect(applyFilter(occs, { ...base, mineOnly: true }).map((o) => o.event.id).sort()).toEqual(['d', 'm']); expect(applyFilter(occs, { ...base, mineOnly: true, userId: null })).toEqual([]) })
  it('turns CRM follow-ups into read-only showings, only open ones with a time', () => {
    const fu = followupOverlays([
      { id: 'a', title: 'Call Ada', kind: 'call', dueAt: D(2031, 3, 5, 10).toISOString(), status: 'open', subject: 'Ada' }, { id: 'b', title: 'Done one', kind: 'call', dueAt: D(2031, 3, 5, 11).toISOString(), status: 'done', subject: '' },
      { id: 'c', title: 'No time', kind: 'todo', dueAt: null, status: 'open', subject: '' },
    ])
    expect(fu).toHaveLength(1); expect(fu[0]).toMatchObject({ title: 'Call Ada', allDay: false, overlay: { kind: 'followup', to: '/app/customers?tab=activities', detail: 'call · Ada' } })
    expect(fu[0].end.getTime() - fu[0].start.getTime()).toBe(30 * 60000)
  })
  it('turns sent invoices that still owe money into showings on their due date', () => {
    const inv = invoiceOverlays([
      { id: 'i1', number: 'INV-1', customer: 'Acme', dueOn: '2031-03-10', balance: 500, status: 'sent' }, { id: 'i2', number: 'INV-2', customer: 'Bola', dueOn: '2031-03-11', balance: 0, status: 'paid' },
      { id: 'i3', number: 'INV-3', customer: 'Chi', dueOn: null, balance: 100, status: 'sent' }, { id: 'i4', number: 'INV-4', customer: 'Dee', dueOn: '2031-03-12', balance: 50, status: 'draft' },
    ], (n) => `₦${n}`)
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ title: 'INV-1 due: Acme', allDay: true, overlay: { kind: 'invoice', to: '/app/invoices?tab=invoices&open=i1', detail: '₦500 owed' } }); expect(dayKey(inv[0].start)).toBe('2031-03-10')
  })
  it('lets each overlay be switched off on its own, and keeps overlays out of "only mine" and the kind filters', () => {
    const fu = followupOverlays([{ id: 'a', title: 'Call', kind: 'call', dueAt: D(2031, 3, 5, 10).toISOString(), status: 'open', subject: '' }]); const inv = invoiceOverlays([{ id: 'i', number: 'INV-1', customer: 'A', dueOn: '2031-03-10', balance: 5, status: 'sent' }], String)
    expect(applyFilter([...fu, ...inv], base)).toHaveLength(2); expect(applyFilter([...fu, ...inv], { ...base, showFollowups: false })).toHaveLength(1); expect(applyFilter([...fu, ...inv], { ...base, showInvoices: false })).toHaveLength(1)
    expect(applyFilter([...fu, ...inv], { ...base, hiddenKinds: new Set(KINDS.map((k) => k.key)), mineOnly: true })).toHaveLength(2)
  })
  it('finds the events whose reminder time has come and that have not ended', () => {
    const list = expand([ev({ id: 'r30', remindMinutes: 30, start: D(2031, 3, 3, 9), end: D(2031, 3, 3, 10) }), ev({ id: 'none', remindMinutes: null, start: D(2031, 3, 3, 9), end: D(2031, 3, 3, 10) }), ev({ id: 'later', remindMinutes: 10, start: D(2031, 3, 3, 15), end: D(2031, 3, 3, 16) }), ev({ id: 'day', allDay: true, remindMinutes: 0, start: D(2031, 3, 3), end: D(2031, 3, 3) })], D(2031, 3, 3), D(2031, 3, 4))
    expect(dueReminders(list, D(2031, 3, 3, 8, 40)).map((r) => [r.key.split('@')[0], r.minutesAway])).toEqual([['r30', 20]])
    expect(dueReminders(list, D(2031, 3, 3, 8, 20))).toEqual([]) // not yet
    expect(dueReminders(list, D(2031, 3, 3, 10, 5))).toEqual([]) // over
    expect(dueReminders(list, D(2031, 3, 3, 9, 20)).map((r) => r.key.split('@')[0])).toEqual(['r30']) // under way
  })
  it('words a reminder', () => {
    expect(reminderText({ key: 'k', title: 't', start: new Date(), minutesAway: 20 })).toBe('Starts in 20 minutes'); expect(reminderText({ key: 'k', title: 't', start: new Date(), minutesAway: 0 })).toBe('Starting now')
    expect(reminderText({ key: 'k', title: 't', start: new Date(), minutesAway: -1 })).toBe('Started 1 minute ago'); expect(reminderText({ key: 'k', title: 't', start: new Date(), minutesAway: -12 })).toBe('Started 12 minutes ago')
  })
})

describe('the event form', () => {
  const ok = () => newDraft(D(2031, 3, 5, 9, 10))
  it('starts a new event on the hour, an hour long, shared, with a reminder', () => {
    expect(ok()).toMatchObject({ id: null, kind: 'meeting', allDay: false, start: '2031-03-05T09:00', end: '2031-03-05T10:00', repeat: 'none', visibility: 'business', remindMinutes: 30, attendees: [] })
    expect(newDraft(D(2031, 3, 5, 9, 45)).start).toBe('2031-03-05T09:00')
    expect(newDraft(D(2031, 3, 5), true)).toMatchObject({ allDay: true, start: '2031-03-05', end: '2031-03-05' })
  })
  it('says what is wrong, field by field', () => {
    expect(validateDraft(ok())).toEqual({ title: 'Give the event a title.' })
    expect(validateDraft({ ...ok(), title: 'x'.repeat(201) }).title).toMatch(/too long/)
    expect(validateDraft({ ...ok(), title: 'A', end: '2031-03-05T08:00' }).end).toMatch(/cannot end before/)
    expect(validateDraft({ ...ok(), title: 'A', start: '' }).start).toMatch(/starts/)
    expect(validateDraft({ ...ok(), title: 'A', meetingUrl: 'zoom.us/abc' }).meetingUrl).toMatch(/http/); expect(validateDraft({ ...ok(), title: 'A', meetingUrl: 'https://meet.example.com/abc' })).toEqual({})
    expect(validateDraft({ ...ok(), title: 'A', repeat: 'weekly', repeatUntil: '2031-03-01' }).repeatUntil).toMatch(/cannot end before the first/); expect(validateDraft({ ...ok(), title: 'A', repeat: 'none', repeatUntil: '2031-03-01' })).toEqual({})
    expect(validateDraft({ ...ok(), title: 'A', attendees: Array.from({ length: 51 }, (_, i) => `u${i}`) }).attendees).toMatch(/at most 50/)
  })
  it('stores a timed event as it is and an all-day event from the start of its first day to the end of its last', () => {
    expect(toRange({ allDay: false, start: '2031-03-05T09:00', end: '2031-03-05T10:00' })).toEqual({ startsAt: D(2031, 3, 5, 9).toISOString(), endsAt: D(2031, 3, 5, 10).toISOString() })
    const r = toRange({ allDay: true, start: '2031-03-05', end: '2031-03-06' })
    expect(new Date(r.startsAt).getTime()).toBe(D(2031, 3, 5).getTime()); expect(dayKey(new Date(r.endsAt))).toBe('2031-03-06'); expect(new Date(r.endsAt).getHours()).toBe(23)
  })
  it('turns a stored event back into the form, timed or all day', () => {
    const e = ev({ title: 'Review', repeat: 'weekly', repeatUntil: '2031-06-01', remindMinutes: 10, meetingUrl: 'https://x.test', attendees: [{ userId: 'u2', name: 'Bola', response: 'invited' }] })
    expect(draftFromEvent(e)).toMatchObject({ id: 'e1', title: 'Review', start: '2031-03-03T09:00', end: '2031-03-03T10:00', repeat: 'weekly', repeatUntil: '2031-06-01', remindMinutes: 10, meetingUrl: 'https://x.test', attendees: ['u2'] })
    const all = ev({ allDay: true, start: D(2031, 3, 3), end: new Date(2031, 2, 4, 23, 59, 59) })
    expect(draftFromEvent(all)).toMatchObject({ allDay: true, start: '2031-03-03', end: '2031-03-04' })
    expect(toRange(draftFromEvent(all)).startsAt).toBe(all.startsAt)
  })
})

describe('the calendar file (.ics)', () => {
  const now = new Date(Date.UTC(2031, 0, 1, 12, 0, 0))
  it('writes each event with its title, times, place and link, escaping what needs it', () => {
    const text = toIcs([ev({ title: 'Lunch, with Ada; team', description: 'Line one\nLine two', location: 'Shop, Lagos', meetingUrl: 'https://meet.test/x' })], now)
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true); expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    for (const s of ['UID:e1@doa', 'DTSTAMP:20310101T120000Z', 'SUMMARY:Lunch\\, with Ada\\; team', 'DESCRIPTION:Line one\\nLine two', 'LOCATION:Shop\\, Lagos', 'URL:https://meet.test/x', 'DTSTART:', 'DTEND:']) expect(text).toContain(s)
    expect(text.split('\r\n').filter((l) => l.startsWith('BEGIN:VEVENT'))).toHaveLength(1)
  })
  it('keeps a repeat as a rule with its last day and its skipped days, not as copies', () => {
    const text = toIcs([ev({ repeat: 'weekly', repeatUntil: '2031-06-30', skipDates: ['2031-03-10'] })], now)
    expect(text).toContain('RRULE:FREQ=WEEKLY;UNTIL=20310630T235959Z'); expect(text).toMatch(/EXDATE:\d{8}T\d{6}Z/)
    expect(toIcs([ev({ repeat: 'weekdays' })], now)).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'); expect(toIcs([ev({ repeat: 'monthly' })], now)).toContain('RRULE:FREQ=MONTHLY'); expect(toIcs([ev({ repeat: 'daily' })], now)).toContain('RRULE:FREQ=DAILY'); expect(toIcs([ev({ repeat: 'yearly' })], now)).toContain('RRULE:FREQ=YEARLY')
    expect(toIcs([ev()], now)).not.toContain('RRULE')
  })
  it('writes an all-day event as dates, ending the day after its last day as the format requires', () => {
    const text = toIcs([ev({ allDay: true, start: D(2031, 3, 5), end: new Date(2031, 2, 6, 23, 59, 59) })], now)
    expect(text).toContain('DTSTART;VALUE=DATE:20310305'); expect(text).toContain('DTEND;VALUE=DATE:20310307')
  })
  it('is an empty calendar when there are no events', () => { expect(toIcs([], now)).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DOA//Calendar//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n') })
})
