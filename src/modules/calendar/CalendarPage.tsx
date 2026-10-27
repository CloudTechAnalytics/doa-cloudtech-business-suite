import clsx from 'clsx'
import { CalendarPlus, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { canManageStaff } from '@/demo/demoStore'
import { listActivities } from '@/modules/crm/dealsApi'
import { listInvoices } from '@/modules/invoices/invoicesApi'
import { Button, EmptyState, ErrorState, PageHeader, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { downloadFile } from '@/shared/utilities/csvExport'
import { isDemoMode } from '@/shared/utilities/env'
import { naira } from '@/shared/utilities/format'
import * as api from './calendarApi'
import { EventForm, EventView } from './CalendarEvent'
import {
  KINDS, VIEWS, addDays, applyFilter, byDay, dayKey, dayName, expand, followupOverlays, invoiceOverlays, layoutDay, monthGrid, monthName, newDraft, draftFromEvent, parseDay, rangeTitle,
  sameDay, shiftAnchor, startOfDay, timeLabel, toIcs, viewRange, weekDays, whenLabel,
} from './calendarLogic'
import type { Draft, Occurrence, View } from './calendarLogic'

const HOUR = 48 // pixels an hour takes in the day and week views

/**
 * The calendar: appointments, meetings, deadlines and reminders for the business and its team. Week, month, day and agenda views; your own and shared events with
 * who is invited; repeats; CRM follow-ups and invoices due shown beside them (read-only); and a file you can open in Google, Outlook or Apple Calendar.
 */
export function CalendarPage() {
  const { active } = useBusiness()
  const { userId } = useAuth()
  const { statuses } = useModules()
  const perms = usePermissions(active?.id ?? '')
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const businessId = active?.id ?? ''
  const view: View = VIEWS.find((v) => v.key === params.get('tab'))?.key ?? 'week'
  const anchor = useMemo(() => { const k = params.get('date'); return k && /^\d{4}-\d{2}-\d{2}$/.test(k) ? parseDay(k) : startOfDay(new Date()) }, [params])
  const range = useMemo(() => viewRange(view, anchor), [view, anchor])
  const from = range.from.getTime(); const to = range.to.getTime()
  const usable = (c: string) => statuses.some((s) => s.code === c && s.usable)
  const hasCrm = usable('customers'); const hasInvoices = usable('invoices')

  const events = useAsync(() => api.listEvents(businessId, new Date(from), new Date(to)), [businessId, from, to])
  const followups = useAsync(async () => (hasCrm ? followupOverlays(await listActivities(businessId).catch(() => [])) : []), [businessId, hasCrm])
  const invoices = useAsync(async () => (hasInvoices ? invoiceOverlays(await listInvoices(businessId).catch(() => []), naira) : []), [businessId, hasInvoices])

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [mine, setMine] = useState(false); const [showFollowups, setShowFollowups] = useState(true); const [showInvoices, setShowInvoices] = useState(true)
  const [open, setOpen] = useState<Occurrence | null>(null)
  const [form, setForm] = useState<Draft | null>(null)
  const canManage = perms.can('calendar.manage')
  // The Record menu opens the calendar with ?new=1: show the form once, then take it out of the address.
  const wantsNew = params.get('new') === '1'
  useEffect(() => {
    if (wantsNew && canManage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(newDraft(new Date()))
      setParams({ tab: view, date: dayKey(anchor) }, { replace: true })
    }
  }, [wantsNew, canManage, view, anchor, setParams])
  if (!active) return null
  const canSettings = isDemoMode ? canManageStaff(active.role ?? null) : perms.can('settings.manage')

  const all = expand(events.data ?? [], range.from, range.to)
  const overlays = [...(followups.data ?? []), ...(invoices.data ?? [])].filter((o) => o.start.getTime() < to && o.end.getTime() >= from)
  const shown = applyFilter([...all, ...overlays].sort((a, z) => a.start.getTime() - z.start.getTime()), { hiddenKinds: hidden, mineOnly: mine, userId, showFollowups, showInvoices })
  const go = (next: Partial<{ tab: View; date: Date }>) => setParams({ tab: next.tab ?? view, date: dayKey(next.date ?? anchor) })
  const refresh = async () => { await events.refresh() }
  const today = startOfDay(new Date())
  const press = (o: Occurrence) => (o.overlay ? nav(o.overlay.to) : setOpen(o))
  const create = (at: Date, allDay = false) => { if (canManage) setForm(newDraft(at, allDay)) }

  return (
    <>
      <PageHeader title="Calendar" description="Appointments, meetings, deadlines and reminders, for you and your team."
        actions={<><Button variant="secondary" onClick={() => downloadFile('doa-calendar.ics', toIcs(events.data ?? []), 'text/calendar')} disabled={!(events.data?.length)}><Download className="size-4" aria-hidden /> Export (.ics)</Button>{canManage && <Button onClick={() => create(new Date())}><CalendarPlus className="size-4" aria-hidden /> New event</Button>}</>} />
      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <aside className="space-y-4">
          <MiniMonth anchor={anchor} today={today} marked={new Set(shown.map((o) => dayKey(o.start)))} onPick={(d) => go({ date: d, tab: view === 'month' ? 'month' : view })} />
          <section aria-label="Show" className="rounded-lg border border-line bg-white p-3 text-sm">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">Show</h2>
            <ul className="space-y-1.5">
              {KINDS.map((k) => (
                <li key={k.key}><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={!hidden.has(k.key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(k.key)) n.delete(k.key); else n.add(k.key); return n })} /><span className="size-2.5 rounded-full" style={{ background: k.color }} aria-hidden />{k.label}s</label></li>
              ))}
              {hasCrm && <li><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showFollowups} onChange={(e) => setShowFollowups(e.target.checked)} /><span className="size-2.5 rounded-full bg-[#d6336c]" aria-hidden />CRM follow-ups</label></li>}
              {hasInvoices && <li><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showInvoices} onChange={(e) => setShowInvoices(e.target.checked)} /><span className="size-2.5 rounded-full bg-[#0b7285]" aria-hidden />Invoices due</label></li>}
            </ul>
            <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-line pt-3"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
          </section>
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => go({ date: today })}>Today</Button>
            <Button variant="secondary" aria-label="Previous" onClick={() => go({ date: shiftAnchor(view, anchor, -1) })}><ChevronLeft className="size-4" aria-hidden /></Button>
            <Button variant="secondary" aria-label="Next" onClick={() => go({ date: shiftAnchor(view, anchor, 1) })}><ChevronRight className="size-4" aria-hidden /></Button>
            <h2 className="mx-1 text-lg font-semibold" aria-live="polite">{rangeTitle(view, anchor)}</h2>
            <div className="ml-auto flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="View">
              {VIEWS.slice().sort((a, z) => ['day', 'week', 'month', 'agenda'].indexOf(a.key) - ['day', 'week', 'month', 'agenda'].indexOf(z.key)).map((v) => (
                <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => go({ tab: v.key })} className={clsx('rounded-md px-3 py-1 text-sm', view === v.key ? 'bg-ink text-white' : 'text-ink/70 hover:bg-surface')}>{v.label}</button>
              ))}
            </div>
          </div>
          {events.error && <ErrorState message={events.error} />}
          {events.loading && !events.data ? <Spinner /> : (
            <>
              {view === 'month' && <MonthView anchor={anchor} today={today} occs={shown} onPress={press} onDay={(d) => go({ tab: 'day', date: d })} onCreate={(d) => create(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9))} />}
              {(view === 'week' || view === 'day') && <TimeGrid days={view === 'week' ? weekDays(anchor) : [anchor]} today={today} occs={shown} onPress={press} onDay={(d) => go({ tab: 'day', date: d })} onCreate={(d, allDay) => create(d, allDay)} />}
              {view === 'agenda' && <Agenda from={range.from} days={30} occs={shown} onPress={press} />}
            </>
          )}
          {!canManage && <p className="mt-3 text-xs text-ink/60">Your role can see the calendar but not add events.</p>}
        </div>
      </div>

      {open && <EventView businessId={businessId} occ={open} userId={userId ?? null} canManage={canManage} canEdit={open.event.createdBy === userId || canSettings} onClose={() => setOpen(null)} onChanged={refresh} onEdit={() => { setForm(draftFromEvent(open.event)); setOpen(null) }} />}
      {form && <EventForm businessId={businessId} initial={form} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await refresh() }} />}
    </>
  )
}

