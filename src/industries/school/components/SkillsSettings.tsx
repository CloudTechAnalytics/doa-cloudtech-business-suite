import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, ErrorState, Notice, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { loadTemplates, loadTraits, saveTemplates, saveTraits } from '../services/schoolApi'
import type { STemplate, STrait } from '../services/schoolApi'

type Item = { domain: STrait['domain']; name: string }
type Comment = { kind: STemplate['kind']; text: string }

/** The skills that are rated on every report card (behaviour and practical skills) and the ready-made comments teachers and the principal can pick from. */
export function SkillsSettings({ businessId, manage }: { businessId: string; manage: boolean }) {
  const traits = useAsync(() => loadTraits(businessId), [businessId])
  const templates = useAsync(() => loadTemplates(businessId), [businessId])
  const [items, setItems] = useState<Item[]>([]); const [comments, setComments] = useState<Comment[]>([])
  useEffect(() => { if (traits.data) setItems(traits.data.map((x) => ({ domain: x.domain, name: x.name }))) }, [traits.data])
  useEffect(() => { if (templates.data) setComments(templates.data.map((x) => ({ kind: x.kind, text: x.text }))) }, [templates.data])
  const skillsRun = useFormRunner(async () => { await traits.refresh() })
  const commentRun = useFormRunner(async () => { await templates.refresh() })
  if (traits.loading || templates.loading) return <Spinner />

  const column = (domain: Item['domain'], title: string) => (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/55">{title}</h4>
      <ul className="space-y-1.5">{items.map((x, i) => x.domain === domain && (
        <li key={i} className="flex items-center gap-2"><input aria-label={`${title} skill`} disabled={!manage} value={x.name} maxLength={60} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm" />
          {manage && <button type="button" aria-label={`Remove ${x.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-md text-ink/50 hover:bg-surface"><X className="size-4" aria-hidden /></button>}</li>))}</ul>
      {manage && <Button variant="secondary" className="mt-2" onClick={() => setItems([...items, { domain, name: '' }])}><Plus className="size-4" aria-hidden /> Add</Button>}
    </div>
  )
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-1 text-sm font-semibold">Report card skills</h3>
        <p className="mb-3 text-xs text-ink/60">Rated 1 to 5 for each student every term, and printed on the report card. Removing a skill also removes the ratings already given for it.</p>
        <div className="grid gap-4 sm:grid-cols-2">{column('affective', 'Affective (behaviour)')}{column('psychomotor', 'Psychomotor (practical)')}</div>
        {skillsRun.error && <div className="mt-3"><ErrorState title="Not saved" message={skillsRun.error} /></div>}{skillsRun.ok && <div className="mt-3"><Notice>{skillsRun.ok}</Notice></div>}
        {manage && <div className="mt-3"><Button loading={skillsRun.busy} onClick={() => void skillsRun.run(async () => saveTraits(businessId, items.filter((x) => x.name.trim()).map((x) => ({ domain: x.domain, name: x.name.trim() }))), 'Skills saved.')}>Save skills</Button></div>}
      </Card>
      <Card>
        <h3 className="mb-1 text-sm font-semibold">Ready-made comments</h3>
        <p className="mb-3 text-xs text-ink/60">Teachers and the principal pick from these when writing remarks on a report card, and can still edit the text.</p>
        <ul className="space-y-1.5">{comments.map((x, i) => (
          <li key={i} className="flex items-center gap-2"><select aria-label="Who writes it" disabled={!manage} value={x.kind} onChange={(e) => setComments(comments.map((y, j) => (j === i ? { ...y, kind: e.target.value as Comment['kind'] } : y)))} className="rounded-md border border-line px-1.5 py-1 text-xs"><option value="teacher">Teacher</option><option value="principal">Principal</option></select>
            <input aria-label="Comment" disabled={!manage} value={x.text} maxLength={300} onChange={(e) => setComments(comments.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm" />
            {manage && <button type="button" aria-label="Remove this comment" onClick={() => setComments(comments.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-md text-ink/50 hover:bg-surface"><X className="size-4" aria-hidden /></button>}</li>))}</ul>
        {commentRun.error && <div className="mt-3"><ErrorState title="Not saved" message={commentRun.error} /></div>}{commentRun.ok && <div className="mt-3"><Notice>{commentRun.ok}</Notice></div>}
        {manage && <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setComments([...comments, { kind: 'teacher', text: '' }])}><Plus className="size-4" aria-hidden /> Add comment</Button><Button loading={commentRun.busy} onClick={() => void commentRun.run(async () => saveTemplates(businessId, comments.filter((x) => x.text.trim()).map((x) => ({ kind: x.kind, text: x.text.trim() }))), 'Comments saved.')}>Save comments</Button></div>}
      </Card>
    </div>
  )
}
