import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { loadCatalog } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { loadIngredients, saveIngredient } from '../services/bakeryApi'
import type { IngredientRow } from '../services/bakeryApi'

const UNIT_CHOICES = [['kg', 'Kilogram (kg)'], ['g', 'Gram (g)'], ['l', 'Litre (l)'], ['ml', 'Millilitre (ml)'], ['each', 'Each'], ['dozen', 'Dozen']] as const

/** Raw materials with stock on hand, average cost and reorder alerts. Stock moves through Purchases, Production and Waste. */
export function BakeryIngredientsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const rows = useAsync(() => loadIngredients(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'bakery'), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<IngredientRow | 'new' | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  if (!active) return null
  const allowed = can('bakery.manage') || can('inventory.adjust')
  const list = (rows.data ?? []).filter((i) => showInactive || i.active)
  const low = list.filter((i) => i.low).length

  return (
    <>
      <PageHeader title="Ingredients" description="Raw materials and what is on hand. Stock goes up when purchases are received and down when batches are made or waste is recorded."
        actions={allowed ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add ingredient</Button> : undefined} />
      {rows.error && <ErrorState message={rows.error} />}
      {low > 0 && <Notice>{low} ingredient{low === 1 ? ' is' : 's are'} at or below the reorder level.</Notice>}
      <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show archived</label>
      {rows.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No ingredients yet" description="Add flour, sugar, yeast and the rest, with their opening stock, so recipes can be costed and production can use them." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Ingredient</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Average cost</th><th className="p-3 text-right">Reorder at</th><th className="p-3">Status</th>{allowed && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((i) => (
                <tr key={i.id} className={i.active ? '' : 'text-ink/50'}>
                  <td className="p-3 font-medium">{i.name}{i.sku && <div className="text-xs font-normal text-ink/60">{i.sku}</div>}</td>
                  <td className="tabular p-3 text-right">{qty(i.onHand)} {i.unit}</td>
                  <td className="tabular p-3 text-right">{i.avgCost === null ? '–' : `${naira(i.avgCost)} / ${i.unit}`}</td>
                  <td className="tabular p-3 text-right">{i.reorder ? `${qty(i.reorder)} ${i.unit}` : '–'}</td>
                  <td className="p-3">{!i.active ? <Badge>Archived</Badge> : i.low ? <Badge tone="warning">Low stock</Badge> : <Badge tone="success">OK</Badge>}</td>
                  {allowed && <td className="p-3 text-right"><button type="button" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><Pencil className="size-4" aria-hidden /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <IngredientDialog businessId={businessId} ingredient={editing === 'new' ? null : editing} locations={catalog.data?.locations ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await rows.refresh() }} />}
    </>
  )
}

function IngredientDialog({ businessId, ingredient, locations, onClose, onSaved }: { businessId: string; ingredient: IngredientRow | null; locations: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('name').length < 2) next.name = 'Enter at least 2 characters.'
    if (s('cost') !== '' && !(Number(s('cost')) >= 0)) next.cost = 'Enter zero or more.'
    if (s('opening') !== '' && !(Number(s('opening')) >= 0)) next.opening = 'Enter zero or more.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => saveIngredient(businessId, {
      id: ingredient?.id ?? null, name: s('name'), sku: s('sku'), unit: ingredient?.unit ?? s('unit'), reorder: s('reorder') === '' ? null : Number(s('reorder')), cost: s('cost') === '' ? null : Number(s('cost')),
      active: ingredient ? f.get('active') === 'on' : true, openingQty: !ingredient && s('opening') !== '' ? Number(s('opening')) : null, locationId: s('location'),
    }, k), 'Saved.')
  }
  return (
    <Dialog title={ingredient ? `Edit ${ingredient.name}` : 'Add an ingredient'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={ingredient?.name} error={errors.name} autoFocus maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          {ingredient ? <TextField label="Unit" value={ingredient.unit} disabled readOnly hint="Fixed once created." /> : (
            <SelectField label="Unit it is kept in" name="unit" defaultValue="kg">{UNIT_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          )}
          <TextField label="Usual cost per unit" name="cost" type="number" min="0" step="0.01" defaultValue={ingredient?.defaultCost ?? ''} error={errors.cost} hint="Used until purchases give an average." />
          <TextField label="Reorder when stock reaches" name="reorder" type="number" min="0" step="any" defaultValue={ingredient?.reorder ?? ''} />
          <TextField label="Code (optional)" name="sku" defaultValue={ingredient?.sku ?? ''} />
          {!ingredient && <TextField label="Opening stock (optional)" name="opening" type="number" min="0" step="any" error={errors.opening} />}
          {!ingredient && locations.length > 0 && <SelectField label="Store it in" name="location">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>}
        </div>
        {ingredient && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={ingredient.active} /> Active <span className="text-ink/60">(archived ingredients cannot be used in new recipes)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{ingredient ? 'Save' : 'Add ingredient'}</Button></div>
      </form>
    </Dialog>
  )
}
