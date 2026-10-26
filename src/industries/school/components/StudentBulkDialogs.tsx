import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorState, Notice, SelectField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { parseCsvObjects } from '@/shared/utilities/csv'
import { downloadCsv, fullName, today } from './schoolUi'
import type { SchoolCtx } from './schoolUi'
import { graduate, promote, registerStudent } from '../services/schoolApi'
import type { GuardianInput, SRemark, SStudent, StudentInput } from '../services/schoolApi'

const HEADERS = ['first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth', 'class', 'admitted_on', 'emergency_name', 'emergency_phone', 'guardian_name', 'guardian_phone', 'guardian_email', 'guardian_relationship']
const EXAMPLE = ['Ada', '', 'Obi', 'female', '2018-05-01', 'Primary 1', today(), 'Mrs Obi', '08031234567', 'Mrs Obi', '08031234567', 'obi@example.com', 'mother']

interface ParsedRow { line: number; label: string; input: StudentInput | null; guardian: GuardianInput | null; error: string | null }

/** Reads the rows of a student CSV: each row is checked on its own, so one bad row never blocks the good ones. */
export function parseStudentRows(text: string, classes: { id: string; name: string }[]): { rows: ParsedRow[]; missing: string[] } {
  const { headers, rows } = parseCsvObjects(text)
  const missing = ['first_name', 'last_name'].filter((h) => !headers.includes(h))
  const byName = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]))
  const out = rows.map((r, i): ParsedRow => {
    const line = i + 2; const first = r.first_name ?? ''; const last = r.last_name ?? ''
    const bad = (error: string): ParsedRow => ({ line, label: `${first} ${last}`.trim() || `Row ${line}`, input: null, guardian: null, error })
    if (!first || !last) return bad('first and last name are needed')
    const g = (r.gender ?? '').toLowerCase(); const gender = g === 'm' || g === 'male' ? 'male' : g === 'f' || g === 'female' ? 'female' : ''
    if (g && !gender) return bad('gender must be male or female')
    const dob = r.date_of_birth ?? ''
    if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || dob > today())) return bad('date of birth must look like 2018-05-01 and not be in the future')
    const cls = r.class ?? ''; const classId = cls ? byName.get(cls.toLowerCase()) ?? null : null
    if (cls && !classId) return bad(`there is no open class called "${cls}"`)
    const admitted = r.admitted_on || today()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(admitted)) return bad('admitted_on must look like 2026-09-14')
    const gName = r.guardian_name ?? ''; const gEmail = r.guardian_email ?? ''
    if ((r.guardian_phone || gEmail) && !gName) return bad('a parent\'s phone or email needs the parent\'s name')
    if (gEmail && !/^\S+@\S+\.\S+$/.test(gEmail)) return bad('the parent\'s email does not look right')
    return { line, label: `${first} ${last}`, error: null,
      input: { first, middle: r.middle_name ?? '', last, dob, gender, classId, admittedOn: admitted, emergencyName: r.emergency_name ?? '', emergencyPhone: r.emergency_phone ?? '', notes: '' },
      guardian: gName ? { name: gName, phone: r.guardian_phone ?? '', email: gEmail, relationship: r.guardian_relationship || 'parent', primary: true } : null }
  })
  return { rows: out, missing }
}

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16) }

