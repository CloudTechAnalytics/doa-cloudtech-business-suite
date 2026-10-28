import { ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
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
import { ImportCategoriesDialog } from '../components/CsvImport'
import { downloadCategoryTemplate } from '../importDownloads'
import { DeleteButton } from '@/shared/components/delete-button'

/** Product categories, used to group the shelf, the stock count and the sales reports. */
export function RetailCategoriesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const categories = useAsync(() => loadCategories(businessId), [businessId])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<MartCategory | 'new' | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  if (!active) return null
  const manage = can('retail.manage')
  const count = (id: string) => (products.data ?? []).filter((p) => p.categoryId === id && p.active).length

  return (
    <>
      <PageHeader title="Categories" description="Group products so shelves, counts and reports are easier to read." actions={manage ? <div className="flex flex-wrap gap-2"><input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose a CSV file of categories" onChange={async (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) setImporting(await f.text()); e.target.value = '' }} /><Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import CSV</Button><Button variant="ghost" onClick={downloadCategoryTemplate}><Download className="size-4" aria-hidden /> Template</Button><Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add category</Button></div> : undefined} />
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
      {importing !== null && <ImportCategoriesDialog businessId={businessId} text={importing} existing={categories.data ?? []} onClose={() => setImporting(null)} onDone={async () => { setImporting(null); await categories.refresh() }} />}
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
    <DetailPage title={category ? 'Rename category' : 'Add a category'} onClose={onClose} view={!!category} modal={!category} actions={category ? <DeleteButton businessId={businessId} kind="category" id={category.id} label={category.name} noun="category" onDeleted={onSaved} /> : undefined}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={category?.name} error={error ?? undefined} autoFocus maxLength={80} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </DetailPage>
  )
}
