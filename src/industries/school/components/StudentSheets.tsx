import { printSheets } from '@/shared/print/printSheets'
import { naira } from '@/shared/utilities/format'
import type { AnnualCard } from '../services/schoolApi'

export interface SchoolHead { name: string; address: string | null; phone: string | null; email: string | null }

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '–' : String(v))
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Heading({ school, title, subtitle }: { school: SchoolHead; title: string; subtitle?: string }) {
  return (
    <header className="border-b-4 border-double border-ink/70 pb-3 text-center">
      <h1 className="text-2xl font-extrabold uppercase tracking-wide">{school.name}</h1>
      {(school.address || school.phone || school.email) && <p className="mt-0.5 text-xs text-ink/70">{[school.address, school.phone, school.email].filter(Boolean).join('  ·  ')}</p>}
      <p className="mt-2 inline-block rounded-full border border-ink/60 px-4 py-0.5 text-xs font-bold uppercase tracking-[0.2em]">{title}</p>
      {subtitle && <p className="mt-1 text-sm font-semibold">{subtitle}</p>}
    </header>
  )
}
const Signatures = ({ left, right }: { left: string; right: string }) => (
  <footer className="mt-10 grid grid-cols-2 gap-10 text-center text-[11px]"><div className="border-t border-ink/70 pt-1">{left}</div><div className="border-t border-ink/70 pt-1">{right}</div></footer>
)
const sheetClass = 'doc-sheet mx-auto max-w-[210mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card sm:p-8'

