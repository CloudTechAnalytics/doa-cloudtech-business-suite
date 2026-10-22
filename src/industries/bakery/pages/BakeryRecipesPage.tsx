import { ChevronRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { UNITS, loadFinished, loadIngredients, loadRecipes, saveRecipe, setRecipeStatus } from '../services/bakeryApi'
import type { IngredientRow, RecipeRow } from '../services/bakeryApi'
import { openRow } from '@/shared/utilities/rows'

interface Line { ingredientId: string; quantity: string; unit: string }
const blank = (): Line => ({ ingredientId: '', quantity: '', unit: '' })
/** Units that measure the same thing as the ingredient's own unit (kg and g, l and ml). */
const compatible = (unit: string) => Object.entries(UNITS).filter(([, d]) => d.dimension === UNITS[unit]?.dimension).map(([code]) => code)

/** Recipes with their ingredients, the estimated cost of a batch and of each unit. Editing a recipe saves a new version; old versions are kept. */
export function BakeryRecipesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const recipes = useAsync(() => loadRecipes(businessId), [businessId])
  const ingredients = useAsync(() => loadIngredients(businessId), [businessId])
  const products = useAsync(() => loadFinished(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<RecipeRow | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!active) return null
  const manage = can('bakery.manage')

  return (
    <>
      <PageHeader title="Recipes" description="What goes into each product. Costs are estimates from today's ingredient costs; each batch you make keeps the version and costs it actually used."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New recipe</Button> : undefined} />
      {(recipes.error || error) && <ErrorState message={(error ?? recipes.error)!} />}
      {recipes.loading ? <Spinner /> : !recipes.data?.length ? <Card><EmptyState title="No recipes yet" description="Create a product and its ingredients first, then write the recipe so production can scale it." /></Card> : (
        <div className="space-y-3">
          {recipes.data.map((r) => (
            <Card key={r.id} className={r.status === 'archived' ? 'opacity-60' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{r.name} <Badge tone="info">v{r.version}</Badge>{r.status === 'archived' && <> <Badge>Archived</Badge></>}</p>
                  <p className="text-sm text-ink/60">Makes {qty(r.output)} {r.productName} per batch</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-sm"><p className="tabular font-semibold">{naira(r.batchCost)}</p><p className="text-xs text-ink/60">per batch</p></div>
                  <div className="text-right text-sm"><p className="tabular font-semibold">{naira(r.unitCost)}</p><p className="text-xs text-ink/60">per unit</p></div>
                  {manage && <button type="button" aria-label={`Open ${r.name}`} onClick={() => setEditing(r)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button>}
                </div>
              </div>
              <ul className="mt-3 divide-y divide-ink/10 text-sm">
                {r.lines.map((l) => <li data-row-link onClick={openRow} key={l.ingredientId} className="flex justify-between gap-3 py-1.5"><span>{l.name}</span><span className="tabular text-ink/70">{qty(l.quantity)} {l.unit} · {naira(l.cost)}</span></li>)}
              </ul>
              {r.instructions && <p className="mt-3 rounded-md bg-surface p-3 text-sm text-ink/80">{r.instructions}</p>}
              {manage && <div className="mt-3"><Button variant="ghost" onClick={async () => { setError(await setRecipeStatus(businessId, r.id, r.status === 'archived')); await recipes.refresh() }}>{r.status === 'archived' ? 'Restore' : 'Archive'}</Button></div>}
            </Card>
          ))}
        </div>
      )}
      {editing && <RecipeDialog businessId={businessId} recipe={editing === 'new' ? null : editing} ingredients={(ingredients.data ?? []).filter((i) => i.active)} products={(products.data ?? []).filter((p) => p.active)} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await recipes.refresh() }} />}
    </>
  )
}

function RecipeDialog({ businessId, recipe, ingredients, products, onClose, onSaved }: { businessId: string; recipe: RecipeRow | null; ingredients: IngredientRow[]; products: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [lines, setLines] = useState<Line[]>(recipe ? recipe.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.unit })) : [blank()])
  const [problem, setProblem] = useState<string | null>(null)
  const unitOf = (id: string) => ingredients.find((i) => i.id === id)?.unit ?? ''
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const clean = lines.filter((l) => l.ingredientId)
    if (!recipe && !s('product')) return setProblem('Choose the product this recipe makes.')
    if (!recipe && !s('name')) return setProblem('Enter the recipe name.')
    if (!(Number(s('output')) > 0)) return setProblem('Enter how many units one batch makes.')
    if (!clean.length) return setProblem('Add at least one ingredient.')
    if (clean.some((l) => !(Number(l.quantity) > 0))) return setProblem('Every ingredient needs a quantity above zero.')
    setProblem(null)
    await runner.run((k) => saveRecipe(businessId, {
      recipeId: recipe?.id ?? null, productId: recipe?.productId ?? s('product'), name: recipe?.name ?? s('name'), output: Number(s('output')), instructions: s('instructions'),
      lines: clean.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit || unitOf(l.ingredientId) })),
    }, k), recipe ? 'New version saved.' : 'Recipe saved.')
  }

  return (
    <DetailPage title={recipe ? `Edit ${recipe.name}` : 'New recipe'} onClose={onClose} view={!!recipe} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        {recipe && <Notice>Saving creates version {recipe.version + 1}. Batches already made keep the version they used.</Notice>}
        <div className="grid gap-4 sm:grid-cols-3">
          {recipe ? <TextField label="Product" value={recipe.productName} disabled readOnly /> : (
            <SelectField label="Product" name="product" defaultValue=""><option value="" disabled>Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
          )}
          {!recipe && <TextField label="Recipe name" name="name" maxLength={120} />}
          <TextField label="One batch makes" name="output" type="number" min="0" step="any" defaultValue={recipe?.output ?? ''} />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_110px_110px_auto]">
              <SelectField label={i === 0 ? 'Ingredient' : ' '} value={l.ingredientId} onChange={(e) => set(i, { ingredientId: e.target.value, unit: unitOf(e.target.value) })}>
                <option value="">Select…</option>
                {ingredients.filter((x) => x.id === l.ingredientId || !lines.some((y) => y.ingredientId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
              </SelectField>
              <TextField label={i === 0 ? 'Quantity' : ' '} type="number" min="0" step="any" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              <SelectField label={i === 0 ? 'Unit' : ' '} value={l.unit || unitOf(l.ingredientId)} onChange={(e) => set(i, { unit: e.target.value })} disabled={!l.ingredientId}>
                {(l.ingredientId ? compatible(unitOf(l.ingredientId)) : []).map((u) => <option key={u} value={u}>{u}</option>)}
              </SelectField>
              <button type="button" aria-label="Remove ingredient" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="mb-2 p-2 text-ink/50 hover:text-danger disabled:opacity-30"><X className="size-4" aria-hidden /></button>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setLines([...lines, blank()])}><Plus className="size-4" aria-hidden /> Add ingredient</Button>
        </div>
        <TextField label="Method (optional)" name="instructions" defaultValue={recipe?.instructions ?? ''} />
        {(problem || runner.error) && <ErrorState title="Not saved" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{recipe ? 'Save new version' : 'Save recipe'}</Button></div>
      </form>
    </DetailPage>
  )
}
