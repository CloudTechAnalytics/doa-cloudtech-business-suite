/**
 * Pure rules behind the Calendar screens, kept apart from the components so they can be tested on their own. Dates are worked out in the browser's own time zone, so an event
 * at 9:00 is at 9:00 on the screen of whoever looks at it, and a day is the person's own day.
 */

export type EventKind = 'meeting' | 'appointment' | 'deadline' | 'task' | 'reminder' | 'other'
export const KINDS: { key: EventKind; label: string; color: string }[] = [
  { key: 'meeting', label: 'Meeting', color: '#3b5bdb' }, { key: 'appointment', label: 'Appointment', color: '#0ca678' }, { key: 'deadline', label: 'Deadline', color: '#e03131' },
  { key: 'task', label: 'Task', color: '#f08c00' }, { key: 'reminder', label: 'Reminder', color: '#7048e8' }, { key: 'other', label: 'Other', color: '#868e96' },
]
export const kindOf = (k: string) => KINDS.find((x) => x.key === k) ?? KINDS[KINDS.length - 1]

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'none', label: 'Does not repeat' }, { key: 'daily', label: 'Every day' }, { key: 'weekdays', label: 'Every weekday (Monday to Friday)' },
  { key: 'weekly', label: 'Every week' }, { key: 'monthly', label: 'Every month' }, { key: 'yearly', label: 'Every year' },
]
export const REMINDERS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'No reminder' }, { minutes: 0, label: 'When it starts' }, { minutes: 10, label: '10 minutes before' }, { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' }, { minutes: 1440, label: '1 day before' },
]

export interface Attendee { userId: string; name: string; response: 'invited' | 'accepted' | 'declined' | 'maybe' }
export interface CalEvent {
  id: string; title: string; description: string; location: string; meetingUrl: string | null; kind: EventKind; allDay: boolean
  startsAt: string; endsAt: string; repeat: Repeat; repeatUntil: string | null; skipDates: string[]; visibility: 'business' | 'private'; remindMinutes: number | null
  createdBy: string | null; attendees: Attendee[]
}
/** One showing of an event on one day: a one-off event is a single occurrence, a repeating one has many. Overlays (CRM follow-ups, invoices due) are occurrences that cannot be edited here. */
export interface Occurrence {
  key: string; event: CalEvent; start: Date; end: Date; allDay: boolean; title: string; color: string
  overlay?: { kind: 'followup' | 'invoice'; to: string; detail: string }
}

// ------------------------------------------------------------------------------------------------- dates
const pad = (n: number) => String(n).padStart(2, '0')
/** A date as YYYY-MM-DD in the person's own time zone. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()); return x }
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
/** Adds whole months, keeping the time of day and clamping the day to the end of a shorter month (31 January plus a month is 28 or 29 February). */
export function addMonths(d: Date, n: number): Date {
  const total = d.getFullYear() * 12 + d.getMonth() + n
  const y = Math.floor(total / 12); const m = total % 12
  return new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m)), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
}
/** Monday of the week that holds the date. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
const diffDays = (a: Date, b: Date) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000)

// ------------------------------------------------------------------------------------------------- repeating events
const MAX_STEPS = 4000

/**
 * The showings of an event that touch [from, to). A one-off event is one showing. A repeating one keeps its time of day on every showing, and a showing never appears on a day
 * in skipDates (the date of the showing's start). Monthly and yearly showings clamp to the end of a shorter month. The repeat stops after repeatUntil (that whole day counts).
 */