/** Add many students at once from a spreadsheet saved as CSV. The same file imported twice does not register anyone twice. */
export function ImportStudentsDialog({ ctx, onClose, onDone }: { ctx: SchoolCtx; onClose: () => void; onDone: () => Promise<void> }) {
  const [text, setText] = useState(''); const [fileName, setFileName] = useState(''); const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0); const [result, setResult] = useState<{ made: number; failed: { label: string; line: number; error: string }[] } | null>(null)
  const parsed = text ? parseStudentRows(text, ctx.classes) : null
  const good = parsed?.rows.filter((r) => !r.error) ?? []
  const bad = parsed?.rows.filter((r) => r.error) ?? []
  async function run() {
    setBusy(true); setProgress(0)
    const tag = hash(text); const failed: { label: string; line: number; error: string }[] = []; let made = 0
    for (const [i, r] of good.entries()) {
      const err = await registerStudent(ctx.businessId, r.input!, r.guardian ? [r.guardian] : [], `imp-${tag}-${r.line}`)
      if (err) failed.push({ label: r.label, line: r.line, error: err }); else made += 1
      setProgress(i + 1)
    }
    setBusy(false); setResult({ made, failed }); await onDone()
  }
  return (
    <Dialog title="Import students from a spreadsheet" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {!result && (<>
          <p className="text-ink/70">Save your spreadsheet as <b>CSV</b>, with one student per row. The first row must name the columns. Only <b>first_name</b> and <b>last_name</b> are required; the class must be the exact name of an open class.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => downloadCsv('student-import-template', [HEADERS, EXAMPLE])}><Download className="size-4" aria-hidden /> Download the template</Button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-amber px-3.5 text-sm font-bold text-ink hover:bg-amber-dark"><Upload className="size-4" aria-hidden /> Choose a CSV file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setText(await f.text()) } e.target.value = '' }} /></label>
            {fileName && <span className="self-center text-xs text-ink/60">{fileName}</span>}
          </div>
          {parsed?.missing.length ? <ErrorState title="Columns missing" message={`The first row must include: ${parsed.missing.join(', ')}.`} /> : null}
          {parsed && !parsed.missing.length && (<>
            <Notice>{good.length} student{good.length === 1 ? '' : 's'} ready to import{bad.length ? `, ${bad.length} row${bad.length === 1 ? '' : 's'} with a problem (they will be skipped)` : ''}.</Notice>
            {bad.length > 0 && <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger">{bad.map((r) => <li key={r.line}>Row {r.line}, {r.label}: {r.error}</li>)}</ul>}
            {good.length > 0 && <div className="max-h-48 overflow-auto rounded-md border border-line"><table className="w-full text-xs"><thead className="bg-surface text-left"><tr><th className="p-2">Name</th><th className="p-2">Class</th><th className="p-2">Parent</th></tr></thead><tbody className="divide-y divide-ink/10">{good.slice(0, 50).map((r) => <tr key={r.line}><td className="p-2">{r.label}</td><td className="p-2">{ctx.classes.find((c) => c.id === r.input!.classId)?.name ?? '–'}</td><td className="p-2">{r.guardian?.name ?? '–'}</td></tr>)}</tbody></table>{good.length > 50 && <p className="p-2 text-xs text-ink/60">…and {good.length - 50} more.</p>}</div>}
          </>)}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!good.length || !!parsed?.missing.length} loading={busy} onClick={() => void run()}>{busy ? `Importing ${progress} of ${good.length}…` : `Import ${good.length || ''} student${good.length === 1 ? '' : 's'}`}</Button></div>
        </>)}
        {result && (<>
          <Notice>{result.made} student{result.made === 1 ? '' : 's'} registered{result.failed.length ? `, ${result.failed.length} not registered` : ''}.</Notice>
          {result.failed.length > 0 && <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger">{result.failed.map((f) => <li key={f.line}>Row {f.line}, {f.label}: {f.error}</li>)}</ul>}
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>)}
      </div>
    </Dialog>
  )
}

type Action = 'promote' | 'stay' | 'graduate'

