import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label } from '@/shared/utilities/format'
import { today } from '../components/farmUi'
import { listWorkerNames, listTasks, saveTask, setTaskStatus } from '../services/opsApi'
import { loadFarm } from '../services/farmApi'
import type { TaskDto, TaskStatus } from '../services/opsApi'
import { DeleteButton } from '@/shared/components/delete-button'

const TONE: Record<TaskStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { todo: 'neutral', in_progress: 'info', review: 'warning', done: 'success', cancelled: 'danger' }
const PRIORITY_TONE = { low: 'neutral', normal: 'info', high: 'danger' } as const
const OPEN: TaskStatus[] = ['todo', 'in_progress', 'review']

/** Work to be done on the farm. Staff move tasks along; work that needs review waits for a manager to approve it. */
export function FarmTasksPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const tasks = useAsync(() => listTasks(businessId), [businessId])
  const workers = useAsync(() => listWorkerNames(businessId), [businessId])
  const farm = useAsync(() => loadFarm(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [view, setView] = useState<'open' | 'done' | 'all'>('open')
  const [editing, setEditing] = useState<TaskDto | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!active) return null
  const manage = can('farm.manage'); const record = can('farm.record') || manage
  const name = (id: string | null) => workers.data?.find((w) => w.id === id)?.name
  const batch = (id: string | null) => farm.data?.batches.find((b) => b.id === id)?.code
  const list = (tasks.data ?? []).filter((t) => (view === 'all' ? true : view === 'open' ? OPEN.includes(t.status) : t.status === 'done' || t.status === 'cancelled'))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  async function move(t: TaskDto, to: TaskStatus) {
    setError(await setTaskStatus(businessId, t.id, to))
    await tasks.refresh()
  }
  const next = (t: TaskDto): TaskStatus => (t.requiresReview ? 'review' : 'done')

  return (
    <>
      <PageHeader title="Tasks" description="Work to be done on the farm. Staff start and finish tasks; tasks marked for review wait for a manager to approve them."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New task</Button> : undefined} />
      {(error || tasks.error) && <ErrorState message={(error ?? tasks.error)!} />}
      <div className="mb-3 max-w-xs"><SelectField label="Show" value={view} onChange={(e) => setView(e.target.value as typeof view)}><option value="open">Open tasks</option><option value="done">Finished</option><option value="all">All</option></SelectField></div>
      {tasks.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title={view === 'open' ? 'Nothing to do' : 'No tasks'} description={manage ? 'Create a task and assign it to a worker.' : 'A manager creates tasks.'} /></Card> : (
        <div className="space-y-2">
          {list.map((t) => {
            const overdue = OPEN.includes(t.status) && t.due !== null && t.due < today()
            return (
              <Card key={t.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{t.title} <Badge tone={TONE[t.status]}>{label(t.status)}</Badge> <Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge>{t.requiresReview && <> <Badge>Needs review</Badge></>}{overdue && <> <Badge tone="danger">Overdue</Badge></>}</p>
                    <p className="mt-0.5 text-xs text-ink/60">{[t.due ? `Due ${t.due}` : 'No due date', name(t.assigneeId) ? `For ${name(t.assigneeId)}` : null, batch(t.batchId) ? `Batch ${batch(t.batchId)}` : null].filter(Boolean).join(' · ')}</p>
                    {t.description && <p className="mt-1 text-sm text-ink/80">{t.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {record && t.status === 'todo' && <Button variant="secondary" onClick={() => void move(t, 'in_progress')}>Start</Button>}
                    {record && (t.status === 'todo' || t.status === 'in_progress') && <Button onClick={() => void move(t, next(t))}>{t.requiresReview ? 'Send for review' : 'Mark done'}</Button>}
                    {manage && t.status === 'review' && <><Button onClick={() => void move(t, 'done')}>Approve</Button><Button variant="secondary" onClick={() => void move(t, 'in_progress')}>Send back</Button></>}
                    {manage && OPEN.includes(t.status) && <Button variant="ghost" onClick={() => void move(t, 'cancelled')}>Cancel</Button>}
                    {manage && (t.status === 'done' || t.status === 'cancelled') && <Button variant="ghost" onClick={() => void move(t, 'todo')}>Reopen</Button>}
                    {manage && OPEN.includes(t.status) && <button type="button" aria-label={`Open ${t.title}`} onClick={() => setEditing(t)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button>}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {editing && <TaskDialog businessId={businessId} task={editing === 'new' ? null : editing} workers={(workers.data ?? []).filter((w) => w.active)} batches={(farm.data?.batches ?? []).filter((b) => b.status === 'active')} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await tasks.refresh() }} />}
    </>
  )
}

function TaskDialog({ businessId, task, workers, batches, onClose, onSaved }: { businessId: string; task: TaskDto | null; workers: { id: string; name: string }[]; batches: { id: string; code: string; species: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [problem, setProblem] = useState<string | undefined>()
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (s('title').length < 2) return setProblem('Enter a title (at least 2 characters).')
    setProblem(undefined)
    await runner.run((k) => saveTask(businessId, { id: task?.id ?? null, title: s('title'), description: s('description'), due: s('due') || null, priority: s('priority') as TaskDto['priority'], assigneeId: s('assignee') || null, batchId: s('batch') || null, requiresReview: f.get('review') === 'on' }, k), 'Task saved.')
  }
  return (
    <DetailPage title={task ? 'Edit task' : 'New task'} onClose={onClose} view={!!task} modal={!task} actions={task ? <DeleteButton businessId={businessId} kind="task" id={task.id} label={task.title} noun="task" onDeleted={onSaved} /> : undefined}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Task" name="title" defaultValue={task?.title} error={problem} autoFocus maxLength={200} />
        <TextField label="Details (optional)" name="description" defaultValue={task?.description ?? ''} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Assign to" name="assignee" defaultValue={task?.assigneeId ?? ''}><option value="">Nobody yet</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</SelectField>
          <SelectField label="Priority" name="priority" defaultValue={task?.priority ?? 'normal'}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></SelectField>
          <TextField label="Due date (optional)" name="due" type="date" defaultValue={task?.due ?? ''} />
          <SelectField label="Batch (optional)" name="batch" defaultValue={task?.batchId ?? ''}><option value="">None</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.species}</option>)}</SelectField>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="review" defaultChecked={task?.requiresReview} /> A manager must approve this work before it counts as done</label>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{task ? 'Save' : 'Create task'}</Button></div>
      </form>
    </DetailPage>
  )
}