function MiniMonth({ anchor, today, marked, onPick }: { anchor: Date; today: Date; marked: ReadonlySet<string>; onPick: (d: Date) => void }) {
  const [shown, setShown] = useState(anchor)
  useEffect(() => { const t = setTimeout(() => setShown(anchor), 0); return () => clearTimeout(t) }, [anchor])
  const grid = monthGrid(shown)
  return (
    <section aria-label="Pick a date" className="rounded-lg border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-semibold">
        <button type="button" aria-label="Previous month" className="rounded p-1 hover:bg-surface" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}><ChevronLeft className="size-4" aria-hidden /></button>
        <span>{monthName(shown.getMonth())} {shown.getFullYear()}</span>
        <button type="button" aria-label="Next month" className="rounded p-1 hover:bg-surface" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}><ChevronRight className="size-4" aria-hidden /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-ink/50">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7 text-center text-xs">
        {grid.flat().map(({ date, inMonth }) => (
          <button key={dayKey(date)} type="button" onClick={() => onPick(date)} aria-label={`${dayName(date)} ${date.getDate()} ${monthName(date.getMonth())}`} aria-current={sameDay(date, today) ? 'date' : undefined}
            className={clsx('relative m-0.5 grid size-7 place-items-center rounded-full', !inMonth && 'text-ink/30', sameDay(date, anchor) ? 'bg-ink font-semibold text-white' : sameDay(date, today) ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-surface')}>
            {date.getDate()}{marked.has(dayKey(date)) && !sameDay(date, anchor) && <span className="absolute bottom-0.5 size-1 rounded-full bg-accent" aria-hidden />}
          </button>
        ))}
      </div>
    </section>
  )
}

