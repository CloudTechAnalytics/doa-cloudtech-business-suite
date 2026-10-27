import { newId } from '@/demo/demoInventory'
import { canManageStaff, demoRoleIn, getDemoState } from '@/demo/demoStore'
import { demoAllowed } from '@/demo/demoTrade'

/**
 * Browser-only calendar for demo mode. Mirrors supabase/migrations/20261021000058_calendar.sql: a shared event is seen by everyone who can read the calendar and a private one only by
 * whoever made it and whoever is invited, only people on the business can be invited, only the maker (or someone who manages settings) can change or delete an event, a repeating
 * event can lose single days, and an invited person answers for themselves.
 */
export type DKind = 'meeting' | 'appointment' | 'deadline' | 'task' | 'reminder' | 'other'
export type DRepeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export interface DEvent {
  id: string; businessId: string; title: string; description: string; location: string; meetingUrl: string | null; kind: DKind; allDay: boolean
  startsAt: string; endsAt: string; repeat: DRepeat; repeatUntil: string | null; skipDates: string[]; visibility: 'business' | 'private'; remindMinutes: number | null
  createdBy: string | null; createdAt: string
}
export interface DAttendee { businessId: string; eventId: string; userId: string; response: 'invited' | 'accepted' | 'declined' | 'maybe' }
interface Cal { events: DEvent[]; attendees: DAttendee[] }

const KEY = 'doa.demo.calendar.v1'
const empty = (): Cal => ({ events: [], attendees: [] })
function load(): Cal {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Cal) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Cal) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getCalendar = () => state
export const resetDemoCalendar = () => commit(empty())

const me = () => getDemoState().userId as string | null
const activeMember = (biz: string, userId: string) => getDemoState().members.some((m) => m.businessId === biz && m.userId === userId && m.status === 'active')
const KINDS: DKind[] = ['meeting', 'appointment', 'deadline', 'task', 'reminder', 'other']
const REPEATS: DRepeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']
const guarded = (biz: string, perm: 'calendar.manage' | 'calendar.read', fn: () => void): string | null => {
  try { if (!demoAllowed(biz, 'calendar', perm)) throw new Error('permission denied'); fn(); return null } catch (e) { return (e as Error).message }
}
/** The maker, or the owner or an admin (who manage the business's settings; the demo's role table has no settings.manage), may change an event. */
const canEdit = (biz: string, e: DEvent) => e.createdBy === me() || canManageStaff(demoRoleIn(biz))

export interface DEventInput {
  id: string | null; title: string; description: string; location: string; meetingUrl: string; kind: DKind; allDay: boolean; startsAt: string; endsAt: string
  repeat: DRepeat; repeatUntil: string | null; visibility: 'business' | 'private'; remindMinutes: number | null; attendees: string[]
}

/** Events that are visible to this person and touch the period, with who is invited. Needs the calendar read permission. */
export function demoCalendarEvents(biz: string, from: string, to: string): { events: DEvent[]; attendees: DAttendee[] } {
  if (!demoAllowed(biz, 'calendar', 'calendar.read')) throw new Error('permission denied')
  const u = me()
  const mine = (e: DEvent) => e.visibility === 'business' || e.createdBy === u || state.attendees.some((a) => a.eventId === e.id && a.userId === u)
  const events = state.events.filter((e) => e.businessId === biz && mine(e) && e.startsAt < to && (e.repeat !== 'none' || e.endsAt >= from))
  return { events, attendees: state.attendees.filter((a) => events.some((e) => e.id === a.eventId)) }
}

