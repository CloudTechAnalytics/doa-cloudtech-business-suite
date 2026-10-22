import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label } from '@/shared/utilities/format'
import { today, useSchool } from '../components/schoolUi'
import { loadAnnouncements, publishAnnouncement } from '../services/schoolApi'
import type { SAnnouncement } from '../services/schoolApi'

const WHO: Record<SAnnouncement['audience'], string> = { everyone: 'Everyone', parents: 'Parents', teachers: 'Teachers', staff: 'All staff', class: 'One class' }

/** Notices for parents, teachers and staff. People only see the ones meant for them. */
export function SchoolAnnouncementsPage() {
  const ctx = useSchool()
  const { businessId, can, className, active } = ctx
  const list = useAsync(() => loadAnnouncements(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  if (!active) return null
  return (
    <>
      <PageHeader title="Announcements" description="Notices from the school. Parents only see notices meant for parents, or for their child's class."
        actions={can('school.manage') ? <Button onClick={() => setAdding(true)}><Megaphone className="size-4" aria-hidden /> New announcement</Button> : undefined} />
      {list.error && <ErrorState message={list.error} />}
      {list.loading ? <Spinner /> : !list.data?.length ? <Card><EmptyState title="No announcements" /></Card> : (
        <div className="space-y-3">{list.data.map((a) => <Card key={a.id}><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{a.title}</h3><span className="text-xs text-ink/60">{a.publishOn}</span></div><div className="my-1"><Badge>{a.audience === 'class' ? className(a.classId) : WHO[a.audience]}</Badge></div><p className="whitespace-pre-wrap text-sm">{a.body}</p></Card>)}</div>
      )}
      {adding && <Compose ctx={ctx} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await list.refresh() }} />}
    </>
  )
}

function Compose({ ctx, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved); const [aud, setAud] = useState<SAnnouncement['audience']>('everyone')
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await runner.run(async () => publishAnnouncement(ctx.businessId, { title: String(f.get('title')).trim(), body: String(f.get('body')).trim(), audience: aud, classId: aud === 'class' ? String(f.get('class')) || null : null, publishOn: String(f.get('date')) || today() }), 'Published.') }
  return (
    <Dialog title="New announcement" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextField label="Title" name="title" autoFocus />
        <label className="block text-sm font-medium">Message<textarea name="body" rows={5} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
        <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Who is it for?" value={aud} onChange={(e) => setAud(e.target.value as SAnnouncement['audience'])}>{(Object.keys(WHO) as SAnnouncement['audience'][]).map((x) => <option key={x} value={x}>{label(WHO[x])}</option>)}</SelectField>
          {aud === 'class' ? <SelectField label="Class" name="class"><option value="">Select…</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField> : <div />}
          <TextField label="Show from" name="date" type="date" defaultValue={today()} /></div>
        {runner.error && <ErrorState title="Not published" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Publish</Button></div>
      </form>
    </Dialog>
  )
}