export function occurrencesOf(e: CalEvent, from: Date, to: Date): Occurrence[] {
  const start = new Date(e.startsAt); const end = new Date(e.endsAt)
  const length = end.getTime() - start.getTime()
  const color = kindOf(e.kind).color
  const make = (s: Date): Occurrence => ({ key: `${e.id}@${dayKey(s)}`, event: e, start: s, end: new Date(s.getTime() + length), allDay: e.allDay, title: e.title, color })
  const overlaps = (s: Date) => s.getTime() < to.getTime() && s.getTime() + length >= from.getTime() && (length > 0 || s.getTime() >= from.getTime())
  if (e.repeat === 'none') return overlaps(start) ? [make(start)] : []
  const until = e.repeatUntil ? new Date(parseDay(e.repeatUntil).getTime() + 86400000) : null // the whole last day counts
  const skip = new Set(e.skipDates)
  const out: Occurrence[] = []
  const take = (s: Date) => { if (until && s.getTime() >= until.getTime()) return false; if (!skip.has(dayKey(s)) && overlaps(s)) out.push(make(s)); return true }

  if (e.repeat === 'daily' || e.repeat === 'weekdays' || e.repeat === 'weekly') {
    const step = e.repeat === 'weekly' ? 7 : 1
    // Jump straight to the first candidate that could still touch the range.
    const lead = Math.max(0, diffDays(from, start) - Math.ceil(length / 86400000) - 1)
    let n = step === 7 ? Math.floor(lead / 7) * 7 : lead
    for (let i = 0; i < MAX_STEPS; i++, n += step) {
      const s = addDays(start, n)
      if (s.getTime() >= to.getTime()) break
      if (e.repeat === 'weekdays' && (s.getDay() === 0 || s.getDay() === 6)) continue
      if (!take(s)) break
    }
    return out
  }
  const months = e.repeat === 'yearly' ? 12 : 1
  const lead = Math.max(0, Math.floor(((from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth() - 1) / months))
  for (let i = lead, c = 0; c < MAX_STEPS; i++, c++) {
    const s = addMonths(start, i * months)
    if (s.getTime() >= to.getTime()) break
    if (!take(s)) break
  }
  return out
}

/** Every showing in [from, to) of a list of events, in time order (all-day first on a day). */
export function expand(events: CalEvent[], from: Date, to: Date): Occurrence[] {
  return events.flatMap((e) => occurrencesOf(e, from, to)).sort(byTime)
}
export const byTime = (a: Occurrence, z: Occurrence) => a.start.getTime() - z.start.getTime() || Number(z.allDay) - Number(a.allDay) || a.title.localeCompare(z.title)

// ------------------------------------------------------------------------------------------------- views
export type View = 'day' | 'week' | 'month' | 'agenda'
export const VIEWS: { key: View; label: string }[] = [{ key: 'agenda', label: 'Agenda' }, { key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }]

/** The six weeks, Monday first, that a month view draws, with whether each day is in the month. */
export function monthGrid(anchor: Date): { date: Date; inMonth: boolean }[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => { const date = addDays(start, w * 7 + d); return { date, inMonth: date.getMonth() === anchor.getMonth() } }))
}
export const weekDays = (anchor: Date) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))