export function demoSaveEvent(biz: string, v: DEventInput): string | null {
  return guarded(biz, 'calendar.manage', () => {
    if (!v.startsAt || !v.endsAt) throw new Error('choose when the event starts and ends')
    if (v.endsAt < v.startsAt) throw new Error('the event cannot end before it starts')
    if (!v.title.trim()) throw new Error('give the event a title')
    if (v.title.trim().length > 200) throw new Error('the title is too long')
    if (!KINDS.includes(v.kind) || !REPEATS.includes(v.repeat)) throw new Error('unknown kind or repeat')
    if (v.repeat !== 'none' && v.repeatUntil && v.repeatUntil < v.startsAt.slice(0, 10)) throw new Error('the repeat cannot end before the first event')
    if (v.meetingUrl.trim() && !/^https?:\/\/\S+$/i.test(v.meetingUrl.trim())) throw new Error('a meeting link starts with http:// or https://')
    if (v.remindMinutes !== null && !(v.remindMinutes >= 0 && v.remindMinutes <= 10080)) throw new Error('choose a reminder between 0 minutes and a week')
    const att = [...new Set(v.attendees)]
    if (att.length > 50) throw new Error('invite at most 50 people to one event')
    if (att.some((u) => !activeMember(biz, u))) throw new Error('you can only invite people who are on this business')
    const base = { title: v.title.trim(), description: v.description, location: v.location, meetingUrl: v.meetingUrl.trim() || null, kind: v.kind, allDay: v.allDay, startsAt: v.startsAt, endsAt: v.endsAt, repeat: v.repeat, repeatUntil: v.repeat === 'none' ? null : v.repeatUntil || null, visibility: v.visibility, remindMinutes: v.remindMinutes }
    let id = v.id
    let events: DEvent[]
    if (id === null) {
      id = newId('cal')
      events = [...state.events, { id, businessId: biz, ...base, skipDates: [], createdBy: me(), createdAt: new Date().toISOString() }]
    } else {
      const cur = state.events.find((e) => e.id === id && e.businessId === biz)
      if (!cur) throw new Error('event not found')
      if (!canEdit(biz, cur)) throw new Error('only the person who made this event can change it')
      events = state.events.map((e) => (e.id === id ? { ...e, ...base, skipDates: base.repeat === 'none' ? [] : e.skipDates } : e))
    }
    const keep = state.attendees.filter((a) => a.eventId === id && att.includes(a.userId))
    const added = att.filter((u) => !keep.some((a) => a.userId === u)).map((userId): DAttendee => ({ businessId: biz, eventId: id as string, userId, response: 'invited' }))
    commit({ events, attendees: [...state.attendees.filter((a) => a.eventId !== id), ...keep, ...added] })
  })
}

export function demoDeleteEvent(biz: string, id: string): string | null {
  return guarded(biz, 'calendar.manage', () => {
    const e = state.events.find((x) => x.id === id && x.businessId === biz)
    if (!e) throw new Error('permission denied')
    if (!canEdit(biz, e)) throw new Error('only the person who made this event can delete it')
    commit({ events: state.events.filter((x) => x.id !== id), attendees: state.attendees.filter((a) => a.eventId !== id) })
  })
}

/** Takes one day out of a repeating event. */
export function demoSkipOccurrence(biz: string, id: string, day: string): string | null {
  return guarded(biz, 'calendar.manage', () => {
    const e = state.events.find((x) => x.id === id && x.businessId === biz)
    if (!e) throw new Error('permission denied')
    if (!canEdit(biz, e)) throw new Error('only the person who made this event can change it')
    if (e.repeat === 'none') throw new Error('this event does not repeat; delete it instead')
    if (!day) throw new Error('choose the day to skip')
    commit({ ...state, events: state.events.map((x) => (x.id === id ? { ...x, skipDates: [...new Set([...x.skipDates, day])].sort() } : x)) })
  })
}

/** An invited person answers for themselves. */
export function demoRespond(biz: string, id: string, response: 'accepted' | 'declined' | 'maybe'): string | null {
  return guarded(biz, 'calendar.read', () => {
    if (!['accepted', 'declined', 'maybe'].includes(response)) throw new Error('answer accepted, declined or maybe')
    const e = state.events.find((x) => x.id === id && x.businessId === biz)
    if (!e) throw new Error('permission denied')
    if (!state.attendees.some((a) => a.eventId === id && a.userId === me())) throw new Error('you were not invited to this event')
    commit({ ...state, attendees: state.attendees.map((a) => (a.eventId === id && a.userId === me() ? { ...a, response } : a)) })
  })
}
