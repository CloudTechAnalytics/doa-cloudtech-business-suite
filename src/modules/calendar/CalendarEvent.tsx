import { Link as LinkIcon, MapPin, Repeat as RepeatIcon, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ErrorState, SelectField, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { listTeam } from '@/modules/crm/dealsApi'
import { KINDS, REMINDERS, REPEATS, dayKey, kindOf, validateDraft, whenLabel } from './calendarLogic'
import type { Draft, EventKind, Occurrence, Repeat } from './calendarLogic'
import * as api from './calendarApi'

const RESPONSE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }> = {
  accepted: { tone: 'success', text: 'Going' }, maybe: { tone: 'warning', text: 'Maybe' }, declined: { tone: 'danger', text: 'Not going' }, invited: { tone: 'neutral', text: 'No answer yet' },
}

/** One showing of an event: when, where, who is coming, the link to join, and what can be done with it. Answering, changing and deleting are checked again by the database. */
export function EventView({ businessId, occ, userId, canEdit, canManage, onEdit, onClose, onChanged }: { businessId: string; occ: Occurrence; userId: string | null; canEdit: boolean; canManage: boolean; onEdit: () => void; onClose: () => void; onChanged: () => Promise<void> }) {
  const e = occ.event
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const me = e.attendees.find((a) => a.userId === userId)
  const run = async (fn: () => Promise<string | null>, closes = true) => { setBusy(true); setError(null); const r = await fn(); setBusy(false); if (r) return setError(r); await onChanged(); if (closes) onClose() }
  const repeats = REPEATS.find((r) => r.key === e.repeat)

  return (
    <Dialog title={e.title} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ background: kindOf(e.kind).color }}>{kindOf(e.kind).label}</span>
          {e.visibility === 'private' && <Badge>Private</Badge>}
          <span className="text-ink/70">{whenLabel(occ)}</span>
        </div>
        {e.repeat !== 'none' && <p className="flex items-center gap-2 text-ink/70"><RepeatIcon className="size-4" aria-hidden />{repeats?.label}{e.repeatUntil ? `, until ${e.repeatUntil}` : ''}</p>}
        {e.location && <p className="flex items-center gap-2"><MapPin className="size-4 text-ink/60" aria-hidden />{e.location}</p>}
        {e.meetingUrl && <p className="flex items-center gap-2"><LinkIcon className="size-4 text-ink/60" aria-hidden /><a className="font-semibold text-accent underline" href={e.meetingUrl} target="_blank" rel="noreferrer">Join the meeting</a></p>}
        {e.description && <p className="whitespace-pre-line rounded-md bg-surface p-3">{e.description}</p>}
        {e.attendees.length > 0 && (
          <div><h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink/60"><Users className="size-4" aria-hidden />Invited ({e.attendees.length})</h3>
            <ul className="divide-y divide-ink/10">{e.attendees.map((a) => <li key={a.userId} className="flex items-center justify-between py-1.5"><span>{a.name}{a.userId === userId ? ' (you)' : ''}</span><Badge tone={RESPONSE[a.response].tone}>{RESPONSE[a.response].text}</Badge></li>)}</ul></div>
        )}
        {me && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3"><span className="mr-auto font-medium">Will you go?</span>
            {(['accepted', 'maybe', 'declined'] as const).map((r) => <Button key={r} variant={me.response === r ? 'primary' : 'secondary'} loading={busy} onClick={() => void run(() => api.respond(businessId, e.id, r), false)}>{RESPONSE[r].text}</Button>)}
          </div>
        )}
        {error && <ErrorState title="Not done" message={error} />}
        {confirming ? (
          <div role="alertdialog" aria-label="Delete this event" className="rounded-lg border border-danger/40 bg-danger-soft p-3">
            <p className="font-semibold">Delete {e.repeat !== 'none' ? 'this repeating event' : 'this event'}?</p>
            <p className="mt-1 text-xs text-ink/70">{e.repeat !== 'none' ? 'Delete only this day, or the whole series. ' : ''}It is taken off everyone's calendar. This cannot be undone.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button>
              {e.repeat !== 'none' && <Button variant="secondary" className="text-danger" loading={busy} onClick={() => void run(() => api.skipOccurrence(businessId, e.id, dayKey(occ.start)))}>Only this day</Button>}
              <Button variant="secondary" className="text-danger" loading={busy} onClick={() => void run(() => api.deleteEvent(businessId, e.id))}>{e.repeat !== 'none' ? 'The whole series' : 'Delete'}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {canManage && canEdit && <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirming(true)}>Delete</Button>}
            {canManage && canEdit && <Button variant="secondary" onClick={onEdit}>Edit{e.repeat !== 'none' ? ' series' : ''}</Button>}
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** The form for a new event or a change to one. Everything is checked here for a quick message and again in the database. */
export function EventForm({ businessId, initial, onClose, onSaved }: { businessId: string; initial: Draft; onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const team = useAsync(() => listTeam(businessId).catch(() => []), [businessId])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setAllDay = (on: boolean) => setD((x) => on ? { ...x, allDay: true, start: x.start.slice(0, 10), end: x.end.slice(0, 10) } : { ...x, allDay: false, start: `${x.start.slice(0, 10)}T09:00`, end: `${x.end.slice(0, 10)}T10:00` })

  async function save() {
    const v = validateDraft(d); setErrors(v); setError(null)
    if (Object.keys(v).length) return
    setBusy(true)
    const err = await api.saveEvent(businessId, d)
    setBusy(false)
    if (err) return setError(err)
    await onSaved()
  }
  const toggle = (id: string) => set('attendees', d.attendees.includes(id) ? d.attendees.filter((x) => x !== id) : [...d.attendees, id])

  return (
    <Dialog title={d.id ? 'Edit event' : 'New event'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <TextField label="Title" value={d.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={200} placeholder="e.g. Stock-taking, Parent meeting, Client call" autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Kind" value={d.kind} onChange={(e) => set('kind', e.target.value as EventKind)}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</SelectField>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={d.allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
          <TextField label={d.allDay ? 'First day' : 'Starts'} type={d.allDay ? 'date' : 'datetime-local'} value={d.start} onChange={(e) => set('start', e.target.value)} error={errors.start} />
          <TextField label={d.allDay ? 'Last day' : 'Ends'} type={d.allDay ? 'date' : 'datetime-local'} value={d.end} min={d.start} onChange={(e) => set('end', e.target.value)} error={errors.end} />
          <SelectField label="Repeats" value={d.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>{REPEATS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</SelectField>
          {d.repeat !== 'none' ? <TextField label="Repeat until (optional)" type="date" value={d.repeatUntil} onChange={(e) => set('repeatUntil', e.target.value)} error={errors.repeatUntil} /> : <span />}
          <SelectField label="Reminder" value={d.remindMinutes === null ? '' : String(d.remindMinutes)} onChange={(e) => set('remindMinutes', e.target.value === '' ? null : Number(e.target.value))} hint="Shows in the bell at the top when you open DOA. Nothing is sent by email or text.">
            {REMINDERS.map((r) => <option key={r.label} value={r.minutes === null ? '' : String(r.minutes)}>{r.label}</option>)}</SelectField>
          <SelectField label="Who can see it" value={d.visibility} onChange={(e) => set('visibility', e.target.value as 'business' | 'private')}><option value="business">Everyone in the business</option><option value="private">Only me and the people invited</option></SelectField>
          <TextField label="Place (optional)" value={d.location} onChange={(e) => set('location', e.target.value)} maxLength={300} placeholder="Office, shop, address" />
          <TextField label="Meeting link (optional)" value={d.meetingUrl} onChange={(e) => set('meetingUrl', e.target.value)} error={errors.meetingUrl} placeholder="https://" />
        </div>
        <TextField label="Notes (optional)" value={d.description} onChange={(e) => set('description', e.target.value)} />
        {(team.data?.length ?? 0) > 0 && (
          <fieldset><legend className="mb-1 text-sm font-medium">Invite people from your team</legend>
            <div className="flex flex-wrap gap-2">{team.data!.map((m) => <label key={m.userId} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${d.attendees.includes(m.userId) ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}><input type="checkbox" className="sr-only" checked={d.attendees.includes(m.userId)} onChange={() => toggle(m.userId)} />{m.name}</label>)}</div>
            {errors.attendees && <p className="mt-1 text-xs text-danger">{errors.attendees}</p>}
          </fieldset>
        )}
        {error && <ErrorState title="Not saved" message={error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>{d.id ? 'Save changes' : 'Add to calendar'}</Button></div>
      </div>
    </Dialog>
  )
}
