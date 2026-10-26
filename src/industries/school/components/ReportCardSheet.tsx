import { createRoot } from 'react-dom/client'
import type { ReportCard } from '../services/schoolApi'

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : String(n))
const date = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * The report card as the school sends it home: school heading, the pupil's details, every subject with class work, exam, total, grade and how the class did,
 * the average and position, attendance, remarks, the grading key and places to sign. It is designed for A4 paper and looks the same on screen and in print.
 */
export function ReportCardSheet({ card }: { card: ReportCard }) {
  const a = card.attendance
  const scoreMax = (card.school?.caMax ?? 40) + (card.school?.examMax ?? 60)
  const gradeOfAverage = card.average === null ? null : (card.bands ?? []).find((b) => card.average! >= b.min)?.grade ?? null
  const hasStats = card.subjects.some((s) => s.classAvg !== null && s.classAvg !== undefined)
  const unpublished = card.subjects.some((s) => s.status !== 'published')
  const total = card.subjects.reduce((x, s) => x + s.total, 0)
  const rate = a.marked ? Math.round(((a.present + a.late) * 1000) / a.marked) / 10 : null
  const facts: [string, string][] = [
    ['Name', card.student.name], ['Admission number', card.student.admissionNo], ['Class', card.student.class ?? '–'],
    ...(card.student.gender ? [['Gender', card.student.gender === 'female' ? 'Female' : 'Male'] as [string, string]] : []),
    ...(card.position ? [['Position in class', `${card.position} of ${card.classSize}`] as [string, string]] : []),
    ['Attendance', a.marked ? `${a.present + a.late} of ${a.marked} days (${rate}%)` : 'Not recorded'],
  ]
  return (
    <article className="report-sheet mx-auto max-w-[210mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8" aria-label={`Report card for ${card.student.name}`}>
      <header className="border-b-4 border-double border-ink/70 pb-3 text-center">
        <h1 className="text-2xl font-extrabold uppercase tracking-wide">{card.school?.name ?? 'School'}</h1>
        {(card.school?.address || card.school?.phone || card.school?.email) && <p className="mt-0.5 text-xs text-ink/70">{[card.school?.address, card.school?.phone, card.school?.email].filter(Boolean).join('  ·  ')}</p>}
        <p className="mt-2 inline-block rounded-full border border-ink/60 px-4 py-0.5 text-xs font-bold uppercase tracking-[0.2em]">Report card</p>
        <p className="mt-1 text-sm font-semibold">{card.term}{card.session ? `  ·  ${card.session} session` : ''}</p>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {facts.map(([k, v]) => <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>

      {unpublished && <p className="mt-3 rounded border border-dashed border-warning px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-warning">Draft: some results have not been published yet</p>}

      <table className="mt-4 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-ink text-left text-[10.5px] uppercase tracking-wide text-white">
            <th className="border border-ink px-2 py-1.5">Subject</th><th className="border border-ink px-2 py-1.5 text-right">Class work<br /><span className="font-normal normal-case opacity-80">/{card.school?.caMax ?? 40}</span></th>
            <th className="border border-ink px-2 py-1.5 text-right">Exam<br /><span className="font-normal normal-case opacity-80">/{card.school?.examMax ?? 60}</span></th><th className="border border-ink px-2 py-1.5 text-right">Total<br /><span className="font-normal normal-case opacity-80">/{scoreMax}</span></th>
            <th className="border border-ink px-2 py-1.5 text-center">Grade</th>{hasStats && <><th className="border border-ink px-2 py-1.5 text-right">Class avg</th><th className="border border-ink px-2 py-1.5 text-right">Highest</th><th className="border border-ink px-2 py-1.5 text-right">Lowest</th></>}<th className="border border-ink px-2 py-1.5">Remark</th>
          </tr>
        </thead>
        <tbody>
          {card.subjects.map((s, i) => (
            <tr key={s.subject} className={i % 2 ? 'bg-ink/[0.04]' : ''}>
              <td className="border border-ink/40 px-2 py-1 font-medium">{s.subject}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(s.ca)}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(s.exam)}</td>
              <td className="tabular border border-ink/40 px-2 py-1 text-right font-bold">{s.total}</td><td className="border border-ink/40 px-2 py-1 text-center font-extrabold">{s.grade ?? '–'}</td>
              {hasStats && <><td className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(s.classAvg)}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(s.highest)}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(s.lowest)}</td></>}
              <td className="border border-ink/40 px-2 py-1 text-[12px]">{s.remark ?? ''}</td>
            </tr>
          ))}
          {card.subjects.length > 0 && (
            <tr className="bg-canvas font-bold">
              <td className="border border-ink/40 px-2 py-1.5" colSpan={3}>Total marks</td><td className="tabular border border-ink/40 px-2 py-1.5 text-right">{Math.round(total * 100) / 100}</td>
              <td className="border border-ink/40 px-2 py-1.5 text-center">{gradeOfAverage ?? ''}</td><td className="border border-ink/40 px-2 py-1.5" colSpan={hasStats ? 5 : 2}>Average: <span className="tabular">{fmt(card.average)}</span>{card.position ? <>  ·  Position {card.position} of {card.classSize}</> : null}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-ink/40 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-ink/55">Class teacher&apos;s remark</p><p className="mt-1 min-h-10">{card.remarks?.teacherRemark ?? ''}</p></div>
        <div className="rounded border border-ink/40 p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-ink/55">Principal&apos;s remark</p><p className="mt-1 min-h-10">{card.remarks?.principalRemark ?? ''}</p></div>
      </div>
      <div className="mt-3 grid gap-3 text-[12px] sm:grid-cols-3">
        <p><b>Days present:</b> {a.present}  ·  <b>Late:</b> {a.late}  ·  <b>Absent:</b> {a.absent}  ·  <b>Excused:</b> {a.excused}</p>
        <p><b>Decision:</b> {card.remarks?.promotion ? card.remarks.promotion.charAt(0).toUpperCase() + card.remarks.promotion.slice(1) : '–'}</p>
        <p><b>Next term begins:</b> {card.nextTerm ? `${date(card.nextTerm.startsOn)} (${card.nextTerm.name})` : '–'}</p>
      </div>

      {(card.bands?.length ?? 0) > 0 && (
        <div className="mt-4 text-[11px]"><p className="mb-1 font-bold uppercase tracking-wide text-ink/55">Grading key</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">{card.bands!.map((b, i) => <li key={b.grade}><b>{b.grade}</b> {i === 0 ? `${b.min}+` : `${b.min}-${card.bands![i - 1].min - 1}`}{b.remark ? ` ${b.remark}` : ''}</li>)}</ul></div>
      )}

      <footer className="mt-8 grid grid-cols-2 gap-10 text-center text-[11px]">
        <div><div className="border-t border-ink/70 pt-1">Class teacher&apos;s signature</div></div>
        <div><div className="border-t border-ink/70 pt-1">Principal&apos;s signature and school stamp</div></div>
      </footer>
    </article>
  )
}

/**
 * Prints one or more report cards, one per A4 page, without anything else from the screen. The cards are drawn into a temporary area that only exists while
 * printing (the rest of the page is hidden by the print styles), then removed.
 */
export function printReportCards(cards: ReportCard[]) {
  if (!cards.length) return
  const host = document.createElement('div')
  host.id = 'print-root'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<>{cards.map((c, i) => <ReportCardSheet key={i} card={c} />)}</>)
  const cleanup = () => { window.removeEventListener('afterprint', cleanup); root.unmount(); host.remove() }
  window.addEventListener('afterprint', cleanup)
  // Let React draw the cards before the print dialog opens.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
}
