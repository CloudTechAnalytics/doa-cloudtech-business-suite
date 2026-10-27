import * as demo from '@/demo/demoCalendar'
import { listTeam } from '@/modules/crm/dealsApi'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { Attendee, CalEvent, Draft, EventKind, Repeat } from './calendarLogic'
import { toRange } from './calendarLogic'

/** Calendar events. Live mode reads through row-level security and writes through the database functions; demo mode runs the browser mirror. Writes return an error message or null. */

const db = () => supabase!
const err = (e: { message: string } | null) => e?.message ?? null
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null)

/** The events that touch [from, to) and are visible to this person, with the people invited and what each answered. A repeating event is returned whatever its dates (the screens work out its showings). */
export async function listEvents(b: string, from: Date, to: Date): Promise<CalEvent[]> {
  const team = await listTeam(b).catch(() => [])
  const name = (id: string) => team.find((m) => m.userId === id)?.name ?? 'Member'
  if (isDemoMode) {
    const r = demo.demoCalendarEvents(b, from.toISOString(), to.toISOString())
    return r.events.map((e): CalEvent => ({ ...e, kind: e.kind as EventKind, repeat: e.repeat as Repeat, attendees: r.attendees.filter((a) => a.eventId === e.id).map((a): Attendee => ({ userId: a.userId, name: name(a.userId), response: a.response })) }))
  }
  const ev = await db().from('calendar_events').select('*').eq('business_id', b).lt('starts_at', to.toISOString()).or(`repeat.neq.none,ends_at.gte.${from.toISOString()}`).order('starts_at').limit(1000)
  if (ev.error) throw new Error(ev.error.message)
  const ids = (ev.data ?? []).map((x) => String(x.id))
  const at = ids.length ? await db().from('calendar_attendees').select('event_id, user_id, response').eq('business_id', b).in('event_id', ids) : { data: [], error: null }
  if (at.error) throw new Error(at.error.message)
  return (ev.data ?? []).map((x): CalEvent => ({
    id: String(x.id), title: String(x.title), description: String(x.description ?? ''), location: String(x.location ?? ''), meetingUrl: (x.meeting_url as string | null) ?? null, kind: x.kind as EventKind, allDay: !!x.all_day,
    startsAt: String(x.starts_at), endsAt: String(x.ends_at), repeat: x.repeat as Repeat, repeatUntil: day(x.repeat_until), skipDates: ((x.skip_dates as string[] | null) ?? []).map((d) => String(d).slice(0, 10)),
    visibility: x.visibility as 'business' | 'private', remindMinutes: x.remind_minutes === null ? null : Number(x.remind_minutes), createdBy: (x.created_by as string | null) ?? null,
    attendees: (at.data ?? []).filter((a) => a.event_id === x.id).map((a): Attendee => ({ userId: String(a.user_id), name: name(String(a.user_id)), response: a.response as Attendee['response'] })),
  }))
}

export async function saveEvent(b: string, d: Draft) {
  const { startsAt, endsAt } = toRange(d)
  if (isDemoMode) return demo.demoSaveEvent(b, { id: d.id, title: d.title, description: d.description, location: d.location, meetingUrl: d.meetingUrl, kind: d.kind, allDay: d.allDay, startsAt, endsAt, repeat: d.repeat, repeatUntil: d.repeatUntil || null, visibility: d.visibility, remindMinutes: d.remindMinutes, attendees: d.attendees })
  return err((await db().rpc('calendar_save_event', {
    p_business: b, p_id: d.id, p_title: d.title, p_description: d.description, p_location: d.location, p_meeting_url: d.meetingUrl, p_kind: d.kind, p_all_day: d.allDay, p_starts: startsAt, p_ends: endsAt,
    p_repeat: d.repeat, p_repeat_until: d.repeatUntil || null, p_visibility: d.visibility, p_remind: d.remindMinutes, p_related_type: null, p_related_id: null, p_related_label: '', p_attendees: d.attendees,
  })).error)
}
export async function deleteEvent(b: string, id: string) {
  if (isDemoMode) return demo.demoDeleteEvent(b, id)
  return err((await db().rpc('calendar_delete_event', { p_event: id })).error)
}
/** Takes one day (YYYY-MM-DD) out of a repeating event. */
export async function skipOccurrence(b: string, id: string, dayKey: string) {
  if (isDemoMode) return demo.demoSkipOccurrence(b, id, dayKey)
  return err((await db().rpc('calendar_skip_occurrence', { p_event: id, p_date: dayKey })).error)
}
export async function respond(b: string, id: string, response: 'accepted' | 'declined' | 'maybe') {
  if (isDemoMode) return demo.demoRespond(b, id, response)
  return err((await db().rpc('calendar_respond', { p_event: id, p_response: response })).error)
}
