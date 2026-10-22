import { useEffect, useState } from 'react'
import { Button, Card, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { WEEKDAYS, today, useSchool } from '../components/schoolUi'
import { saveGrades, saveSettings, setupSchool } from '../services/schoolApi'
import type { SBand, SSettings } from '../services/schoolApi'

/** School information, how marks are shared between class work and exams, working days, grading scale, and first-time setup. */
export function SchoolSettingsPage() {
  const ctx = useSchool()
  const { businessId, s, structure, can, active } = ctx
  const runner = useFormRunner(async () => { await structure.refresh() })
  const [v, setV] = useState({ type: 'combined' as SSettings['schoolType'], address: '', phone: '', email: '', ca: '40', exam: '60', position: false, days: [1, 2, 3, 4, 5] as number[] })
  const [bands, setBands] = useState<{ min: string; grade: string; remark: string }[]>([])
  const [wiz, setWiz] = useState({ type: 'combined' as SSettings['schoolType'], session: '', start: today() })
  useEffect(() => {
    if (!s) return
    const x = s.settings
    if (x) setV({ type: x.schoolType, address: x.address ?? '', phone: x.phone ?? '', email: x.email ?? '', ca: String(x.caMax), exam: String(x.examMax), position: x.showPosition, days: x.workingDays })
    setBands(s.bands.map((b) => ({ min: String(b.min), grade: b.grade, remark: b.remark ?? '' })))
  }, [s])
  if (!active) return null
  if (structure.loading && !s) return <Spinner />
  const manage = can('school.manage')
  const total = Number(v.ca) + Number(v.exam)
  const fresh = !!s && !s.classes.length

  return (
    <>
      <PageHeader title="School Settings" description="How this school works. Changing marks or grades does not change results that were already published." />
      {structure.error && <ErrorState message={structure.error} />}
      {runner.error && <ErrorState title="Not saved" message={runner.error} />}
      {runner.ok && <Notice>{runner.ok}</Notice>}

      {fresh && manage && (
        <Card className="mb-4">
          <h3 className="mb-1 text-sm font-semibold">Start from the standard structure</h3>
          <p className="mb-3 text-sm text-ink/70">Creates the classes for your kind of school, three terms, the usual subjects, a grading scale and 40/60 marks. You can change everything afterwards.</p>
          <div className="grid gap-3 sm:grid-cols-4"><SelectField label="Kind of school" value={wiz.type} onChange={(e) => setWiz({ ...wiz, type: e.target.value as SSettings['schoolType'] })}><option value="nursery">Nursery only</option><option value="primary">Primary only</option><option value="secondary">Secondary only</option><option value="combined">All: nursery, primary and secondary</option></SelectField>
            <TextField label="Session name" value={wiz.session} onChange={(e) => setWiz({ ...wiz, session: e.target.value })} placeholder="2026/2027" /><TextField label="First term starts" type="date" value={wiz.start} onChange={(e) => setWiz({ ...wiz, start: e.target.value })} />
            <div className="flex items-end"><Button loading={runner.busy} disabled={!wiz.session.trim()} onClick={() => void runner.run(async () => setupSchool(businessId, wiz.type, wiz.session.trim(), wiz.start), 'School structure created.')}>Create structure</Button></div></div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">School information</h3>
          <div className="space-y-3">
            <SelectField label="Kind of school" disabled={!manage} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as SSettings['schoolType'] })}><option value="nursery">Nursery only</option><option value="primary">Primary only</option><option value="secondary">Secondary only</option><option value="combined">All: nursery, primary and secondary</option></SelectField>
            <p className="-mt-1 text-xs text-ink/60">Only the classes and subjects of this kind of school are shown anywhere in the system. Changing it hides the other stages, and is refused while students are still in them.</p>
            <TextField label="Address" disabled={!manage} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Phone" disabled={!manage} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /><TextField label="Email" disabled={!manage} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><TextField label="Class work marks (maximum)" type="number" min={0} disabled={!manage} value={v.ca} onChange={(e) => setV({ ...v, ca: e.target.value })} /><TextField label="Exam marks (maximum)" type="number" min={0} disabled={!manage} value={v.exam} onChange={(e) => setV({ ...v, exam: e.target.value })} /></div>
            <p className={`text-xs ${total === 100 ? 'text-ink/60' : 'text-warning'}`}>Together these make {total}. Most schools use 100.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!manage} checked={v.position} onChange={(e) => setV({ ...v, position: e.target.checked })} /> Show the position in class on report cards</label>
            <div><p className="mb-1 text-sm font-medium">School days</p><div className="flex flex-wrap gap-2">{WEEKDAYS.map(([n, d]) => <label key={n} className="flex items-center gap-1 text-sm"><input type="checkbox" disabled={!manage} checked={v.days.includes(n)} onChange={(e) => setV({ ...v, days: e.target.checked ? [...v.days, n].sort() : v.days.filter((x) => x !== n) })} /> {d}</label>)}</div></div>
            {manage && <Button loading={runner.busy} onClick={() => void runner.run(async () => saveSettings(businessId, { schoolType: v.type, address: v.address, phone: v.phone, email: v.email, caMax: Number(v.ca), examMax: Number(v.exam), showPosition: v.position, workingDays: v.days }), 'Settings saved.')}>Save settings</Button>}
          </div>
        </Card>

        <Card>
          <h3 className="mb-1 text-sm font-semibold">Grading scale</h3>
          <p className="mb-3 text-xs text-ink/60">A score gets the grade of the highest line it reaches. Keep a line that starts at 0.</p>
          <table className="w-full text-sm"><thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">From</th><th className="py-1">Grade</th><th className="py-1">Meaning</th><th /></tr></thead>
            <tbody>{bands.map((b, i) => <tr key={i}><td className="py-1 pr-2"><input aria-label="From score" type="number" disabled={!manage} value={b.min} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} className="tabular w-20 rounded-md border border-line px-2 py-1" /></td><td className="py-1 pr-2"><input aria-label="Grade" disabled={!manage} value={b.grade} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))} className="w-16 rounded-md border border-line px-2 py-1" /></td><td className="py-1 pr-2"><input aria-label="Meaning" disabled={!manage} value={b.remark} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, remark: e.target.value } : x)))} className="w-full rounded-md border border-line px-2 py-1" /></td><td>{manage && <button type="button" aria-label="Remove line" className="px-2 text-ink/60 hover:text-danger" onClick={() => setBands(bands.filter((_, j) => j !== i))}>×</button>}</td></tr>)}</tbody></table>
          {manage && <div className="mt-3 flex gap-2"><Button variant="secondary" onClick={() => setBands([...bands, { min: '', grade: '', remark: '' }])}>Add line</Button><Button loading={runner.busy} onClick={() => void runner.run(async () => saveGrades(businessId, bands.map<SBand>((b) => ({ min: Number(b.min), grade: b.grade.trim(), remark: b.remark.trim() || null }))), 'Grading scale saved.')}>Save grading scale</Button></div>}
        </Card>
      </div>
      {!manage && <p className="mt-3 text-sm text-ink/60">Only the principal and school managers can change these settings.</p>}
    </>
  )
}
