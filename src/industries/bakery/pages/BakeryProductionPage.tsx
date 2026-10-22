import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira, qty } from '@/shared/utilities/format'
import { cancelProduction, completeProduction, listAssignees, loadBatches, loadIngredients, loadRecipes, loadRequirements, planProduction, reverseProduction, startProduction } from '../services/bakeryApi'
import type { BatchDto, RecipeRow } from '../services/bakeryApi'

const today = () => new Date().toISOString().slice(0, 10)
const TONE: Record<BatchDto['status'], 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { planned: 'neutral', in_progress: 'info', completed: 'success', cancelled: 'danger', reversed: 'warning' }

/** Plan what to bake, check the ingredients, record what was really used and made, and correct a finished batch with a reversal. */
export function BakeryProductionPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const data = useAsync(() => loadBatches(businessId), [businessId])
  const recipes = useAsync(() => loadRecipes(businessId), [businessId])
  const ingredients = useAsync(() => loadIngredients(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'bakery'), [businessId])
  const assignees = useAsync(() => listAssignees(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [planning, setPlanning] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'open' | 'completed' | 'all'>('open')
  if (!active) return null
  const record = can('bakery.record'); const manage = can('bakery.manage')
  const refresh = async () => { await Promise.all([data.refresh(), ingredients.refresh(), catalog.refresh()]) }
  const recipeName = (id: string) => recipes.data?.find((r) => r.id === id)
  const list = (data.data?.batches ?? []).filter((b) => (view === 'all' ? true : view === 'open' ? b.status === 'planned' || b.status === 'in_progress' : b.status === 'completed' || b.status === 'reversed' || b.status === 'cancelled'))
  const selected = data.data?.batches.find((b) => b.id === open) ?? null

  return (
    <>
      <PageHeader title="Production" description="Plan a batch, check you have the ingredients, then record what was really used and made. Completing a batch takes the ingredients out of stock and puts the bread in, together."
        actions={record ? <Button onClick={() => setPlanning(true)}><Plus className="size-4" aria-hidden /> Plan production</Button> : undefined} />
      {data.error && <ErrorState message={data.error} />}
      <div className="mb-3 max-w-xs"><SelectField label="Show" value={view} onChange={(e) => setView(e.target.value as typeof view)}><option value="open">Planned and in progress</option><option value="completed">Finished</option><option value="all">All</option></SelectField></div>
      {data.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title={view === 'open' ? 'Nothing planned' : 'No batches'} description={recipes.data?.length ? 'Plan a batch to start.' : 'Create a recipe first, then plan production.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Batch</th><th className="p-3">Recipe</th><th className="p-3">Date</th><th className="p-3 text-right">Planned</th><th className="p-3 text-right">Made</th><th className="p-3 text-right">Cost each</th><th className="p-3">Status</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((b) => (
                <tr key={b.id} className="cursor-pointer hover:bg-surface" onClick={() => setOpen(b.id)}>
                  <td className="p-3 font-medium">{b.number}</td><td className="p-3">{recipeName(b.recipeId)?.name ?? 'Recipe'}</td><td className="p-3">{b.date}</td>
                  <td className="tabular p-3 text-right">{qty(b.planned)}</td><td className="tabular p-3 text-right">{b.actual === null ? '–' : qty(b.actual)}</td>
                  <td className="tabular p-3 text-right">{b.unitCost === null ? '–' : naira(b.unitCost)}</td>
                  <td className="p-3"><Badge tone={TONE[b.status]}>{label(b.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {planning && <PlanDialog businessId={businessId} recipes={(recipes.data ?? []).filter((r) => r.status === 'active')} locations={catalog.data?.locations ?? []} people={assignees.data ?? []} onClose={() => setPlanning(false)} onSaved={async () => { setPlanning(false); await refresh() }} />}
      {selected && <BatchDialog businessId={businessId} batch={selected} recipe={recipeName(selected.recipeId)} usage={(data.data?.usage ?? []).filter((u) => u.batchId === selected.id)} ingredientName={(id) => ingredients.data?.find((i) => i.id === id)?.name ?? 'Ingredient'} unit={(id) => ingredients.data?.find((i) => i.id === id)?.unit ?? ''} record={record} manage={manage} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  )
}

function PlanDialog({ businessId, recipes, locations, people, onClose, onSaved }: { businessId: string; recipes: RecipeRow[]; locations: { id: string; name: string }[]; people: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [recipeId, setRecipeId] = useState('')
  const [planned, setPlanned] = useState('')
  const chosen = recipes.find((r) => r.id === recipeId)
  const scale = chosen && Number(planned) > 0 ? Number(planned) / chosen.output : 0
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (!recipeId) return setProblem('Choose a recipe.')
    if (!(Number(planned) > 0)) return setProblem('Enter how many to make.')
    setProblem(null)
    await runner.run((k) => planProduction(businessId, { recipeId, planned: Number(planned), date: s('date'), locationId: s('location'), assignedTo: s('assignee') || null, notes: s('notes') }, k), 'Batch planned.')
  }
  return (
    <DetailPage modal title="Plan production" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Recipe" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}><option value="">Select…</option>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name} (makes {qty(r.output)})</option>)}</SelectField>
          <TextField label="How many to make" type="number" min="0" step="any" value={planned} onChange={(e) => setPlanned(e.target.value)} />
          <TextField label="Production date" name="date" type="date" defaultValue={today()} />
          <SelectField label="Use ingredients from" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
          {people.length > 0 && <SelectField label="Assigned to (optional)" name="assignee" defaultValue=""><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>}
          <TextField label="Notes (optional)" name="notes" />
        </div>
        {chosen && scale > 0 && (
          <div className="rounded-md bg-surface p-3 text-sm">
            <p className="mb-1 font-semibold">This batch needs roughly</p>
            <ul className="grid gap-x-6 sm:grid-cols-2">{chosen.lines.map((l) => <li key={l.ingredientId} className="flex justify-between"><span>{l.name}</span><span className="tabular">{qty(Math.round(l.quantity * scale * 10000) / 10000)} {l.unit}</span></li>)}</ul>
            <p className="mt-2 text-xs text-ink/60">Estimated cost {naira(Math.round(chosen.batchCost * scale * 100) / 100)}. The exact check against your stock is on the batch once it is planned.</p>
          </div>
        )}
        {(problem || runner.error) && <ErrorState title="Not planned" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Plan batch</Button></div>
      </form>
    </DetailPage>
  )
}

function BatchDialog({ businessId, batch, recipe, usage, ingredientName, unit, record, manage, onClose, onChanged }: {
  businessId: string; batch: BatchDto; recipe?: RecipeRow; usage: { id: string; ingredientId: string; planned: number; actual: number | null; unitCost: number | null; lineCost: number | null }[]
  ingredientName: (id: string) => string; unit: (id: string) => string; record: boolean; manage: boolean; onClose: () => void; onChanged: () => Promise<void>
}) {
  const runner = useFormRunner(onChanged)
  const needs = useAsync(() => (batch.status === 'planned' || batch.status === 'in_progress' ? loadRequirements(businessId, batch.id) : Promise.resolve([])), [businessId, batch.id, batch.status])
  const [mode, setMode] = useState<'complete' | 'cancel' | 'reverse' | null>(null)
  const [reason, setReason] = useState('')
  const [made, setMade] = useState(String(batch.planned))
  const [failed, setFailed] = useState('0')
  const [used, setUsed] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const open = batch.status === 'planned' || batch.status === 'in_progress'
  const short = (needs.data ?? []).filter((r) => r.shortfall > 0)
  const usedFor = (id: string, planned: number) => used[id] ?? String(planned)

  async function complete(e: FormEvent) {
    e.preventDefault()
    if (!(Number(made) >= 0) || made === '') return setProblem('Enter how many good units were made (0 if the batch failed).')
    if (!(Number(failed) >= 0)) return setProblem('Failed units cannot be negative.')
    setProblem(null)
    await runner.run((k) => completeProduction(businessId, batch.id, { actual: Number(made), failed: Number(failed), usage: usage.map((u) => ({ ingredientId: u.ingredientId, actual: Number(usedFor(u.ingredientId, u.planned)) })) }, k), 'Batch completed: stock updated.', () => setMode(null))
  }

  return (
    <DetailPage title={`${batch.number} · ${recipe?.name ?? 'Recipe'}`} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm"><Badge tone={TONE[batch.status]}>{label(batch.status)}</Badge><span className="text-ink/60">{batch.date} · plan {qty(batch.planned)}{batch.actual !== null ? ` · made ${qty(batch.actual)}, failed ${qty(batch.failed)}` : ''}</span></div>
      {batch.voidReason && <Notice>{label(batch.status)}: {batch.voidReason}</Notice>}
      {open && short.length > 0 && (
        <Notice><p className="font-semibold">Not enough of: {short.map((r) => `${r.name} (short by ${qty(r.shortfall)} ${r.unit})`).join(', ')}</p><p className="mt-1 text-xs">Completing the batch will be refused until stock is received.</p></Notice>
      )}
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-2">Ingredient</th><th className="py-2 text-right">Planned</th><th className="py-2 text-right">{open ? 'On hand' : 'Used'}</th>{!open && <th className="py-2 text-right">Cost</th>}{mode === 'complete' && <th className="py-2 text-right">Really used</th>}</tr></thead>
        <tbody className="divide-y divide-ink/10">
          {usage.map((u) => {
            const need = needs.data?.find((r) => r.ingredientId === u.ingredientId)
            return (
              <tr key={u.id}>
                <td className="py-2">{ingredientName(u.ingredientId)}</td>
                <td className="tabular py-2 text-right">{qty(u.planned)} {unit(u.ingredientId)}</td>
                <td className={`tabular py-2 text-right ${open && need && need.shortfall > 0 ? 'text-danger' : ''}`}>{open ? (need ? qty(need.onHand) : '…') : u.actual === null ? '–' : qty(u.actual)}</td>
                {!open && <td className="tabular py-2 text-right">{u.lineCost === null ? '–' : naira(u.lineCost)}</td>}
                {mode === 'complete' && <td className="py-2 text-right"><input aria-label={`Used ${ingredientName(u.ingredientId)}`} type="number" min="0" step="any" value={usedFor(u.ingredientId, u.planned)} onChange={(e) => setUsed({ ...used, [u.ingredientId]: e.target.value })} className="h-9 w-24 rounded-md border border-line px-2 text-right" /></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      {batch.status === 'completed' && <p className="mt-3 text-sm">Ingredient cost <b>{naira(batch.ingredientCost ?? 0)}</b>{batch.unitCost !== null && <> · <b>{naira(batch.unitCost)}</b> per unit</>}. Yield {batch.actual !== null && batch.planned > 0 ? `${Math.round((batch.actual / batch.planned) * 1000) / 10}% of plan` : ''}.</p>}
      {mode === 'complete' && (
        <form onSubmit={complete} className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Good units made" type="number" min="0" step="any" value={made} onChange={(e) => setMade(e.target.value)} hint="Only these go into stock." />
            <TextField label="Failed or burnt units" type="number" min="0" step="any" value={failed} onChange={(e) => setFailed(e.target.value)} hint="Their cost stays in the batch cost." />
          </div>
          {(problem || runner.error) && <ErrorState title="Not completed" message={(problem ?? runner.error)!} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMode(null)}>Back</Button><Button type="submit" loading={runner.busy}>Complete batch</Button></div>
        </form>
      )}
      {(mode === 'cancel' || mode === 'reverse') && (
        <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => (mode === 'cancel' ? cancelProduction(businessId, batch.id, reason, k) : reverseProduction(businessId, batch.id, reason, k)), mode === 'cancel' ? 'Batch cancelled.' : 'Batch reversed.', () => setMode(null)) }} className="mt-4 space-y-3 border-t border-line pt-4">
          {mode === 'reverse' && <Notice>Reversing puts the ingredients back and takes the bread out of stock. It is refused once any of the batch has been sold or written off.</Notice>}
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          {runner.error && <ErrorState title="Not done" message={runner.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMode(null)}>Back</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">{mode === 'cancel' ? 'Cancel batch' : 'Reverse batch'}</Button></div>
        </form>
      )}
      {!mode && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {record && batch.status === 'planned' && <Button variant="secondary" onClick={() => void runner.run(() => startProduction(businessId, batch.id), 'Batch started.')}>Start</Button>}
          {record && open && <Button variant="secondary" onClick={() => setMode('cancel')}>Cancel batch</Button>}
          {record && open && <Button onClick={() => setMode('complete')}>Complete…</Button>}
          {manage && batch.status === 'completed' && <Button variant="secondary" onClick={() => setMode('reverse')}>Reverse batch</Button>}
          {runner.error && !mode && <p className="w-full text-right text-sm text-danger">{runner.error}</p>}
        </div>
      )}
    </DetailPage>
  )
}