const chip = (o: Occurrence) => `${o.allDay ? '' : `${timeLabel(o.start)} `}${o.title}`

function MonthView({ anchor, today, occs, onPress, onDay, onCreate }: { anchor: Date; today: Date; occs: Occurrence[]; onPress: (o: Occurrence) => void; onDay: (d: Date) => void; onCreate: (d: Date) => void }) {
  const grid = monthGrid(anchor); const days = byDay(occs)
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs font-semibold text-ink/60">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="py-2">{d}</span>)}</div>
      {grid.map((week, w) => (
        <div key={w} className="grid grid-cols-7">
          {week.map(({ date, inMonth }) => {
            const list = days.get(dayKey(date)) ?? []
            return (
              <div key={dayKey(date)} onDoubleClick={() => onCreate(date)} className={clsx('min-h-24 min-w-0 border-b border-r border-line p-1', !inMonth && 'bg-surface/60')}>
                <button type="button" onClick={() => onDay(date)} className={clsx('mb-0.5 grid size-6 place-items-center rounded-full text-xs', sameDay(date, today) ? 'bg-accent font-semibold text-white' : inMonth ? 'text-ink' : 'text-ink/40')}>{date.getDate()}</button>
                <ul className="space-y-0.5">
                  {list.slice(0, 3).map((o) => <li key={o.key}><button type="button" onClick={() => onPress(o)} title={o.title} className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:brightness-95" style={{ background: `${o.color}22`, borderLeft: `3px solid ${o.color}` }}>{chip(o)}</button></li>)}
                  {list.length > 3 && <li><button type="button" onClick={() => onDay(date)} className="px-1 text-[11px] font-medium text-ink/60 hover:underline">+{list.length - 3} more</button></li>}
                </ul>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function TimeGrid({ days, today, occs, onPress, onDay, onCreate }: { days: Date[]; today: Date; occs: Occurrence[]; onPress: (o: Occurrence) => void; onDay: (d: Date) => void; onCreate: (d: Date, allDay: boolean) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR - 8 }, [])
  const perDay = byDay(occs)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="grid border-b border-line bg-surface" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <button key={dayKey(d)} type="button" onClick={() => onDay(d)} className="border-l border-line py-2 text-center hover:bg-white">
            <span className="block text-[11px] uppercase text-ink/55">{dayName(d).slice(0, 3)}</span>
            <span className={clsx('mx-auto grid size-8 place-items-center rounded-full text-base font-semibold', sameDay(d, today) && 'bg-accent text-white')}>{d.getDate()}</span>
          </button>
        ))}
      </div>
      {days.some((d) => (perDay.get(dayKey(d)) ?? []).some((o) => o.allDay)) && (
        <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
          <span className="p-1 text-[10px] text-ink/50">All day</span>
          {days.map((d) => <div key={dayKey(d)} className="space-y-0.5 border-l border-line p-1">{(perDay.get(dayKey(d)) ?? []).filter((o) => o.allDay).map((o) => <button key={o.key} type="button" onClick={() => onPress(o)} className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white" style={{ background: o.color }} title={o.title}>{o.title}</button>)}</div>)}
        </div>
      )}
      <div ref={scroller} className="max-h-[62vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="relative">{Array.from({ length: 24 }, (_, h) => <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-ink/50" style={{ top: h * HOUR }}>{h === 0 ? '' : timeLabel(new Date(2000, 0, 1, h))}</span>)}</div>
          {days.map((d) => {
            const placed = layoutDay(d, perDay.get(dayKey(d)) ?? [])
            return (
              <div key={dayKey(d)} className="relative border-l border-line" role="button" tabIndex={0} aria-label={`Add an event on ${dayName(d)} ${d.getDate()}`}
                onClick={(e) => { if (e.target !== e.currentTarget) return; const y = e.nativeEvent.offsetY; onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.min(23, Math.floor(y / HOUR))), false) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), false) }}>
                {Array.from({ length: 24 }, (_, h) => <span key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR }} />)}
                {sameDay(d, now) && <span className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 1440) * 24 * HOUR }} aria-hidden />}
                {placed.map((p) => (
                  <button key={p.occ.key} type="button" onClick={() => onPress(p.occ)} title={`${p.occ.title}, ${whenLabel(p.occ)}`}
                    className="absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm hover:brightness-95"
                    style={{ top: `${p.top * 100}%`, height: `calc(${p.height * 100}% - 2px)`, left: `calc(${(p.col / p.cols) * 100}% + 1px)`, width: `calc(${100 / p.cols}% - 3px)`, background: `${p.occ.color}22`, borderLeft: `3px solid ${p.occ.color}` }}>
                    <span className="block truncate font-semibold">{p.occ.title}</span><span className="block truncate text-ink/70">{timeLabel(p.occ.start)} to {timeLabel(p.occ.end)}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Agenda({ from, days, occs, onPress }: { from: Date; days: number; occs: Occurrence[]; onPress: (o: Occurrence) => void }) {
  const per = byDay(occs)
  const list = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => per.has(dayKey(d)))
  if (!list.length) return <EmptyState title="Nothing in the next 30 days" description="Add an appointment, a meeting or a deadline, and it shows here." />
  return (
    <div className="space-y-4">
      {list.map((d) => (
        <section key={dayKey(d)} aria-label={`${dayName(d)} ${d.getDate()} ${monthName(d.getMonth())}`}>
          <h3 className="mb-1 text-sm font-semibold">{dayName(d)} {d.getDate()} {monthName(d.getMonth())}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
            {per.get(dayKey(d))!.map((o) => (
              <li key={o.key}><button type="button" onClick={() => onPress(o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface">
                <span className="w-24 shrink-0 text-xs text-ink/60">{o.allDay ? 'All day' : `${timeLabel(o.start)} to ${timeLabel(o.end)}`}</span>
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: o.color }} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.title}</span><span className="block truncate text-xs text-ink/60">{o.overlay ? o.overlay.detail : [o.event.location, o.event.attendees.length ? `${o.event.attendees.length} invited` : ''].filter(Boolean).join(' · ')}</span></span>
              </button></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
