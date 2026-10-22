import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label } from '@/shared/utilities/format'
import { NoSetup, fullName, useSchool } from '../components/schoolUi'
import { loadRemarks, loadScores, loadStudents, reportCard, reviewScores, saveRemarks, saveScores } from '../services/schoolApi'
import type { ReportCard, SRemark } from '../services/schoolApi'

const TONE = { draft: 'neutral', submitted: 'warning', approved: 'info', published: 'success' } as const

/** Enter scores per class and subject, approve and publish them, and print report cards. Parents only ever see published results. */
export function SchoolResultsPage() {
  const ctx = useSchool()
  const { businessId, s, can, classes, className, subjectName, termName, currentTerm, active } = ctx
  const [tab, setTab] = useState<'scores' | 'cards'>('scores')
  const [cls, setCls] = useState(''); const [term, setTerm] = useState(''); const [subject, setSubject] = useState('')
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const scores = useAsync(() => loadScores(businessId), [businessId])
  const remarks = useAsync(() => loadRemarks(businessId).catch(() => []), [businessId])
  const [grid, setGrid] = useState<Record<string, { ca: string; exam: string }>>({})
  const [ask, setAsk] = useState<null | 'reject' | 'unpublish'>(null); const [note, setNote] = useState('')
  const [cardFor, setCardFor] = useState<string | null>(null)
  const runner = useFormRunner(async () => { await scores.refresh() })

  // teachers can only see their own pupils, so start on a class that has some
  useEffect(() => { if (!cls && classes.length && students.data) setCls((classes.find((c) => students.data!.some((x) => x.classId === c.id && x.status === 'active')) ?? classes[0]).id) }, [classes, cls, students.data])
  useEffect(() => { if (!term && currentTerm) setTerm(currentTerm.id) }, [currentTerm, term])
  const subjects = (s?.classSubjects ?? []).filter((x) => x.classId === cls).map((x) => x.subjectId)
  useEffect(() => { if (!subjects.includes(subject)) setSubject(subjects[0] ?? '') /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cls, s])
  const roster = (students.data ?? []).filter((x) => x.status === 'active' && x.classId === cls)
  const rows = (scores.data ?? []).filter((x) => x.classId === cls && x.subjectId === subject && x.termId === term)
  useEffect(() => {
    setGrid(Object.fromEntries(roster.map((x) => { const r = rows.find((y) => y.studentId === x.id); return [x.id, { ca: r?.ca?.toString() ?? '', exam: r?.exam?.toString() ?? '' }] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores.data, students.data, cls, subject, term])

  if (!active) return null
  const caMax = s?.settings?.caMax ?? 40; const examMax = s?.settings?.examMax ?? 60
  const state = rows.length ? (['draft', 'submitted', 'approved', 'published'] as const).find((st) => rows.some((r) => r.status === st)) : null
  const approver = can('school.results.approve')
  const locked = !approver && rows.some((r) => r.status !== 'draft')
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const payload = () => roster.map((x) => ({ studentId: x.id, ca: num(grid[x.id]?.ca ?? ''), exam: num(grid[x.id]?.exam ?? '') }))
  const review = (action: 'approve' | 'publish' | 'reject' | 'unpublish', n = '') => void runner.run(async () => reviewScores(businessId, cls, subject, term, action, n), `Results ${action === 'approve' ? 'approved' : action === 'reject' ? 'sent back' : action === 'publish' ? 'published' : 'unpublished'}.`, () => setAsk(null))

  return (
    <>
      <PageHeader title="Results & Report Cards" description={`Each subject is scored out of ${caMax} for class work and ${examMax} for the exam. Scores go from draft to submitted to approved to published; only published results reach parents.`} />
      {s && !s.classes.length && <NoSetup />}
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        <div className="w-48"><SelectField label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>{(s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></div>
        <div className="w-48"><SelectField label="Class" value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        {tab === 'scores' && <div className="w-48"><SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((id) => <option key={id} value={id}>{subjectName(id)}</option>)}</SelectField></div>}
        <div className="ml-auto flex gap-1">{([['scores', 'Enter scores'], ['cards', 'Report cards']] as const).map(([id, t]) => <Button key={id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>{t}</Button>)}</div>
      </div>
      {(students.error || scores.error) && <ErrorState message={(students.error ?? scores.error)!} />}

      {tab === 'scores' && (students.loading || scores.loading ? <Spinner /> : !subject ? <Card><EmptyState title="No subjects for this class" description="Add subjects to the class under Classes & Subjects." /></Card> : !roster.length ? <Card><EmptyState title="No students in this class" /></Card> : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3 text-sm"><b>{className(cls)} · {subjectName(subject)} · {termName(term)}</b>{state ? <Badge tone={TONE[state]}>{label(state)}</Badge> : <Badge>Not started</Badge>}</div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Student</th><th className="p-3 w-32">Class work /{caMax}</th><th className="p-3 w-32">Exam /{examMax}</th><th className="p-3 w-24">Total</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {roster.map((x) => { const g = grid[x.id] ?? { ca: '', exam: '' }; const tot = (num(g.ca) ?? 0) + (num(g.exam) ?? 0); const bad = (num(g.ca) ?? 0) > caMax || (num(g.exam) ?? 0) > examMax
                return <tr key={x.id}><td className="p-3">{fullName(x)}</td>
                  {(['ca', 'exam'] as const).map((k) => <td key={k} className="p-2"><input type="number" min={0} max={k === 'ca' ? caMax : examMax} step="0.5" aria-label={`${k === 'ca' ? 'Class work' : 'Exam'} score for ${fullName(x)}`} disabled={locked || !can('school.results.enter')} value={g[k]} onChange={(e) => setGrid((p) => ({ ...p, [x.id]: { ...g, [k]: e.target.value } }))} className={`tabular w-24 rounded-md border px-2 py-1 ${bad ? 'border-danger' : 'border-line'}`} /></td>)}
                  <td className="tabular p-3 font-medium">{g.ca !== '' || g.exam !== '' ? tot : '–'}</td></tr> })}
            </tbody>
          </table>
          <div className="space-y-2 border-t border-line p-3">
            {locked && <Notice>These results are {state}. Ask the principal if a score needs correcting.</Notice>}
            {approver && (state === 'approved' || state === 'published') && <Notice>You can correct a score here. Corrections to approved or published results are kept in the audit trail.</Notice>}
            {runner.error && <ErrorState title="Not saved" message={runner.error} />}
            {runner.ok && <Notice>{runner.ok}</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              {!locked && can('school.results.enter') && <><Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => saveScores(businessId, cls, subject, term, payload(), false), state === 'approved' || state === 'published' ? 'Correction saved.' : 'Draft saved.')}>{state === 'approved' || state === 'published' ? 'Save correction' : 'Save draft'}</Button>{state !== 'approved' && state !== 'published' && <Button loading={runner.busy} onClick={() => void runner.run(async () => saveScores(businessId, cls, subject, term, payload(), true), 'Submitted for approval.')}>Submit for approval</Button>}</>}
              {can('school.results.approve') && state === 'submitted' && <><Button variant="secondary" onClick={() => { setAsk('reject'); setNote('') }}>Send back</Button><Button loading={runner.busy} onClick={() => review('approve')}>Approve</Button></>}
              {can('school.results.approve') && state === 'approved' && <Button loading={runner.busy} onClick={() => review('publish')}>Publish to parents</Button>}
              {approver && state === 'published' && <Button variant="secondary" onClick={() => { setAsk('unpublish'); setNote('') }}>Unpublish</Button>}
            </div>
          </div>
        </Card>
      ))}

      {tab === 'cards' && (students.loading ? <Spinner /> : !roster.length ? <Card><EmptyState title="No students in this class" /></Card> : (
        <Card className="p-0"><ul className="divide-y divide-ink/10 text-sm">{roster.map((x) => <li key={x.id} className="flex items-center justify-between p-3"><span>{fullName(x)} <span className="text-xs text-ink/60">{x.admissionNo}</span></span><Button variant="secondary" onClick={() => setCardFor(x.id)}>View report card</Button></li>)}</ul></Card>
      ))}

      {ask && <Dialog title={ask === 'reject' ? 'Send results back' : 'Unpublish results'} onClose={() => setAsk(null)}><div className="space-y-4"><TextField label={ask === 'reject' ? 'What should the teacher fix?' : 'Why are these being unpublished?'} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />{runner.error && <ErrorState title="Not sent" message={runner.error} />}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAsk(null)}>Cancel</Button><Button disabled={note.trim().length < 3} loading={runner.busy} onClick={() => review(ask, note)}>{ask === 'reject' ? 'Send back' : 'Unpublish'}</Button></div></div></Dialog>}
      {cardFor && <CardDialog ctx={ctx} studentId={cardFor} termId={term} remarks={remarks.data ?? []} onClose={() => setCardFor(null)} onSaved={remarks.refresh} />}
    </>
  )
}