/** The end of the year for one class: move up the ones who passed, keep the ones who repeat, graduate the ones who finish. The class teacher's and principal's decisions are filled in for you. */
export function EndOfYearDialog({ ctx, students, remarks, onClose, onDone }: { ctx: SchoolCtx; students: SStudent[]; remarks: SRemark[]; onClose: () => void; onDone: () => Promise<void> }) {
  const classes = [...ctx.classes].sort((a, b) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name))
  const [from, setFrom] = useState(classes[0]?.id ?? '')
  const idx = classes.findIndex((c) => c.id === from)
  const [to, setTo] = useState(classes[1]?.id ?? '')
  const [acts, setActs] = useState<Record<string, Action>>({})
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null)
  const terms = [...(ctx.s?.terms ?? [])].sort((a, b) => b.startsOn.localeCompare(a.startsOn))
  const roster = students.filter((x) => x.status === 'active' && x.classId === from)
  const decisionOf = (id: string): SRemark['promotion'] => { for (const t of terms) { const r = remarks.find((x) => x.studentId === id && x.termId === t.id && x.promotion); if (r) return r.promotion } return null }
  const actionOf = (id: string): Action => acts[id] ?? (decisionOf(id) === 'promoted' ? 'promote' : decisionOf(id) === 'graduate' ? 'graduate' : 'stay')
  const pick = (v: string) => { setFrom(v); setActs({}); const i = classes.findIndex((c) => c.id === v); setTo(classes[i + 1]?.id ?? '') }
  const counts = { promote: roster.filter((x) => actionOf(x.id) === 'promote').length, stay: roster.filter((x) => actionOf(x.id) === 'stay').length, graduate: roster.filter((x) => actionOf(x.id) === 'graduate').length }
  const session = ctx.s?.sessions.find((x) => x.current)?.name ?? ''
  async function apply() {
    setBusy(true); setError(null)
    const moves = roster.filter((x) => actionOf(x.id) === 'promote').map((x) => ({ studentId: x.id, classId: to }))
    const grads = roster.filter((x) => actionOf(x.id) === 'graduate').map((x) => x.id)
    const e1 = moves.length ? await promote(ctx.businessId, moves, `End of year${session ? ` ${session}` : ''}`) : null
    const e2 = !e1 && grads.length ? await graduate(ctx.businessId, grads, `Completed ${ctx.className(from)}`) : null
    setBusy(false)
    if (e1 || e2) return setError((e1 ?? e2)!)
    setDone(`${moves.length} moved up to ${ctx.className(to)}, ${grads.length} graduated, ${counts.stay} stay in ${ctx.className(from)}.`); await onDone()
  }
  return (
    <Dialog title="End of year: promote a class" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {done ? (<><Notice>{done}</Notice><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></>) : (<>
          <p className="text-ink/70">Choose a class. Each pupil is set from the decision on their report card (promoted, repeat or graduate); change any row before you apply.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Class finishing the year" value={from} onChange={(e) => pick(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
            <SelectField label="Move up to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a class…</option>{classes.filter((c) => c.id !== from).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          </div>
          {!roster.length ? <p className="text-ink/60">No active students in this class.</p> : (
            <div className="max-h-72 overflow-auto rounded-md border border-line"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs"><tr><th className="p-2">Student</th><th className="p-2">Decision</th><th className="p-2">Now</th></tr></thead>
              <tbody className="divide-y divide-ink/10">{roster.map((x) => <tr key={x.id}><td className="p-2">{fullName(x)}</td><td className="p-2 text-ink/60">{decisionOf(x.id) ?? 'not decided'}</td>
                <td className="p-2"><select aria-label={`What happens to ${fullName(x)}`} value={actionOf(x.id)} onChange={(e) => setActs((p) => ({ ...p, [x.id]: e.target.value as Action }))} className="rounded-md border border-line px-2 py-1 text-sm"><option value="promote">Move up</option><option value="stay">Stay in {ctx.className(from)}</option><option value="graduate">Graduate</option></select></td></tr>)}</tbody></table></div>
          )}
          {roster.length > 0 && <p className="text-xs text-ink/60">{counts.promote} move up{counts.promote && !to ? ' (choose the class above)' : ''}, {counts.stay} stay, {counts.graduate} graduate. {idx === classes.length - 1 ? 'This is the last class in the list.' : ''}</p>}
          {error && <ErrorState title="Not applied" message={error} />}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!roster.length || (counts.promote > 0 && !to) || (!counts.promote && !counts.graduate)} onClick={() => void apply()}>Apply</Button></div>
        </>)}
      </div>
    </Dialog>
  )
}
