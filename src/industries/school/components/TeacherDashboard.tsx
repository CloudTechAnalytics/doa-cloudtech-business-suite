import { BarChart3, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ClipboardList, Clock, LayoutList, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { greeting } from '@/core/businesses/chooser'
import { Badge, Card, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { loadAnnouncements, loadAttendance, loadScores, loadStaff, loadStudents, loadTimetable } from '../services/schoolApi'
import { attentionItems, callName, classCards, lessonState, lessonsOn, timetableDay } from '../teacherDashboard'
import { today, useSchool } from './schoolUi'

const dateLine = (d: Date) => d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

interface Action { to: string; label: string; hint: string; icon: LucideIcon; tone: string; perm: string }
const ACTIONS: Action[] = [
  { to: '/app/school/my-classes', label: 'My classes', hint: 'Pupils and what is due', icon: LayoutList, tone: 'bg-sky-100 text-sky-700', perm: 'school.teach' },
  { to: '/app/school/attendance', label: 'Attendance', hint: "Take today's register", icon: CalendarCheck, tone: 'bg-emerald-100 text-emerald-700', perm: 'school.attendance' },
  { to: '/app/school/results', label: 'Results', hint: 'Enter and submit scores', icon: ClipboardList, tone: 'bg-violet-100 text-violet-700', perm: 'school.results.enter' },
  { to: '/app/school/timetable', label: 'Timetable', hint: 'Your week at a glance', icon: CalendarDays, tone: 'bg-amber-100 text-amber-700', perm: 'dashboard.read' },
  { to: '/app/school/reports', label: 'Reports', hint: 'Attendance and results', icon: BarChart3, tone: 'bg-rose-100 text-rose-700', perm: 'dashboard.read' },
  { to: '/app/school/announcements', label: 'Notices', hint: 'From the school office', icon: Megaphone, tone: 'bg-teal-100 text-teal-700', perm: 'dashboard.read' },
]

/** A teacher's day: who they are teaching and when, what needs doing, and each of their classes. Built from the records they are allowed to see. */
export function TeacherDashboard() {
  const ctx = useSchool()
  const { businessId, s, currentTerm, className, subjectName, can } = ctx
  const { userId } = useAuth()
  const staff = useAsync(() => loadStaff(businessId), [businessId])
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const attendance = useAsync(() => loadAttendance(businessId), [businessId])
  const scores = useAsync(() => loadScores(businessId), [businessId])
  const week = useAsync(() => loadTimetable(businessId).catch(() => ({ periods: [], slots: [] })), [businessId])
  const notes = useAsync(() => loadAnnouncements(businessId).catch(() => []), [businessId])
  const now = new Date()
  if (!businessId) return null

  const me = (staff.data?.staff ?? []).find((x) => x.userId === userId)
  const mine = (staff.data?.assignments ?? []).filter((a) => me && a.staffId === me.id)
  const day = timetableDay(now)
  const schoolDay = (s?.settings?.workingDays ?? [1, 2, 3, 4, 5]).includes(day)
  const cards = classCards(mine, (students.data ?? []).map((p) => ({ id: p.id, classId: p.classId, status: p.status })), attendance.data ?? [], scores.data ?? [], currentTerm?.id ?? '', today())
  const lessons = me && week.data ? lessonsOn(day, week.data.periods, week.data.slots, me.id) : []
  const todo = attentionItems(cards, className, subjectName, schoolDay)
  const pupilCount = cards.reduce((a, c) => a + c.pupils, 0)
  const loading = staff.loading || students.loading
  const name = callName(me?.name)

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3a5f] via-[#264f7e] to-[#3b6fb0] p-5 text-white shadow-card sm:p-7">
        <p className="text-sm text-white/75">{dateLine(now)}</p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting(now.getHours())}{name ? `, ${name}` : ''}</h2>
        <p className="mt-1 text-sm text-white/80">{currentTerm ? `${currentTerm.name} · ` : ''}{loading ? 'Getting your day ready…' : me ? (cards.length ? `${cards.length} class${cards.length === 1 ? '' : 'es'} · ${pupilCount} pupil${pupilCount === 1 ? '' : 's'}` : 'No classes assigned to you yet') : 'Welcome'}</p>
        {!loading && me && schoolDay && lessons.length > 0 && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><Clock className="size-3.5" aria-hidden /> {lessons.length} lesson{lessons.length === 1 ? '' : 's'} today</p>}
      </section>

      {!loading && !me && (
        <Card className="border-amber/50 bg-amber/10 text-sm"><b>Your sign-in is not linked to a staff record yet.</b> Ask the principal to open Teachers &amp; Staff and check that the email on your record is the one you sign in with, and that "Still working here" is ticked.</Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Needs your attention</h3>
            {loading ? <Spinner /> : todo.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink/70"><CheckCircle2 className="size-5 text-success" aria-hidden /> {me && cards.length ? 'You are all caught up.' : 'Nothing to do yet.'}</p>
            ) : (
              <ul className="space-y-2">
                {todo.slice(0, 6).map((t, i) => (
                  <li key={i}>
                    <Link to={t.to} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-sm transition hover:border-ink/30 hover:bg-surface">
                      <span className="flex items-center gap-2"><span aria-hidden className={`size-2 shrink-0 rounded-full ${t.kind === 'register' ? 'bg-amber' : 'bg-violet-500'}`} />{t.text}</span>
                      <span className="shrink-0 text-xs font-semibold text-ink/60">{t.kind === 'register' ? 'Take register' : 'Enter scores'} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">Today&apos;s lessons</h3>
            {!schoolDay ? <p className="text-sm text-ink/60">No school today.</p> : lessons.length === 0 ? <p className="text-sm text-ink/60">{week.data && week.data.periods.length === 0 ? 'The school day has not been set up yet.' : 'You have no lessons on the timetable today.'}</p> : (
              <ol className="relative space-y-3 border-l-2 border-line pl-4">
                {lessons.map((l) => {
                  const st = lessonState(l, hhmm(now))
                  return (
                    <li key={l.period.id + l.classId} className="relative">
                      <span aria-hidden className={`absolute -left-[1.4rem] top-1.5 size-3 rounded-full border-2 border-white ${st === 'now' ? 'bg-emerald-500 ring-4 ring-emerald-100' : st === 'done' ? 'bg-ink/25' : 'bg-amber'}`} />
                      <div className={`flex items-center justify-between gap-3 text-sm ${st === 'done' ? 'text-ink/45' : ''}`}>
                        <span><b>{subjectName(l.subjectId)}</b> · {className(l.classId)}{l.room ? <span className="text-ink/55"> · {l.room}</span> : null}</span>
                        <span className="flex shrink-0 items-center gap-2"><span className="tabular text-xs text-ink/60">{l.period.startsAt}–{l.period.endsAt}</span>{st === 'now' && <Badge tone="success">Now</Badge>}</span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {ACTIONS.filter((a) => can(a.perm)).map((a) => (
              <Link key={a.to} to={a.to} className="group rounded-xl border border-line bg-white p-3.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-raised">
                <span className={`mb-2 grid size-9 place-items-center rounded-lg ${a.tone}`}><a.icon className="size-5" aria-hidden /></span>
                <span className="block text-sm font-bold">{a.label}</span>
                <span className="block text-xs text-ink/60">{a.hint}</span>
              </Link>
            ))}
          </div>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Notices</h3>
            {notes.data?.length ? <ul className="divide-y divide-ink/10 text-sm">{notes.data.slice(0, 3).map((a) => <li key={a.id} className="py-2"><b>{a.title}</b><div className="text-xs text-ink/60">{a.publishOn}</div></li>)}</ul> : <p className="text-sm text-ink/60">No notices.</p>}
          </Card>
        </div>
      </div>

      {cards.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">My classes</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <li key={c.classId}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-2"><h4 className="text-lg font-bold">{className(c.classId)}</h4>{c.classTeacher && <Badge tone="info">Class teacher</Badge>}</div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-ink/70"><BookOpen className="size-4 text-ink/45" aria-hidden />{c.pupils} pupil{c.pupils === 1 ? '' : 's'}{c.subjects.length > 0 && <> · {c.subjects.map((x) => subjectName(x.subjectId)).join(', ')}</>}</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="flex items-center justify-between gap-2"><span className="text-ink/70">Register today</span>{!schoolDay ? <span className="text-xs text-ink/50">No school</span> : c.registerMarked ? <Badge tone="success">Taken · {c.registerMarked}</Badge> : <Badge tone="warning">Not taken</Badge>}</p>
                    {c.subjects.map((x) => (
                      <div key={x.subjectId}>
                        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-ink/70">{subjectName(x.subjectId)} scores</span><span className="tabular font-semibold">{x.entered}/{x.pupils}</span></div>
                        <div className="mt-1 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${x.pupils ? Math.round((x.entered / x.pupils) * 100) : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
