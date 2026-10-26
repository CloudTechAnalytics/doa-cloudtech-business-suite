import { Camera, FileText, IdCard as IdCardIcon, Printer, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ErrorState, Notice, SelectField, TextField } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { useAsync } from '@/shared/hooks/useAsync'
import { fileToDataUrl, openDataUrl, resizeImage } from '@/shared/utilities/files'
import { label } from '@/shared/utilities/format'
import { fullName, today } from './schoolUi'
import type { SchoolCtx } from './schoolUi'
import { IdCardBack, IdCardFront, printAdmissionLetter, printCertificate, printIdCards, printTranscript } from './StudentSheets'
import type { SchoolHead } from './StudentSheets'
import { DOCUMENT_KINDS, addDocument, annualCard, deleteDocument, loadBills, loadDocumentData, loadDocuments, loadGuardians, loadPhotos, setPhoto } from '../services/schoolApi'
import type { DocumentKind, SStudent } from '../services/schoolApi'

/** The school's own details as printed at the top of every document. */
export const schoolHead = (ctx: SchoolCtx): SchoolHead => ({ name: ctx.active?.name ?? 'School', address: ctx.s?.settings?.address ?? null, phone: ctx.s?.settings?.phone ?? null, email: ctx.s?.settings?.email ?? null })

/** Everything an ID card prints for one student (the photo is fetched separately, because photos are kept out of the student lists). */
export const idCardData = (ctx: SchoolCtx, st: SStudent, photo: string | null) => ({
  school: schoolHead(ctx), name: fullName(st), admissionNo: st.admissionNo, className: ctx.className(st.classId) === '–' ? null : ctx.className(st.classId), gender: st.gender,
  session: ctx.s?.sessions.find((x) => x.current)?.name ?? null, photo, emergency: [st.emergencyName, st.emergencyPhone].filter(Boolean).join(' · ') || null,
})

