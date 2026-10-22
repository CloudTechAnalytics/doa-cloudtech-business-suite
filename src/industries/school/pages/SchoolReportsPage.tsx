import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { downloadCsv, fullName, useSchool } from '../components/schoolUi'
import { loadAttendance, loadBills, loadScores, loadStudents } from '../services/schoolApi'

type Report = 'enrolment' | 'attendance' | 'results' | 'fees'
type Table = { head: string[]; rows: (string | number)[][]; note?: string }

/** Reports calculated from the records. Each can be downloaded as a CSV file for Excel. */
export function SchoolReportsPage() {
  const ctx = useSchool()
  const { businessId, s, can, className, subjectName, currentTerm, active } = ctx
  const [rep, setRep] = useState<Report>('enrolment'); const [term, setTerm] = useState(''); const [cls, setCls] = useState('')
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const att = useAsync(() => loadAttendance(businessId), [businessId])
  const scores = useAsync(() => loadScores(businessId), [businessId])
  const bills = useAsync(() => loadBills(businessId).catch(() => null), [businessId])
  if (!active) return null
  const t = term || currentTerm?.id || ''
  const termInfo = s?.terms.find((x) => x.id === t)
  const roster = (students.data ?? []).filter((x) => !cls || x.classId === cls)
  const ids = new Set(roster.map((x) => x.id))
  const loading = students.loading || att.loading || scores.loading || bills.loading

  const tables: Record<Report, () => Table> = {
    enrolment: () => ({
      head: ['Class', 'Active', 'Female', 'Male', 'Transferred', 'Withdrawn', 'Graduated'],
      rows: (s?.classes ?? []).filter((c) => !cls || c.id === cls).map((c) => { const k = (students.data ?? []).filter((x) => x.classId === c.id); const n = (f: (x: (typeof k)[number]) => boolean) => k.filter(f).length; return [c.name, n((x) => x.status === 'active'), n((x) => x.status === 'active' && x.gender === 'female'), n((x) => x.status === 'active' && x.gender === 'male'), n((x) => x.status === 'transferred'), n((x) => x.status === 'withdrawn'), n((x) => x.status === 'graduated')] }),
    }),
    attendance: () => {
      const within = (att.data ?? []).filter((a) => ids.has(a.studentId) && (!termInfo || (a.on >= termInfo.startsOn && a.on <= termInfo.endsOn)))
      return { head: ['Student', 'Class', 'Days marked', 'Present', 'Late', 'Absent', 'Excused', 'Attendance %'], note: termInfo ? `For ${termInfo.name}.` : undefined,
        rows: roster.filter((x) => x.status === 'active').map((x) => { const m = within.filter((a) => a.studentId === x.id); const c = (st: string) => m.filter((a) => a.status === st).length; return [fullName(x), className(x.classId), m.length, c('present'), c('late'), c('absent'), c('excused'), m.length ? Math.round(((c('present') + c('late')) * 1000) / m.length) / 10 : '–'] }) }
    },
    results: () => {
      const mine = (scores.data ?? []).filter((r) => r.termId === t && ids.has(r.studentId))
      const subs = [...new Set(mine.map((r) => r.subjectId))]
      return { head: ['Student', 'Class', ...subs.map(subjectName), 'Average'], note: `${termInfo?.name ?? ''}: includes scores in every state; only published ones are visible to parents.`,
        rows: roster.filter((x) => mine.some((r) => r.studentId === x.id)).map((x) => { const tot = subs.map((sid) => { const r = mine.find((y) => y.studentId === x.id && y.subjectId === sid); return r ? (r.ca ?? 0) + (r.exam ?? 0) : null }); const got = tot.filter((v): v is number => v !== null); return [fullName(x), className(x.classId), ...tot.map((v) => v ?? '–'), got.length ? Math.round((got.reduce((a, b) => a + b, 0) * 10) / got.length) / 10 : '–'] }) }
    },
    fees: () => {
      const mine = (bills.data ?? []).filter((b) => b.termId === t && ids.has(b.studentId))
      return { head: ['Student', 'Class', 'Bill', 'Payable', 'Paid', 'Balance', 'Status'], note: `${termInfo?.name ?? ''}. Reversed payments are not counted as paid.`,
        rows: mine.map((b) => [b.studentName, b.className ?? '', b.number, b.payable, b.paid, b.balance, label(b.status)]) }
    },
  }
  const reports = ([['enrolment', 'Enrolment'], ['attendance', 'Attendance'], ['results', 'Results'], ...(can('school.fees.read') ? [['fees', 'Fees']] : [])] as [Report, string][])
  const table = tables[rep]()
  const money = (h: string) => rep === 'fees' && ['Payable', 'Paid', 'Balance'].includes(h)
  return (
    <>
      <PageHeader title="Reports" description="Figures counted from the school's records. Download any of them as a CSV file to open in Excel." actions={<Button variant="secondary" disabled={!table.rows.length} onClick={() => downloadCsv(`school-${rep}`, [table.head, ...table.rows])}><Download className="size-4" aria-hidden /> Export CSV</Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">{reports.map(([id, x]) => <Button key={id} variant={rep === id ? 'primary' : 'secondary'} onClick={() => setRep(id)}>{x}</Button>)}</div>
        {rep !== 'enrolment' && <div className="w-48"><SelectField label="Term" value={t} onChange={(e) => setTerm(e.target.value)}>{(s?.terms ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></div>}
        <div className="w-44"><SelectField label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
      </div>
      {(students.error || att.error || scores.error) && <ErrorState message={(students.error ?? att.error ?? scores.error)!} />}
      {loading ? <Spinner /> : !table.rows.length ? <Card><EmptyState title="Nothing to report" description="There are no records for these choices yet." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr>{table.head.map((h, i) => <th key={h + i} className={`p-3 ${i > 1 && rep !== 'enrolment' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/10">{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`p-3 ${j > 1 || rep === 'enrolment' && j > 0 ? 'tabular text-right' : ''}`}>{typeof c === 'number' && money(table.head[j]) ? naira(c) : c}</td>)}</tr>)}</tbody></table>
          {table.note && <p className="border-t border-line p-3 text-xs text-ink/60">{table.note}</p>}
        </Card>
      )}
    </>
  )
}
