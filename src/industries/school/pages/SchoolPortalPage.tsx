import clsx from 'clsx'
import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { useAuth } from '@/core/auth/AuthProvider'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { Stat, WEEKDAYS, fullName, useSchool } from '../components/schoolUi'
import { TimetableGrid } from '../components/TimetableGrid'
import { claimLinks, loadAnnouncements, loadAttendance, loadBills, loadGuardians, loadPayments, loadStudents, loadTimetable, reportCard, updateMyContact } from '../services/schoolApi'
import type { SAttendance, SStudent } from '../services/schoolApi'
import { ReportCardSheet, printReportCards } from '../components/ReportCardSheet'

type Tab = 'overview' | 'attendance' | 'timetable' | 'results' | 'fees' | 'notices' | 'details'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['attendance', 'Attendance'], ['timetable', 'Timetable'], ['results', 'Results'], ['fees', 'Fees'], ['notices', 'Notices'], ['details', 'My details']]
const MARK = { present: 'bg-success text-white', late: 'bg-amber-dark text-ink', absent: 'bg-danger text-white', excused: 'bg-info text-white' } as const
const rateOf = (rows: SAttendance[]) => (rows.length ? Math.round((rows.filter((a) => a.status === 'present' || a.status === 'late').length * 1000) / rows.length) / 10 : null)