/** The printable report card. Remarks are edited here by the people allowed to write them. */
export function ReportCardView({ card }: { card: ReportCard }) {
  const a = card.attendance
  return (
    <div className="space-y-3 text-sm">
      <div className="text-center"><h2 className="text-lg font-semibold">Report Card</h2><p>{card.term}{card.session ? ` · ${card.session} session` : ''}</p></div>
      <p><b>{card.student.name}</b> · {card.student.admissionNo} · {card.student.class ?? '–'}</p>
      <table className="w-full border border-line"><thead className="bg-surface text-left text-xs font-semibold"><tr><th className="p-2">Subject</th><th className="p-2 text-right">Class work</th><th className="p-2 text-right">Exam</th><th className="p-2 text-right">Total</th><th className="p-2">Grade</th><th className="p-2">Remark</th></tr></thead>
        <tbody className="divide-y divide-ink/10">{card.subjects.map((x) => <tr key={x.subject}><td className="p-2">{x.subject}</td><td className="tabular p-2 text-right">{x.ca ?? '–'}</td><td className="tabular p-2 text-right">{x.exam ?? '–'}</td><td className="tabular p-2 text-right font-medium">{x.total}</td><td className="p-2 font-semibold">{x.grade}</td><td className="p-2">{x.remark}</td></tr>)}</tbody></table>
      <p>Average: <b className="tabular">{card.average ?? '–'}</b>{card.position ? <> · Position: <b>{card.position}</b> of {card.classSize}</> : null}</p>
      <p>Attendance: present {a.present}, late {a.late}, absent {a.absent}, excused {a.excused} of {a.marked} days marked.</p>
      {card.remarks?.teacherRemark && <p><b>Class teacher:</b> {card.remarks.teacherRemark}</p>}
      {card.remarks?.principalRemark && <p><b>Principal:</b> {card.remarks.principalRemark}</p>}
      {card.remarks?.promotion && <p><b>Decision:</b> {label(card.remarks.promotion)}</p>}
    </div>
  )
}

