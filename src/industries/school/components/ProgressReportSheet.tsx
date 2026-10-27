import { printSheets } from '@/shared/print/printSheets'
import type { ProgressReport } from '../services/schoolApi'

const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const STATUS = {
  mastered: { label: 'Mastered', dot: 'bg-success', chip: 'bg-success-soft text-success ring-success/30' },
  practising: { label: 'Practising', dot: 'bg-amber', chip: 'bg-amber/20 text-ink ring-amber/50' },
  introduced: { label: 'Introduced', dot: 'bg-accent', chip: 'bg-accent-soft text-accent ring-accent/30' },
} as const
const AREA_COLORS = ['#2f9e44', '#e8590c', '#1c7ed6', '#d6336c', '#7048e8', '#0ca678', '#f08c00']

/**
 * The Montessori progress report, used in place of an exam report card: for each curriculum area it shows how many works are mastered, being practised and introduced,
 * which ones, and the guide's note; then attendance, the guide's overall comment, the next term, and signatures. There are no marks, grades or positions.
 */
export function ProgressReportSheet({ report, photo = null }: { report: ProgressReport; photo?: string | null }) {
  const a = report.attendance
  const rate = a.marked ? Math.round(((a.present + a.late) * 1000) / a.marked) / 10 : null
  return (
    <article className="report-sheet mx-auto max-w-[210mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Progress report for ${report.student.name}`}>
      <header className={`relative border-b-4 border-double border-ink/70 pb-3 text-center ${photo ? 'px-24' : ''}`}>
        {photo && <img src={photo} alt={`Photo of ${report.student.name}`} className="absolute right-0 top-0 h-24 w-20 rounded border border-ink/40 object-cover" />}
        <h1 className="text-2xl font-extrabold uppercase tracking-wide">{report.school?.name ?? 'School'}</h1>
        {(report.school?.address || report.school?.phone || report.school?.email) && <p className="mt-0.5 text-xs text-ink/70">{[report.school?.address, report.school?.phone, report.school?.email].filter(Boolean).join('  ·  ')}</p>}
        <p className="mt-2 inline-block rounded-full border border-ink/60 px-4 py-0.5 text-xs font-bold uppercase tracking-[0.2em]">Progress report</p>
        <p className="mt-1 text-sm font-semibold">{report.term}{report.session ? `  ·  ${report.session} session` : ''}</p>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {([['Name', report.student.name], ['Environment', report.student.class ?? '–'], ['Ages', report.student.age?.replace(/^Ages /, '') ?? '–'], ['Admission number', report.student.admissionNo],
          ['Attendance', a.marked ? `${a.present + a.late} of ${a.marked} days (${rate}%)` : 'Not recorded'], ['Date of birth', report.student.dob ? date(report.student.dob) : '–']] as const).map(([k, v]) => (
          <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>

      <div className="mt-4 space-y-3">
        {report.areas.map((area, i) => {
          const done = area.works.filter((w) => w.status === 'mastered').length; const prac = area.works.filter((w) => w.status === 'practising').length; const intro = area.works.filter((w) => w.status === 'introduced').length
          const total = area.works.length; const shown = area.works.filter((w) => w.status)
          const color = AREA_COLORS[i % AREA_COLORS.length]
          return (
            <section key={area.subject} className="break-inside-avoid rounded-lg border border-ink/30 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-extrabold uppercase tracking-wide" style={{ color }}>{area.subject}</h2><p className="text-[11px] text-ink/65"><b>{done}</b> mastered · <b>{prac}</b> practising · <b>{intro}</b> introduced · {Math.max(0, total - done - prac - intro)} to come</p></div>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden>{total > 0 && <><span style={{ width: `${(done / total) * 100}%`, background: '#2f9e44' }} /><span style={{ width: `${(prac / total) * 100}%`, background: '#fbb130' }} /><span style={{ width: `${(intro / total) * 100}%`, background: '#00b4d8' }} /></>}</div>
              {shown.length > 0 ? <ul className="mt-2 flex flex-wrap gap-1.5">{shown.map((w) => <li key={w.name} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS[w.status!].chip}`}>{w.name}<span className="ml-1 font-normal opacity-70">· {STATUS[w.status!].label}</span></li>)}</ul> : <p className="mt-2 text-[11.5px] text-ink/55">No works recorded yet this term.</p>}
              {area.note && <p className="mt-2 rounded bg-ink/[0.04] px-2.5 py-1.5 text-[12px] italic">{area.note}</p>}
            </section>
          )
        })}
        {report.areas.length === 0 && <p className="rounded border border-dashed border-ink/40 p-4 text-center text-ink/60">This environment has no curriculum areas yet.</p>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-ink/40 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-ink/55">Guide&apos;s overall comment</p><p className="mt-1 min-h-10">{report.remarks?.teacherRemark ?? ''}</p></div>
        <div className="rounded border border-ink/40 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-ink/55">Head&apos;s comment</p><p className="mt-1 min-h-10">{report.remarks?.principalRemark ?? ''}</p></div>
      </div>
      <div className="mt-3 grid gap-3 text-[12px] sm:grid-cols-3">
        <p><b>Days present:</b> {a.present}  ·  <b>Late:</b> {a.late}  ·  <b>Absent:</b> {a.absent}</p>
        <p><b>Next environment:</b> {report.remarks?.promotion ? upper(report.remarks.promotion) : '–'}</p>
        <p><b>Next term begins:</b> {report.nextTerm ? `${date(report.nextTerm.startsOn)} (${report.nextTerm.name})` : '–'}</p>
      </div>
      <p className="mt-4 text-[10.5px] text-ink/60">Key: <b className="text-success">Mastered</b> the child can do the work confidently and independently · <b>Practising</b> working on it, repeating it by choice · <b className="text-accent">Introduced</b> the guide has presented it. Montessori progress is observed, not marked: there are no exams, grades or positions.</p>
      <footer className="mt-8 grid grid-cols-2 gap-10 text-center text-[11px]"><div className="border-t border-ink/70 pt-1">Guide&apos;s signature</div><div className="border-t border-ink/70 pt-1">Head&apos;s signature and school stamp</div></footer>
    </article>
  )
}

export function printProgressReports(reports: ProgressReport[], photos: (string | null | undefined)[] = []) {
  if (reports.length) printSheets(reports.map((r, n) => <ProgressReportSheet key={n} report={r} photo={photos[n] ?? null} />))
}
