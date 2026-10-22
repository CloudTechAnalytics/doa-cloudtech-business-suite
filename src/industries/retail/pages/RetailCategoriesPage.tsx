import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { loadCategories, loadProducts, saveCategory } from '../services/martApi'
import type { MartCategory } from '../services/martApi'
import { openRow } from '@/shared/utilities/rows'

/** Product categories, used to group the shelf, the stock count and the sales reports. */
export function RetailCategoriesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const categories = useAsync(() => loadCategories(businessId), [businessId])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<MartCategory | 'new' | null>(null)
  if (!active) return null
  const manage = can('retail.manage')
  const count = (id: string) => (products.data ?? []).filter((p) => p.categoryId === id && p.active).length

  return (
    <>
      <PageHeader title="Categories" description="Group products so shelves, counts and reports are easier to read." actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add category</Button> : undefined} />
      {categories.error && <ErrorState message={categories.error} />}
      {categories.loading ? <Spinner /> : !categories.data?.length ? <Card><EmptyState title="No categories yet" description="Add categories such as Groceries, Drinks or Household." /></Card> : (
        <Card className="p-0">
          <ul className="divide-y divide-ink/10">
            {categories.data.map((c) => (
              <li data-row-link onClick={openRow} key={c.id} className="flex items-center justify-between p-3 text-sm">
                <span className="font-medium">{c.name} <span className="font-normal text-ink/60">{count(c.id)} product{count(c.id) === 1 ? '' : 's'}</span></span>
                {manage && <button type="button" aria-label={`Open ${c.name}`} onClick={() => setEditing(c)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <CategoryDialog businessId={businessId} category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await categories.refresh() }} />}
    </>
  )
}

function CategoryDialog({ businessId, category, onClose, onSaved }: { businessId: string; category: MartCategory | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (name.length < 2) return setError('Enter at least 2 characters.')
    setError(null)
    await runner.run(async () => saveCategory(businessId, { id: category?.id ?? null, name }), 'Saved.')
  }
  return (
    <DetailPage title={category ? 'Rename category' : 'Add a category'} onClose={onClose} view={!!category} modal={!category}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={category?.name} error={error ?? undefined} autoFocus maxLength={80} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </DetailPage>
  )
}