function CardDialog({ ctx, studentId, termId, remarks, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; studentId: string; termId: string; remarks: SRemark[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { businessId, can } = ctx
  const card = useAsync(() => reportCard(businessId, studentId, termId), [businessId, studentId, termId])
  const mine = remarks.find((r) => r.studentId === studentId && r.termId === termId)
  const [teacher, setTeacher] = useState(mine?.teacherRemark ?? ''); const [principal, setPrincipal] = useState(mine?.principalRemark ?? ''); const [promo, setPromo] = useState<string>(mine?.promotion ?? '')
  const runner = useFormRunner(async () => { await onSaved(); await card.refresh() })
  const writer = can('school.teach') || can('school.manage')
  return (
    <Dialog title="Report card" onClose={onClose} wide>
      {card.loading ? <Spinner /> : card.error ? <ErrorState message={card.error} /> : card.data && (
        <div className="space-y-4">
          <ReportCardView card={card.data} />
          {writer && (
            <div className="no-print space-y-3 border-t border-line pt-3">
              <TextField label="Class teacher's remark" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
              {can('school.manage') && <TextField label="Principal's remark" value={principal} onChange={(e) => setPrincipal(e.target.value)} />}
              {can('school.manage') && <SelectField label="Decision" value={promo} onChange={(e) => setPromo(e.target.value)}><option value="">Not decided</option><option value="promoted">Promoted</option><option value="repeat">Repeat the class</option><option value="graduate">Graduate</option></SelectField>}
              {runner.error && <ErrorState title="Not saved" message={runner.error} />}
              {runner.ok && <Notice>{runner.ok}</Notice>}
              <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => saveRemarks(businessId, studentId, termId, teacher, principal, (promo || null) as SRemark['promotion']), 'Remarks saved.')}>Save remarks</Button>
            </div>
          )}
          <div className="no-print flex justify-end gap-2"><Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button><Button onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Dialog>
  )
}