/** What to load for a view: the whole grid for a month, the week, the day, or the next 30 days for the agenda. */
export function viewRange(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === 'month') { const g = monthGrid(anchor); return { from: g[0][0].date, to: addDays(g[5][6].date, 1) } }
  if (view === 'week') { const w = weekDays(anchor); return { from: w[0], to: addDays(w[6], 1) } }
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
  return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 30) }
}
/** Moves the date by one page of the view: a day, a week, a month, or a month for the agenda. */
export function shiftAnchor(view: View, anchor: Date, by: number): Date {
  if (view === 'day') return addDays(anchor, by)
  if (view === 'week') return addDays(anchor, by * 7)
  return addMonths(anchor, by)
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const monthName = (m: number) => MONTHS[m]
export const dayName = (d: Date) => DAYS[d.getDay()]
export function rangeTitle(view: View, anchor: Date): string {
  if (view === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  if (view === 'day') return `${DAYS[anchor.getDay()]} ${anchor.getDate()} ${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  if (view === 'agenda') { const { from, to } = viewRange('agenda', anchor); const last = addDays(to, -1); return `${from.getDate()} ${MONTHS[from.getMonth()].slice(0, 3)} to ${last.getDate()} ${MONTHS[last.getMonth()].slice(0, 3)} ${last.getFullYear()}` }
  const w = weekDays(anchor); const a = w[0]; const b = w[6]
  return a.getMonth() === b.getMonth() ? `${a.getDate()} to ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}` : `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} to ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`
}
export const timeLabel = (d: Date) => `${d.getHours() % 12 || 12}${d.getMinutes() ? `:${pad(d.getMinutes())}` : ''} ${d.getHours() < 12 ? 'am' : 'pm'}`
export const whenLabel = (o: Pick<Occurrence, 'start' | 'end' | 'allDay'>) => {
  const day = `${DAYS[o.start.getDay()].slice(0, 3)} ${o.start.getDate()} ${MONTHS[o.start.getMonth()].slice(0, 3)}`
  if (o.allDay) return sameDay(o.start, o.end) ? `${day}, all day` : `${day} to ${DAYS[o.end.getDay()].slice(0, 3)} ${o.end.getDate()} ${MONTHS[o.end.getMonth()].slice(0, 3)}, all day`
  return sameDay(o.start, o.end) ? `${day}, ${timeLabel(o.start)} to ${timeLabel(o.end)}` : `${day} ${timeLabel(o.start)} to ${DAYS[o.end.getDay()].slice(0, 3)} ${o.end.getDate()} ${MONTHS[o.end.getMonth()].slice(0, 3)} ${timeLabel(o.end)}`
}

/** The showings on each day, a multi-day showing on every day it spans (one that ends exactly at midnight does not spill onto the next day). */
export function byDay(occs: Occurrence[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>()
  for (const o of occs) {
    const last = o.end.getTime() > o.start.getTime() && o.end.getHours() === 0 && o.end.getMinutes() === 0 && o.end.getSeconds() === 0 ? addDays(startOfDay(o.end), -1) : startOfDay(o.end)
    for (let d = startOfDay(o.start); d.getTime() <= last.getTime(); d = addDays(d, 1)) { const k = dayKey(d); map.set(k, [...(map.get(k) ?? []), o]) }
  }
  return map
}

export interface Placed { occ: Occurrence; top: number; height: number; col: number; cols: number }
/**
 * Places the timed showings of one day on a 24-hour column: top and height as fractions of the day, and side by side when they overlap (each cluster of overlapping showings
 * shares its width equally). A showing never shorter than 20 minutes on screen so it can still be read and pressed.
 */
export function layoutDay(day: Date, occs: Occurrence[]): Placed[] {
  const d0 = startOfDay(day).getTime(); const d1 = d0 + 86400000
  const items = occs.filter((o) => !o.allDay).map((occ) => { const s = Math.max(occ.start.getTime(), d0); const e = Math.min(Math.max(occ.end.getTime(), s + 20 * 60000), d1); return { occ, s, e } }).sort((a, z) => a.s - z.s || z.e - a.e)
  const placed: Placed[] = []; let cluster: { occ: Occurrence; s: number; e: number; col: number }[] = []; let clusterEnd = 0
  const flush = () => { const cols = Math.max(1, ...cluster.map((c) => c.col + 1)); for (const c of cluster) placed.push({ occ: c.occ, top: (c.s - d0) / 86400000, height: (c.e - c.s) / 86400000, col: c.col, cols }); cluster = [] }
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush()
    const taken = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col))
    let col = 0; while (taken.has(col)) col++
    cluster.push({ ...it, col }); clusterEnd = Math.max(clusterEnd, it.e)
  }
  flush()
  return placed
}

// ------------------------------------------------------------------------------------------------- filters, overlays, reminders
export interface CalFilter { hiddenKinds: ReadonlySet<string>; mineOnly: boolean; userId: string | null; showFollowups: boolean; showInvoices: boolean }
/** Applies the "Show" choices on the left. Mine means made by me or with me invited. Overlays have their own switches. */
export function applyFilter(occs: Occurrence[], f: CalFilter): Occurrence[] {
  return occs.filter((o) => {
    if (o.overlay) return o.overlay.kind === 'followup' ? f.showFollowups : f.showInvoices
    if (f.hiddenKinds.has(o.event.kind)) return false
    return !f.mineOnly || (!!f.userId && (o.event.createdBy === f.userId || o.event.attendees.some((a) => a.userId === f.userId)))
  })
}

const overlayEvent = (id: string, title: string): CalEvent => ({ id, title, description: '', location: '', meetingUrl: null, kind: 'task', allDay: true, startsAt: '', endsAt: '', repeat: 'none', repeatUntil: null, skipDates: [], visibility: 'business', remindMinutes: null, createdBy: null, attendees: [] })
/** Open CRM follow-ups (calls, meetings, to-dos with a time) as read-only showings. */
export function followupOverlays(items: { id: string; title: string; kind: string; dueAt: string | null; status: string; subject: string }[]): Occurrence[] {
  return items.filter((a) => a.status === 'open' && a.dueAt).map((a) => {
    const start = new Date(a.dueAt as string)
    return { key: `fu:${a.id}`, event: overlayEvent(`fu:${a.id}`, a.title), start, end: new Date(start.getTime() + 30 * 60000), allDay: false, title: a.title, color: '#d6336c', overlay: { kind: 'followup' as const, to: '/app/customers?tab=activities', detail: [a.kind, a.subject].filter(Boolean).join(' · ') } }
  })
}
/** Sent invoices that still owe something, on their due date, as read-only all-day showings. */
export function invoiceOverlays(items: { id: string; number: string; customer: string; dueOn: string | null; balance: number; status: string }[], fmt: (n: number) => string): Occurrence[] {
  return items.filter((i) => (i.status === 'sent' || i.status === 'partially_paid') && i.balance > 0 && i.dueOn).map((i) => {
    const start = parseDay(i.dueOn as string)
    const title = `${i.number} due: ${i.customer || 'customer'}`
    return { key: `inv:${i.id}`, event: overlayEvent(`inv:${i.id}`, title), start, end: start, allDay: true, title, color: '#0b7285', overlay: { kind: 'invoice' as const, to: `/app/invoices?tab=invoices&open=${i.id}`, detail: `${fmt(i.balance)} owed` } }
  })
}

export interface Reminder { key: string; title: string; start: Date; minutesAway: number }
/** The showings whose reminder time has come and that have not ended: shown in the bell. Nothing is sent by email or text. */
export function dueReminders(occs: Occurrence[], now: Date): Reminder[] {
  return occs.filter((o) => !o.overlay && o.event.remindMinutes !== null && !o.allDay && now.getTime() >= o.start.getTime() - (o.event.remindMinutes as number) * 60000 && now.getTime() < Math.max(o.end.getTime(), o.start.getTime() + 15 * 60000))
    .map((o) => ({ key: o.key, title: o.title, start: o.start, minutesAway: Math.round((o.start.getTime() - now.getTime()) / 60000) })).sort((a, z) => a.start.getTime() - z.start.getTime())
}
export const reminderText = (r: Reminder) => (r.minutesAway > 1 ? `Starts in ${r.minutesAway} minutes` : r.minutesAway >= 0 ? 'Starting now' : `Started ${-r.minutesAway} minute${r.minutesAway === -1 ? '' : 's'} ago`)

// ------------------------------------------------------------------------------------------------- the form
export interface Draft {
  id: string | null; title: string; description: string; location: string; meetingUrl: string; kind: EventKind; allDay: boolean
  start: string; end: string // datetime-local ("2031-03-04T09:00") or, for all-day, a date ("2031-03-04")
  repeat: Repeat; repeatUntil: string; visibility: 'business' | 'private'; remindMinutes: number | null; attendees: string[]
}
/** What is wrong with a form, as one message per field (empty when it is fine). */
export function validateDraft(d: Draft): Record<string, string> {
  const e: Record<string, string> = {}
  if (!d.title.trim()) e.title = 'Give the event a title.'
  else if (d.title.trim().length > 200) e.title = 'The title is too long.'
  if (!d.start) e.start = 'Choose when it starts.'
  if (!d.end) e.end = 'Choose when it ends.'
  if (d.start && d.end && new Date(d.end) < new Date(d.start)) e.end = 'It cannot end before it starts.'
  if (d.meetingUrl.trim() && !/^https?:\/\/\S+$/i.test(d.meetingUrl.trim())) e.meetingUrl = 'A meeting link starts with http:// or https://.'
  if (d.repeat !== 'none' && d.repeatUntil && d.start && d.repeatUntil < d.start.slice(0, 10)) e.repeatUntil = 'The repeat cannot end before the first event.'
  if (d.attendees.length > 50) e.attendees = 'Invite at most 50 people.'
  return e
}
/** The stored start and end for a form: an all-day event runs from the start of its first day to the end of its last. */
export function toRange(d: Pick<Draft, 'allDay' | 'start' | 'end'>): { startsAt: string; endsAt: string } {
  if (d.allDay) {
    const s = parseDay(d.start.slice(0, 10)); const e = parseDay(d.end.slice(0, 10))
    return { startsAt: s.toISOString(), endsAt: new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59).toISOString() }
  }
  return { startsAt: new Date(d.start).toISOString(), endsAt: new Date(d.end).toISOString() }
}
const local = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
/** A form for a new event that starts at a given moment (an hour long) or on a given day (all day). */
export function newDraft(at: Date, allDay = false): Draft {
  const s = new Date(at); if (!allDay) { s.setMinutes(0, 0, 0); if (at.getMinutes() >= 30 && at.getHours() === s.getHours()) s.setMinutes(0) }
  const e = new Date(s.getTime() + 3600000)
  return { id: null, title: '', description: '', location: '', meetingUrl: '', kind: 'meeting', allDay, start: allDay ? dayKey(s) : local(s), end: allDay ? dayKey(s) : local(e), repeat: 'none', repeatUntil: '', visibility: 'business', remindMinutes: 30, attendees: [] }
}
export function draftFromEvent(e: CalEvent): Draft {
  const s = new Date(e.startsAt); const en = new Date(e.endsAt)
  return { id: e.id, title: e.title, description: e.description, location: e.location, meetingUrl: e.meetingUrl ?? '', kind: e.kind, allDay: e.allDay, start: e.allDay ? dayKey(s) : local(s), end: e.allDay ? dayKey(en) : local(en), repeat: e.repeat, repeatUntil: e.repeatUntil ?? '', visibility: e.visibility, remindMinutes: e.remindMinutes, attendees: e.attendees.map((a) => a.userId) }
}

// ------------------------------------------------------------------------------------------------- .ics export
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsUtc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const icsDay = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
/** The events as an iCalendar file that opens in Google Calendar, Outlook and Apple Calendar. Repeats and skipped days are kept as rules, not as many copies. */
export function toIcs(events: CalEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DOA//Calendar//EN', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    const s = new Date(e.startsAt); const en = new Date(e.endsAt)
    lines.push('BEGIN:VEVENT', `UID:${e.id}@doa`, `DTSTAMP:${icsUtc(now)}`)
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDay(s)}`, `DTEND;VALUE=DATE:${icsDay(addDays(startOfDay(en), 1))}`)
    else lines.push(`DTSTART:${icsUtc(s)}`, `DTEND:${icsUtc(en)}`)
    lines.push(`SUMMARY:${icsText(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`)
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`)
    if (e.meetingUrl) lines.push(`URL:${e.meetingUrl}`)
    if (e.repeat !== 'none') {
      const freq = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[e.repeat]
      lines.push(`RRULE:${freq}${e.repeatUntil ? `;UNTIL=${e.repeatUntil.replace(/-/g, '')}${e.allDay ? '' : 'T235959Z'}` : ''}`)
      for (const d of e.skipDates) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${d.replace(/-/g, '')}` : `EXDATE:${icsUtc(new Date(parseDay(d).getFullYear(), parseDay(d).getMonth(), parseDay(d).getDate(), s.getHours(), s.getMinutes(), s.getSeconds()))}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