/** The parent's own pages: only their own children, only published results, and only their own bills and payments. */
export function SchoolPortalPage() {
  const ctx = useSchool()
  const { businessId, s, className, active, termName, currentTerm } = ctx
  const [claimed, setClaimed] = useState(false)
  useEffect(() => { if (businessId) void claimLinks(businessId).catch(() => undefined).finally(() => setClaimed(true)) }, [businessId])
  const kids = useAsync(() => (claimed ? loadStudents(businessId) : Promise.resolve([])), [businessId, claimed])
  const att = useAsync(() => (claimed ? loadAttendance(businessId) : Promise.resolve([])), [businessId, claimed])
  const bills = useAsync(() => (claimed ? loadBills(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const pays = useAsync(() => (claimed ? loadPayments(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const notes = useAsync(() => (claimed ? loadAnnouncements(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const people = useAsync(() => (claimed ? loadGuardians(businessId).catch(() => ({ guardians: [], links: [] })) : Promise.resolve({ guardians: [], links: [] })), [businessId, claimed])
  const week = useAsync(() => (claimed ? loadTimetable(businessId).catch(() => ({ periods: [], slots: [] })) : Promise.resolve({ periods: [], slots: [] })), [businessId, claimed])
  const [tab, setTab] = useState<Tab>('overview'); const [kid, setKid] = useState(''); const [termId, setTermId] = useState('')
  if (!active) return null
  if (!claimed || kids.loading) return <Spinner />
  if (!kids.data?.length) return <><PageHeader title="Parent Portal" /><Card><EmptyState title="No children linked to your login" description="Ask the school office to record your email address on your child's record, then open this page again." /></Card></>

  const children = kids.data
  const child = children.find((x) => x.id === kid) ?? children[0]
  const term = termId || currentTerm?.id || ''
  const termInfo = s?.terms.find((t) => t.id === term)
  const mine = (att.data ?? []).filter((a) => a.studentId === child.id)
  const thisTerm = mine.filter((a) => !termInfo || (a.on >= termInfo.startsOn && a.on <= termInfo.endsOn))
  const myBills = (bills.data ?? []).filter((b) => b.studentId === child.id)
  const owed = myBills.reduce((a, b) => a + b.balance, 0)

  return (
    <>
      <PageHeader title="Parent Portal" description="Your child's attendance, results, fees and school notices." />
      {kids.error && <ErrorState message={kids.error} />}
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        {children.length > 1 && <div className="w-64"><SelectField label="Child" value={child.id} onChange={(e) => setKid(e.target.value)}>{children.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</SelectField></div>}
        <div className="w-48"><SelectField label="Term" value={term} onChange={(e) => setTermId(e.target.value)}>{(s?.terms ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></div>
      </div>
      <p className="mb-3 text-sm"><b>{fullName(child)}</b> · {child.admissionNo} · {className(child.classId)} <Badge tone={child.status === 'active' ? 'success' : 'neutral'}>{label(child.status)}</Badge></p>
      <div role="tablist" aria-label="Parent portal sections" className="no-print mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {TABS.map(([id, t]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx('-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}{id === 'fees' && owed > 0 && <Badge tone="warning">Owing</Badge>}</button>)}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Attendance" value={rateOf(thisTerm) === null ? 'None yet' : `${rateOf(thisTerm)}%`} note={`${termName(term)}: ${thisTerm.length} school days marked`} tone={(rateOf(thisTerm) ?? 100) < 75 ? 'warn' : undefined} />
            <Stat title="Absent" value={String(thisTerm.filter((a) => a.status === 'absent').length)} note="days this term" />
            <Stat title="Fees owing" value={owed > 0 ? naira(owed) : 'Nothing'} tone={owed > 0 ? 'warn' : 'good'} />
            <Stat title="Class" value={className(child.classId)} />
          </div>
          <Card><h3 className="mb-2 text-sm font-semibold">Latest notices</h3>{notes.data?.length ? <ul className="divide-y divide-ink/10 text-sm">{notes.data.slice(0, 3).map((a) => <li key={a.id} className="py-2"><div className="flex justify-between gap-3"><b>{a.title}</b><span className="shrink-0 text-xs text-ink/60">{a.publishOn}</span></div><p className="line-clamp-2 whitespace-pre-wrap text-ink/80">{a.body}</p></li>)}</ul> : <p className="text-sm text-ink/60">No notices.</p>}</Card>
        </div>
      )}
      {tab === 'attendance' && <AttendanceTab ctx={ctx} rows={mine} />}
      {tab === 'timetable' && (week.data?.periods.length && week.data.slots.some((x) => x.classId === child.classId)
        ? <Card className="p-0"><h2 className="border-b border-line p-3 font-semibold">{className(child.classId)} timetable</h2><TimetableGrid periods={week.data.periods} days={WEEKDAYS.filter(([n]) => (s?.settings?.workingDays ?? [1, 2, 3, 4, 5]).includes(n))} cell={(day, p) => { const x = week.data!.slots.find((y) => y.classId === child.classId && y.day === day && y.periodId === p.id); return x ? <div className="rounded-md bg-accent-soft px-2 py-1.5"><b className="block">{ctx.subjectName(x.subjectId)}</b></div> : <span className="text-ink/30">–</span> }} /></Card>
        : <Card><EmptyState title="No timetable yet" description="The school has not published a timetable for this class." /></Card>)}
      {tab === 'results' && <ResultsTab ctx={ctx} child={child} term={term} />}
      {tab === 'fees' && (
        <div className="space-y-3">
          <div className="no-print flex justify-end"><Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print statement</Button></div>
          {myBills.length ? myBills.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{b.number} · {termName(b.termId)}</h3><Badge tone={b.status === 'paid' ? 'success' : b.status === 'overdue' ? 'danger' : 'warning'}>{label(b.status)}</Badge></div>
              <table className="mt-2 w-full text-sm"><tbody className="divide-y divide-ink/10">{b.items.map((i, n) => <tr key={n}><td className="py-1">{i.name}</td><td className="tabular py-1 text-right">{naira(i.amount)}</td></tr>)}
                {b.discount > 0 && <tr><td className="py-1">Discount{b.discountReason ? ` (${b.discountReason})` : ''}</td><td className="tabular py-1 text-right">-{naira(b.discount)}</td></tr>}
                <tr className="font-semibold"><td className="py-1">To pay</td><td className="tabular py-1 text-right">{naira(b.payable)}</td></tr>
                <tr><td className="py-1">Paid so far</td><td className="tabular py-1 text-right">{naira(b.paid)}</td></tr>
                <tr className="font-semibold"><td className="py-1">Still owing</td><td className={clsx('tabular py-1 text-right', b.balance > 0 && 'text-warning')}>{naira(b.balance)}</td></tr></tbody></table>
              {(pays.data ?? []).filter((p) => p.billId === b.id).length > 0 && <ul className="mt-3 divide-y divide-ink/10 border-t border-line pt-1 text-sm">{(pays.data ?? []).filter((p) => p.billId === b.id).map((p) => <li key={p.id} className="flex justify-between py-1.5"><span>Receipt {p.receipt} · {p.paidOn} · {label(p.method)} {p.status === 'reversed' && <Badge tone="danger">Reversed</Badge>}</span><b className="tabular">{naira(p.amount)}</b></li>)}</ul>}
            </Card>
          )) : <Card><EmptyState title="No fee bills yet" /></Card>}
          {myBills.length > 0 && <Notice>To pay, see the school bursar. The school records every payment and it shows here with a receipt number.</Notice>}
        </div>
      )}
      {tab === 'notices' && (notes.data?.length ? <div className="space-y-3">{notes.data.map((a) => <Card key={a.id}><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{a.title}</h3><span className="text-xs text-ink/60">{a.publishOn}</span></div><p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p></Card>)}</div> : <Card><EmptyState title="No notices" /></Card>)}
      {tab === 'details' && <DetailsTab businessId={businessId} data={people.data!} childrenList={children} onSaved={people.refresh} />}
    </>
  )
}

/** A month at a glance: each school day coloured by what was recorded (present, late, absent or excused). */
function AttendanceTab({ ctx, rows }: { ctx: ReturnType<typeof useSchool>; rows: SAttendance[] }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)); const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7
  const inMonth = rows.filter((a) => a.on.startsWith(month))
  const by = new Map(inMonth.map((a) => [a.on, a]))
  const holidays = new Map((ctx.s?.holidays ?? []).map((h) => [h.on, h.name]))
  const count = (st: string) => inMonth.filter((a) => a.status === st).length
  return (
    <div className="space-y-3">
      <div className="max-w-xs"><TextField label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
      <Card>
        <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label="Attendance calendar">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1 font-semibold text-ink/60">{d}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, '0')}`; const a = by.get(d); const hol = holidays.get(d)
            return <div key={d} role="gridcell" title={a ? label(a.status) : hol ?? ''} className={clsx('grid aspect-square place-items-center rounded-md text-sm', a ? MARK[a.status] : hol ? 'bg-canvas text-ink/70 ring-1 ring-line' : 'bg-surface text-ink/50')}>{i + 1}</div> })}
        </div>
        <ul className="mt-4 flex flex-wrap gap-3 text-xs"><li><span className="mr-1 inline-block size-3 rounded bg-success align-middle" />Present {count('present')}</li><li><span className="mr-1 inline-block size-3 rounded bg-amber-dark align-middle" />Late {count('late')}</li><li><span className="mr-1 inline-block size-3 rounded bg-danger align-middle" />Absent {count('absent')}</li><li><span className="mr-1 inline-block size-3 rounded bg-info align-middle" />Excused {count('excused')}</li></ul>
      </Card>
      {!inMonth.length && <p className="text-sm text-ink/60">No attendance recorded for this month.</p>}
    </div>
  )
}

/** The chosen term's published report card, and the average for every term so far. */
function ResultsTab({ ctx, child, term }: { ctx: ReturnType<typeof useSchool>; child: SStudent; term: string }) {
  const terms = ctx.s?.terms ?? []
  const card = useAsync(() => (term ? reportCard(ctx.businessId, child.id, term).catch(() => null) : Promise.resolve(null)), [ctx.businessId, child.id, term])
  const history = useAsync(() => Promise.all(terms.map(async (t) => ({ t, card: await reportCard(ctx.businessId, child.id, t.id).catch(() => null) }))), [ctx.businessId, child.id, terms.length])
  const past = (history.data ?? []).filter((x) => x.card?.subjects.length)
  return (
    <div className="space-y-4">
      {past.length > 1 && <Card><h3 className="mb-2 text-sm font-semibold">Average by term</h3><ul className="divide-y divide-ink/10 text-sm">{past.map(({ t, card: c }) => <li key={t.id} className="flex justify-between py-1.5"><span>{t.name}</span><b className="tabular">{c!.average ?? '–'}</b></li>)}</ul></Card>}
      <Card>
        <div className="no-print mb-2 flex justify-end">{card.data?.subjects.length ? <Button variant="secondary" onClick={() => printReportCards([card.data!])}><Printer className="size-4" aria-hidden /> Print report card</Button> : null}</div>
        {card.loading ? <Spinner /> : card.data?.subjects.length ? <ReportCardSheet card={card.data} /> : <p className="text-sm text-ink/60">No published results for this term yet. The school publishes them when they are ready.</p>}
      </Card>
    </div>
  )
}

/** The parent's own contact record (so the school can reach them), and the children linked to it. */
function DetailsTab({ businessId, data, childrenList, onSaved }: { businessId: string; data: Awaited<ReturnType<typeof loadGuardians>>; childrenList: SStudent[]; onSaved: () => Promise<unknown> }) {
  const { userId } = useAuth()
  const runner = useFormRunner(async () => { await onSaved() })
  const mine = data.guardians.find((g) => g.userId === userId)
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await runner.run(async () => updateMyContact(businessId, String(f.get('phone') ?? ''), String(f.get('address') ?? '')), 'Saved.') }
  if (!mine) return <Card><EmptyState title="No contact record linked to your login yet" description="Ask the school office to add your email to your child's record." /></Card>
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-semibold">{mine.name}</h3>
        <form onSubmit={submit} noValidate className="space-y-3" key={`${mine.phone}|${mine.address}`}>
          <TextField label="Email" value={mine.email ?? ''} readOnly disabled hint="Your email is how you sign in. The school office can change it." />
          <TextField label="Phone number" name="phone" defaultValue={mine.phone ?? ''} maxLength={40} />
          <TextField label="Home address" name="address" defaultValue={mine.address ?? ''} maxLength={300} />
          {runner.error && <ErrorState title="Not saved" message={runner.error} />}
          {runner.ok && <Notice>{runner.ok}</Notice>}
          <Button type="submit" loading={runner.busy}>Save my details</Button>
        </form>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Your children</h3>
        <ul className="divide-y divide-ink/10 text-sm">{childrenList.map((c) => { const l = data.links.find((x) => x.studentId === c.id && x.guardianId === mine.id); return <li key={c.id} className="py-2"><b>{fullName(c)}</b> <span className="text-ink/60">{c.admissionNo}</span>{l && <> <Badge>{l.relationship}</Badge></>}</li> })}</ul>
        <p className="mt-3 text-xs text-ink/60">To change a child&apos;s details or class, contact the school office.</p>
      </Card>
    </div>
  )
}
