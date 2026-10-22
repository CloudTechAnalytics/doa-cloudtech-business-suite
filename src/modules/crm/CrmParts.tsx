import { X } from 'lucide-react'
import { Button, SelectField, TextField } from '@/shared/components'

export function Tags({ tags, canEdit, onAdd, onRemove }: { tags: { id: string; name: string }[]; canEdit: boolean; onAdd: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand-ink">{t.name}
          {canEdit && <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => void onRemove(t.id)}><X className="size-3" /></button>}</span>
      ))}
      {canEdit && (
        <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const v = String(new FormData(f).get('tag') ?? ''); if (v.trim()) { await onAdd(v); f.reset() } }}>
          <input name="tag" aria-label="New tag" placeholder="Add tag" className="w-28 rounded border border-ink/20 px-2 py-0.5 text-xs" />
        </form>
      )}
    </div>
  )
}

export function ActivityForms({ onNote, onTask }: { onNote: (kind: string, summary: string) => Promise<string | null>; onTask: (title: string, due: string | null) => Promise<string | null> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <form className="space-y-2" noValidate onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); if (!(await onNote(String(d.get('kind')), String(d.get('summary'))))) f.reset() }}>
        <h3 className="text-sm font-semibold">Log an interaction</h3>
        <SelectField label="Type" name="kind"><option value="note">Note</option><option value="call">Call</option><option value="visit">Visit</option><option value="message">Message</option><option value="other">Other</option></SelectField>
        <TextField label="Summary" name="summary" />
        <Button type="submit" variant="secondary">Add</Button>
      </form>
      <form className="space-y-2" noValidate onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); const due = String(d.get('due') ?? ''); if (!(await onTask(String(d.get('title')), due ? new Date(due).toISOString() : null))) f.reset() }}>
        <h3 className="text-sm font-semibold">Schedule a follow-up</h3>
        <TextField label="What to do" name="title" />
        <TextField label="Due" name="due" type="datetime-local" />
        <Button type="submit" variant="secondary">Schedule</Button>
      </form>
    </div>
  )
}
