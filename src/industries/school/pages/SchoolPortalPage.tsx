import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { fullName, useSchool } from '../components/schoolUi'
import { claimLinks, loadAnnouncements, loadAttendance, loadBills, loadGuardians, loadPayments, loadStudents, reportCard } from '../services/schoolApi'
import { ReportCardView } from './SchoolResultsPage'

/** The parent's view: only their own children, only published results, and only their own bills and payments. */
export function SchoolPortalPage() {
  const ctx = useSchool()
  const { businessId, s, className, active, termName } = ctx
  const [claimed, setClaimed] = useState(false)
  useEffect(() => { if (businessId) void claimLinks(businessId).catch(() => undefined).finally(() => setClaimed(true)) }, [businessId])
  const kids = useAsync(() => (claimed ? loadStudents(businessId) : Promise.resolve([])), [businessId, claimed])
  const [kid, setKid] = useState(''); const [term, setTerm] = useState('')
  const id = kid || kids.data?.[0]?.id || ''
  const child = kids.data?.find((x) => x.id === id)
  const t = term || ctx.currentTerm?.id || ''
  const att = useAsync(() => (id ? loadAttendance(businessId) : Promise.resolve([])), [businessId, id, claimed])
  const bills = useAsync(() => (claimed ? loadBills(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const pays = useAsync(() => (claimed ? loadPayments(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const notes = useAsync(() => (claimed ? loadAnnouncements(businessId).catch(() => []) : Promise.resolve([])), [businessId, claimed])
  const guardians = useAsync(() => (claimed ? loadGuardians(businessId).catch(() => null) : Promise.resolve(null)), [businessId, claimed])
  const card = useAsync(() => (id && t ? reportCard(businessId, id, t).catch(() => null) : Promise.resolve(null)), [businessId, id, t])
  if (!active) return null
  if (!claimed || kids.loading) return <Spinner />
  if (!kids.data?.length) return <><PageHeader title="Parent Portal" /><Card><EmptyState title="No children linked to your login" description="Ask the school office to record your email address on your child's record, then open this page again." /></Card></>

  const mine = (att.data ?? []).filter((a) => a.studentId === id)
  const myBills = (bills.data ?? []).filter((b) => b.studentId === id)
  const myPays = (pays.data ?? []).filter((p) => p.studentId === id)
  const rate = mine.length ? Math.round((mine.filter((a) => a.status === 'present' || a.status === 'late').length * 1000) / mine.length) / 10 : null
  const owed = myBills.reduce((a, b) => a + b.balance, 0)
  void guardians
  return (
    <>
      <PageHeader title="Parent Portal" description="Your child's attendance, published results, fees and school notices." />
      {kids.error && <ErrorState message={kids.error} />}
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        {kids.data.length > 1 && <div className="w-60"><SelectField label="Child" value={id} onChange={(e) => setKid(e.target.value)}>{kids.data.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</SelectField></div>}
        <div className="w-48"><SelectField label="Term" value={t} onChange={(e) => setTerm(e.target.value)}>{(s?.terms ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></div>
      </div>
      {child && <p className="mb-3 text-sm"><b>{fullName(child)}</b> · {child.admissionNo} · {className(child.classId)} <Badge tone={child.status === 'active' ? 'success' : 'neutral'}>{label(child.status)}</Badge></p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-2 text-sm font-semibold">Attendance</h3>{mine.length ? <><p className="mb-2 text-sm">Present or late on <b>{rate}%</b> of {mine.length} school days marked.</p><ul className="max-h-48 divide-y divide-ink/10 overflow-auto text-sm">{[...mine].sort((a, b) => b.on.localeCompare(a.on)).slice(0, 30).map((a) => <li key={a.id} className="flex justify-between py-1"><span>{a.on}</span><Badge tone={a.status === 'present' ? 'success' : a.status === 'absent' ? 'danger' : 'warning'}>{label(a.status)}</Badge></li>)}</ul></> : <p className="text-sm text-ink/60">No attendance recorded yet.</p>}</Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Fees</h3>
          {myBills.length ? <><p className="mb-2 text-sm">{owed > 0 ? <>Still owed: <b className="text-warning">{naira(owed)}</b></> : <b className="text-success">Fully paid</b>}</p><ul className="divide-y divide-ink/10 text-sm">{myBills.map((b) => <li key={b.id} className="flex justify-between py-1"><span>{b.number} · {termName(b.termId)}</span><span className="tabular">{naira(b.paid)} of {naira(b.payable)}</span></li>)}</ul>
            {myPays.length > 0 && <><h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-ink/60">Payments</h4><ul className="divide-y divide-ink/10 text-sm">{myPays.map((p) => <li key={p.id} className="flex justify-between py-1"><span>{p.receipt} · {p.paidOn} {p.status === 'reversed' && <Badge tone="danger">Reversed</Badge>}</span><b className="tabular">{naira(p.amount)}</b></li>)}</ul></>}</> : <p className="text-sm text-ink/60">No fee bills yet.</p>}</Card>
        <Card className="lg:col-span-2"><div className="no-print mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Report card</h3>{card.data?.subjects.length ? <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button> : null}</div>
          {card.loading ? <Spinner /> : card.data?.subjects.length ? <ReportCardView card={card.data} /> : <p className="text-sm text-ink/60">No published results for this term yet.</p>}</Card>
        <Card className="lg:col-span-2"><h3 className="mb-2 text-sm font-semibold">Announcements</h3>{notes.data?.length ? <ul className="divide-y divide-ink/10 text-sm">{notes.data.map((a) => <li key={a.id} className="py-2"><div className="flex justify-between"><b>{a.title}</b><span className="text-xs text-ink/60">{a.publishOn}</span></div><p className="whitespace-pre-wrap">{a.body}</p></li>)}</ul> : <p className="text-sm text-ink/60">No announcements.</p>}</Card>
      </div>
    </>
  )
}