/** A student's photo, their uploaded papers (birth certificate and so on), and the documents the school can print for them. */
export function StudentDocumentsTab({ ctx, student: st, onPhoto }: { ctx: SchoolCtx; student: SStudent; onPhoto?: () => void }) {
  const { businessId } = ctx
  const photo = useAsync(async () => (await loadPhotos(businessId, [st.id]))[st.id] ?? null, [businessId, st.id])
  const docs = useAsync(() => loadDocuments(businessId, st.id).catch(() => []), [businessId, st.id])
  const [kind, setKind] = useState<DocumentKind>('birth_certificate')
  const [busy, setBusy] = useState(''); const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null)
  const [cert, setCert] = useState({ title: ctx.kind === 'online' ? 'Certificate of Completion' : 'Certificate', programme: ctx.className(st.classId) === '–' ? '' : ctx.className(st.classId), on: today(), note: '' })
  const [certOpen, setCertOpen] = useState(false)

  async function guard(name: string, work: () => Promise<string | null | void>, success?: string) {
    setBusy(name); setError(null); setOk(null)
    try { const err = await work(); if (err) setError(err); else if (success) setOk(success) } catch (e) { setError((e as Error).message) }
    setBusy('')
  }
  const uploadPhoto = (f: File) => guard('photo', async () => {
    let data = await resizeImage(f, 300, 400, 0.82)
    if (data.length > 110000) data = await resizeImage(f, 240, 320, 0.6)
    const err = await setPhoto(businessId, st.id, data)
    if (!err) { await photo.refresh(); onPhoto?.() }
    return err
  }, 'Photo saved.')
  const uploadDoc = (f: File) => guard('doc', async () => {
    if (f.size > 12 * 1024 * 1024) return 'That file is too large. Use one under 1.5 MB (a photo of the page is fine: it is shrunk for you).'
    const isImage = f.type.startsWith('image/'); const isPdf = f.type === 'application/pdf'
    if (!isImage && !isPdf) return 'Upload a PDF or a picture (JPEG, PNG or WebP).'
    const mime = isImage ? 'image/jpeg' : 'application/pdf'
    const data = isImage ? await resizeImage(f, 1600, 1600, 0.8) : await fileToDataUrl(f)
    if (data.length > 2_000_000) return 'That file is too large. The limit is about 1.5 MB; a smaller scan or a photo of the page works.'
    const err = await addDocument(businessId, st.id, kind, f.name.replace(/\.[^.]+$/, '') + (isImage ? '.jpg' : '.pdf'), mime, data)
    if (!err) await docs.refresh()
    return err
  }, 'Document saved.')

  const print = {
    id: () => guard('id', async () => { printIdCards([idCardData(ctx, st, photo.data ?? null)]) }),
    letter: () => guard('letter', async () => {
      const [g, bills] = await Promise.all([loadGuardians(businessId).catch(() => null), loadBills(businessId).catch(() => [])])
      const mine = bills.filter((b) => b.studentId === st.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      const link = g?.links.find((l) => l.studentId === st.id && l.isPrimary) ?? g?.links.find((l) => l.studentId === st.id)
      printAdmissionLetter({ school: schoolHead(ctx), studentName: fullName(st), admissionNo: st.admissionNo, className: ctx.className(st.classId) === '–' ? null : ctx.className(st.classId), admittedOn: st.admittedOn,
        session: ctx.s?.sessions.find((x) => x.current)?.name ?? null, guardianName: g?.guardians.find((x) => x.id === link?.guardianId)?.name ?? null, fees: mine?.items ?? [], term: mine ? ctx.termName(mine.termId) : null })
    }),
    transcript: () => guard('transcript', async () => {
      const sessions = [...(ctx.s?.sessions ?? [])].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
      const cards = (await Promise.all(sessions.map((x) => annualCard(businessId, st.id, x.id).catch(() => null)))).filter((c): c is NonNullable<typeof c> => !!c && c.subjects.length > 0)
      printTranscript({ school: schoolHead(ctx), name: fullName(st), admissionNo: st.admissionNo, gender: st.gender, dob: st.dob, admittedOn: st.admittedOn, status: st.status, className: ctx.className(st.classId) === '–' ? null : ctx.className(st.classId), sessions: cards, photo: photo.data ?? null, bands: cards[0]?.bands ?? [] })
    }),
    certificate: () => { printCertificate({ school: schoolHead(ctx), name: fullName(st), title: cert.title.trim() || 'Certificate', programme: cert.programme.trim() || 'the programme', awardedOn: cert.on, note: cert.note.trim() }); setCertOpen(false) },
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-4">
        <div className="h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">{photo.data ? <img src={photo.data} alt={`Photo of ${fullName(st)}`} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-center text-xs text-ink/50"><Camera className="mx-auto mb-1 size-6" aria-hidden />No photo</div>}</div>
        <div className="space-y-2 text-sm">
          <p className="font-semibold">Passport photo</p>
          <p className="max-w-xs text-xs text-ink/60">Shown on the ID card, report card, annual report and transcript. Any picture is shrunk to a small passport size for you.</p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold hover:bg-surface"><Upload className="size-4" aria-hidden /> {busy === 'photo' ? 'Saving…' : photo.data ? 'Change photo' : 'Upload photo'}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = '' }} /></label>
            {photo.data && <Button variant="secondary" loading={busy === 'removephoto'} onClick={() => void guard('removephoto', async () => { const err = await setPhoto(businessId, st.id, null); if (!err) { await photo.refresh(); onPhoto?.() } return err }, 'Photo removed.')}><Trash2 className="size-4" aria-hidden /> Remove</Button>}
          </div>
        </div>
      </section>

      {error && <ErrorState title="Not done" message={error} />}
      {ok && <Notice>{ok}</Notice>}

      <section className="no-print">
        <h3 className="mb-2 text-sm font-semibold">ID card</h3>
        <div className="flex flex-wrap gap-4 overflow-x-auto pb-1"><IdCardFront d={idCardData(ctx, st, photo.data ?? null)} /><IdCardBack d={idCardData(ctx, st, photo.data ?? null)} /></div>
        <p className="mt-1 text-xs text-ink/60">Front and back as they print (credit-card size). The QR code carries the admission number.</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Documents on file</h3>
        <p className="mb-2 text-xs text-ink/60">Birth certificate, previous school results, medical record and the like. Only people who manage students can see these. Each file is up to about 1.5 MB; up to 15 per student.</p>
        {docs.data?.length ? (
          <ul className="divide-y divide-ink/10 rounded-md border border-line text-sm">{docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5"><span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-ink/50" aria-hidden /><span className="truncate font-medium">{d.name}</span><Badge>{DOCUMENT_KINDS.find((k) => k[0] === d.kind)?.[1] ?? label(d.kind)}</Badge><span className="text-xs text-ink/50">{Math.max(1, Math.round(d.size / 1024))} KB · {d.createdAt.slice(0, 10)}</span></span>
              <span className="flex items-center gap-2"><Button variant="secondary" onClick={() => void guard('open' + d.id, async () => { const data = await loadDocumentData(businessId, d.id); if (!data) return 'That file could not be opened.'; openDataUrl(data) })}>Open</Button>
                <ConfirmDelete compact label={d.name} noun="document" warning="The file is erased. This is kept in the audit trail." onConfirm={async () => deleteDocument(businessId, d.id)} onDeleted={async () => { await docs.refresh() }} /></span></li>
          ))}</ul>
        ) : <p className="text-sm text-ink/60">Nothing uploaded yet.</p>}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-52"><SelectField label="Kind of document" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>{DOCUMENT_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</SelectField></div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-amber px-3.5 text-sm font-bold text-ink hover:bg-amber-dark"><Upload className="size-4" aria-hidden /> {busy === 'doc' ? 'Saving…' : 'Upload a file'}
            <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDoc(f); e.target.value = '' }} /></label>
        </div>
      </section>

      <section className="no-print">
        <h3 className="mb-2 text-sm font-semibold">Print for this student</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === 'id'} onClick={() => void print.id()}><IdCardIcon className="size-4" aria-hidden /> ID card</Button>
          <Button variant="secondary" loading={busy === 'letter'} onClick={() => void print.letter()}><Printer className="size-4" aria-hidden /> Admission letter</Button>
          <Button variant="secondary" loading={busy === 'transcript'} onClick={() => void print.transcript()}><Printer className="size-4" aria-hidden /> Transcript</Button>
          <Button variant="secondary" onClick={() => setCertOpen(!certOpen)}><Printer className="size-4" aria-hidden /> Certificate</Button>
        </div>
        {certOpen && (
          <div className="mt-3 grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2">
            <TextField label="Title" value={cert.title} onChange={(e) => setCert({ ...cert, title: e.target.value })} placeholder="Certificate of Completion" />
            <TextField label={ctx.kind === 'online' ? 'Course completed' : 'Programme or class completed'} value={cert.programme} onChange={(e) => setCert({ ...cert, programme: e.target.value })} />
            <TextField label="Date awarded" type="date" value={cert.on} onChange={(e) => setCert({ ...cert, on: e.target.value })} />
            <TextField label="Extra line (optional)" value={cert.note} onChange={(e) => setCert({ ...cert, note: e.target.value })} placeholder="With distinction" />
            <div className="sm:col-span-2"><Button onClick={print.certificate} disabled={!cert.programme.trim()}><Printer className="size-4" aria-hidden /> Print certificate</Button></div>
          </div>
        )}
      </section>
    </div>
  )
}