// ---------------------------------------------------------------------------------------------------------------- annual card
/** The cumulative card for a session: each subject across the terms, the annual average and grade, the position, the decision, the grading key and signatures. */
export function AnnualCardSheet({ card, photo = null }: { card: AnnualCard; photo?: string | null }) {
  const gradeOfAverage = card.average === null ? null : (card.bands ?? []).find((b) => card.average! >= b.min)?.grade ?? null
  const facts: [string, string][] = [['Name', card.student.name], ['Admission number', card.student.admissionNo], ['Class', card.student.class ?? '–'], ...(card.position ? [['Position in class', `${card.position} of ${card.classSize}`] as [string, string]] : [])]
  return (
    <article className={sheetClass} aria-label={`Annual report for ${card.student.name}`}>
      <div className="relative">
        <Heading school={card.school ?? { name: 'School', address: null, phone: null, email: null }} title="Annual report" subtitle={`${card.session} session`} />
        {photo && <img src={photo} alt={`Photo of ${card.student.name}`} className="absolute right-0 top-0 h-24 w-20 rounded border border-ink/40 object-cover" />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">{facts.map(([k, v]) => <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
      <table className="mt-4 w-full border-collapse text-[12.5px]">
        <thead><tr className="bg-ink text-left text-[10.5px] uppercase tracking-wide text-white"><th className="border border-ink px-2 py-1.5">Subject</th>{card.terms.map((t) => <th key={t.id} className="border border-ink px-2 py-1.5 text-right">{t.name}</th>)}<th className="border border-ink px-2 py-1.5 text-right">Average</th><th className="border border-ink px-2 py-1.5 text-center">Grade</th></tr></thead>
        <tbody>
          {card.subjects.map((s, i) => <tr key={s.subject} className={i % 2 ? 'bg-ink/[0.04]' : ''}><td className="border border-ink/40 px-2 py-1 font-medium">{s.subject}</td>{s.terms.map((v, n) => <td key={n} className="tabular border border-ink/40 px-2 py-1 text-right">{fmt(v)}</td>)}<td className="tabular border border-ink/40 px-2 py-1 text-right font-bold">{s.average}</td><td className="border border-ink/40 px-2 py-1 text-center font-extrabold">{s.grade ?? '–'}</td></tr>)}
          {card.subjects.length === 0 && <tr><td className="border border-ink/40 px-2 py-3 text-center text-ink/60" colSpan={card.terms.length + 3}>No published results for this session yet.</td></tr>}
          {card.subjects.length > 0 && <tr className="bg-canvas font-bold"><td className="border border-ink/40 px-2 py-1.5" colSpan={card.terms.length + 1}>Annual average</td><td className="tabular border border-ink/40 px-2 py-1.5 text-right">{fmt(card.average)}</td><td className="border border-ink/40 px-2 py-1.5 text-center">{gradeOfAverage ?? ''}</td></tr>}
        </tbody>
      </table>
      <p className="mt-3 text-[12px]"><b>Decision:</b> {card.promotion ? upper(card.promotion) : '–'}</p>
      {(card.bands?.length ?? 0) > 0 && <div className="mt-4 text-[11px]"><p className="mb-1 font-bold uppercase tracking-wide text-ink/55">Grading key</p><ul className="flex flex-wrap gap-x-4 gap-y-0.5">{card.bands!.map((b, i) => <li key={b.grade}><b>{b.grade}</b> {i === 0 ? `${b.min}+` : `${b.min}-${card.bands![i - 1].min - 1}`}{b.remark ? ` ${b.remark}` : ''}</li>)}</ul></div>}
      <Signatures left="Class teacher's signature" right="Principal's signature and school stamp" />
    </article>
  )
}
export function printAnnualCards(cards: AnnualCard[], photos: (string | null | undefined)[] = []) {
  if (cards.length) printSheets(cards.map((c, n) => <AnnualCardSheet key={n} card={c} photo={photos[n] ?? null} />))
}

// ---------------------------------------------------------------------------------------------------------------- ID card
export interface IdCardData { school: SchoolHead; name: string; admissionNo: string; className: string | null; gender: string | null; session: string | null; photo: string | null; emergency: string | null }
/** A student ID card (credit-card size). Printed ten to a page. */
export function IdCard({ d }: { d: IdCardData }) {
  return (
    <div className="id-card relative h-[54mm] w-[86mm] overflow-hidden rounded-lg border border-ink/40 bg-white text-ink shadow-card" aria-label={`ID card for ${d.name}`}>
      <div className="flex h-[12mm] items-center justify-center bg-ink px-2 text-center text-white"><p className="line-clamp-2 text-[10px] font-extrabold uppercase leading-tight tracking-wide">{d.school.name}</p></div>
      <div className="flex gap-3 p-2.5">
        <div className="h-[28mm] w-[22mm] shrink-0 overflow-hidden rounded border border-ink/40 bg-surface">{d.photo ? <img src={d.photo} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[8px] uppercase text-ink/40">Photo</div>}</div>
        <div className="min-w-0 flex-1 text-[10px] leading-snug">
          <p className="text-[13px] font-extrabold leading-tight">{d.name}</p>
          <p className="mt-1"><span className="text-ink/55">Admission no.</span> <b className="tabular">{d.admissionNo}</b></p>
          <p><span className="text-ink/55">Class</span> <b>{d.className ?? '–'}</b></p>
          {d.gender && <p><span className="text-ink/55">Gender</span> <b>{upper(d.gender)}</b></p>}
          {d.session && <p><span className="text-ink/55">Session</span> <b>{d.session}</b></p>}
          {d.emergency && <p className="mt-0.5"><span className="text-ink/55">Emergency</span> <b>{d.emergency}</b></p>}
        </div>
      </div>
      <p className="absolute inset-x-0 bottom-0 bg-ink/[0.06] px-2 py-0.5 text-center text-[7.5px] text-ink/70">If found, please return to the school{d.school.phone ? ` · ${d.school.phone}` : ''}</p>
    </div>
  )
}
export function printIdCards(items: IdCardData[]) {
  if (items.length) printSheets(<div className="id-grid">{items.map((d, n) => <IdCard key={n} d={d} />)}</div>)
}

// ---------------------------------------------------------------------------------------------------------------- admission letter
export interface AdmissionLetterData { school: SchoolHead; studentName: string; admissionNo: string; className: string | null; admittedOn: string; session: string | null; guardianName: string | null; fees: { name: string; amount: number }[]; term: string | null }
/** The letter that confirms a place: who, which class, from when, the admission number, and what the first bill is for. */
export function AdmissionLetterSheet({ d }: { d: AdmissionLetterData }) {
  const total = d.fees.reduce((a, f) => a + f.amount, 0)
  return (
    <article className={sheetClass} aria-label={`Admission letter for ${d.studentName}`}>
      <Heading school={d.school} title="Offer of admission" />
      <p className="mt-6 text-right">{longDate(d.admittedOn)}</p>
      <p className="mt-4">{d.guardianName ? <>Dear {d.guardianName},</> : 'Dear Parent or Guardian,'}</p>
      <p className="mt-4">We are pleased to confirm that <b>{d.studentName}</b> has been admitted to <b>{d.school.name}</b>{d.className ? <> into <b>{d.className}</b></> : null}{d.session ? <> for the <b>{d.session}</b> session</> : null}, with effect from {longDate(d.admittedOn)}.</p>
      <p className="mt-3">Admission number: <b className="tabular">{d.admissionNo}</b>. Please quote it whenever you contact the school or make a payment.</p>
      {d.fees.length > 0 && (<>
        <p className="mt-4 font-semibold">Fees{d.term ? ` for ${d.term}` : ''}</p>
        <table className="mt-1 w-full max-w-md border-collapse text-[12.5px]"><tbody>
          {d.fees.map((f) => <tr key={f.name}><td className="border border-ink/40 px-2 py-1">{f.name}</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(f.amount)}</td></tr>)}
          <tr className="font-bold"><td className="border border-ink/40 px-2 py-1">Total</td><td className="tabular border border-ink/40 px-2 py-1 text-right">{naira(total)}</td></tr>
        </tbody></table>
      </>)}
      <p className="mt-4">Please bring this letter, the student&apos;s birth certificate and any previous school records on the first day. We look forward to welcoming {d.studentName.split(' ')[0]} to our school community.</p>
      <p className="mt-6">Yours faithfully,</p>
      <Signatures left="Principal / Head of school" right="School stamp" />
    </article>
  )
}
export const printAdmissionLetter = (d: AdmissionLetterData) => printSheets(<AdmissionLetterSheet d={d} />)

// ---------------------------------------------------------------------------------------------------------------- transcript
export interface TranscriptData { school: SchoolHead; name: string; admissionNo: string; gender: string | null; dob: string | null; admittedOn: string; status: string; className: string | null; sessions: AnnualCard[]; photo: string | null; bands: AnnualCard['bands'] }
/** A student's whole academic record: every session's published results, subject by subject, with annual averages. */
export function TranscriptSheet({ d }: { d: TranscriptData }) {
  return (
    <article className={sheetClass} aria-label={`Transcript for ${d.name}`}>
      <div className="relative">
        <Heading school={d.school} title="Academic transcript" />
        {d.photo && <img src={d.photo} alt={`Photo of ${d.name}`} className="absolute right-0 top-0 h-24 w-20 rounded border border-ink/40 object-cover" />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {([['Name', d.name], ['Admission number', d.admissionNo], ['Gender', d.gender ? upper(d.gender) : '–'], ['Date of birth', d.dob ? longDate(d.dob) : '–'], ['Admitted', longDate(d.admittedOn)], ['Status', `${upper(d.status)}${d.className ? ` · ${d.className}` : ''}`]] as const).map(([k, v]) => <div key={k} className="border-b border-dotted border-ink/30 pb-0.5"><dt className="text-[10px] uppercase tracking-wide text-ink/55">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
      {d.sessions.length === 0 && <p className="mt-6 rounded border border-dashed border-ink/40 p-4 text-center text-ink/60">No published results are on record yet.</p>}
      {d.sessions.map((c) => (
        <section key={c.session} className="mt-5 break-inside-avoid">
          <h2 className="mb-1 flex items-baseline justify-between text-sm font-bold">{c.session} session{c.student.class ? <span className="text-xs font-normal text-ink/60"> {c.student.class}</span> : null}<span className="text-xs font-semibold">Average {fmt(c.average)}{c.position ? ` · position ${c.position} of ${c.classSize}` : ''}</span></h2>
          <table className="w-full border-collapse text-[12px]"><thead><tr className="bg-ink/10 text-left text-[10.5px] uppercase tracking-wide"><th className="border border-ink/40 px-2 py-1">Subject</th>{c.terms.map((t) => <th key={t.id} className="border border-ink/40 px-2 py-1 text-right">{t.name}</th>)}<th className="border border-ink/40 px-2 py-1 text-right">Average</th><th className="border border-ink/40 px-2 py-1 text-center">Grade</th></tr></thead>
            <tbody>{c.subjects.map((s) => <tr key={s.subject}><td className="border border-ink/40 px-2 py-0.5">{s.subject}</td>{s.terms.map((v, n) => <td key={n} className="tabular border border-ink/40 px-2 py-0.5 text-right">{fmt(v)}</td>)}<td className="tabular border border-ink/40 px-2 py-0.5 text-right font-bold">{s.average}</td><td className="border border-ink/40 px-2 py-0.5 text-center font-bold">{s.grade ?? '–'}</td></tr>)}</tbody></table>
        </section>
      ))}
      {(d.bands?.length ?? 0) > 0 && <div className="mt-4 text-[11px]"><p className="mb-1 font-bold uppercase tracking-wide text-ink/55">Grading key</p><ul className="flex flex-wrap gap-x-4 gap-y-0.5">{d.bands!.map((b, i) => <li key={b.grade}><b>{b.grade}</b> {i === 0 ? `${b.min}+` : `${b.min}-${d.bands![i - 1].min - 1}`}{b.remark ? ` ${b.remark}` : ''}</li>)}</ul></div>}
      <p className="mt-4 text-[11px] text-ink/60">Issued {longDate(new Date().toISOString())}. Only published results are shown.</p>
      <Signatures left="Registrar / Class teacher" right="Principal's signature and school stamp" />
    </article>
  )
}
export const printTranscript = (d: TranscriptData) => printSheets(<TranscriptSheet d={d} />)

// ---------------------------------------------------------------------------------------------------------------- certificate
export interface CertificateData { school: SchoolHead; name: string; title: string; programme: string; awardedOn: string; note: string }
/** A certificate (of completion, graduation, merit...) in a framed page. */
export function CertificateSheet({ d }: { d: CertificateData }) {
  return (
    <article className={`${sheetClass} !p-4 sm:!p-5`} aria-label={`${d.title} for ${d.name}`}>
      <div className="flex min-h-[255mm] flex-col items-center justify-center border-[6px] border-double border-ink/80 p-8 text-center">
        <p className="text-lg font-extrabold uppercase tracking-[0.25em]">{d.school.name}</p>
        {(d.school.address || d.school.phone) && <p className="mt-1 text-xs text-ink/60">{[d.school.address, d.school.phone].filter(Boolean).join('  ·  ')}</p>}
        <h2 className="mt-12 text-4xl font-extrabold uppercase tracking-wide">{d.title}</h2>
        <p className="mt-10 text-sm uppercase tracking-widest text-ink/60">This is to certify that</p>
        <p className="mt-3 border-b-2 border-ink/60 px-10 pb-1 text-4xl font-bold italic">{d.name}</p>
        <p className="mt-6 max-w-xl text-base">has successfully completed <b>{d.programme}</b> at {d.school.name}.</p>
        {d.note && <p className="mt-3 max-w-xl text-sm text-ink/80">{d.note}</p>}
        <p className="mt-8 text-sm">Awarded on {longDate(d.awardedOn)}</p>
        <div className="mt-20 grid w-full max-w-xl grid-cols-2 gap-16 text-center text-[11px]"><div className="border-t border-ink/70 pt-1">Principal / Director</div><div className="border-t border-ink/70 pt-1">School stamp</div></div>
      </div>
    </article>
  )
}
export const printCertificate = (d: CertificateData) => printSheets(<CertificateSheet d={d} />)
