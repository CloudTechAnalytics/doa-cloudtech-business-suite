import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira, qty } from '@/shared/utilities/format'
import { loadFinished, loadLots, saveProduct } from '../services/bakeryApi'
import type { FinishedRow } from '../services/bakeryApi'
import { openRow } from '@/shared/utilities/rows'

const TONE = { ok: 'success', expiring: 'warning', expired: 'danger' } as const

/** What the bakery sells: price, stock, shelf life, and the batches (lots) on hand with their expiry dates. */
export function BakeryProductsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const products = useAsync(() => loadFinished(businessId), [businessId])
  const lots = useAsync(() => loadLots(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<FinishedRow | 'new' | null>(null)
  if (!active) return null
  const manage = can('bakery.manage')
  const attention = (lots.data ?? []).filter((l) => l.status !== 'ok')

  return (
    <>
      <PageHeader title="Products" description="What you bake and sell. Stock comes from completed production batches and goes down as you sell, oldest expiry first. A new price applies to future sales only."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add product</Button> : undefined} />
      {(products.error || lots.error) && <ErrorState message={(products.error ?? lots.error)!} />}
      {attention.length > 0 && (
        <Notice>
          <p className="font-semibold">{attention.filter((l) => l.status === 'expired').length} expired and {attention.filter((l) => l.status === 'expiring').length} expiring batches still hold stock</p>
          <p className="mt-1 text-xs">Write expired stock off on the <Link className="font-semibold underline" to="/app/bakery/waste">Waste</Link> page so your stock and losses stay accurate.</p>
        </Notice>
      )}
      {products.loading ? <Spinner /> : !products.data?.length ? <Card className="mt-4"><EmptyState title="No products yet" description="Add the breads, cakes and pastries you sell, then create a recipe for each." /></Card> : (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">In stock</th><th className="p-3 text-right">Cost each</th><th className="p-3">Shelf life</th><th className="p-3">Next expiry</th>{manage && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {products.data.map((p) => (
                <tr data-row-link onClick={openRow} key={p.id} className={p.active ? '' : 'text-ink/50'}>
                  <td className="p-3 font-medium">{p.name}{!p.active && <> <Badge>Archived</Badge></>}{p.low && p.active && <> <Badge tone="warning">Low stock</Badge></>}{p.sku && <div className="text-xs font-normal text-ink/60">{p.sku}</div>}</td>
                  <td className="tabular p-3 text-right">{naira(p.price)} <span className="text-ink/50">/ {p.unit}</span></td>
                  <td className="tabular p-3 text-right">{qty(p.onHand)}</td>
                  <td className="tabular p-3 text-right">{p.avgCost === null ? '–' : naira(p.avgCost)}</td>
                  <td className="p-3">{p.shelfLifeDays ? `${p.shelfLifeDays} day${p.shelfLifeDays === 1 ? '' : 's'}` : 'Not set'}</td>
                  <td className="p-3">{p.nextExpiry ?? '–'}</td>
                  {manage && <td className="p-3 text-right"><button type="button" aria-label={`Open ${p.name}`} onClick={() => setEditing(p)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <h2 className="mb-2 mt-6 text-sm font-semibold">Batches on hand</h2>
      {(lots.data ?? []).length === 0 ? <Card><EmptyState title="No batches in stock" description="Finished goods appear here, with expiry dates, when a production batch is completed." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Batch</th><th className="p-3">Product</th><th className="p-3 text-right">Left / made</th><th className="p-3">Made on</th><th className="p-3">Expires</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {(lots.data ?? []).map((l) => (
                <tr data-row-link onClick={openRow} key={l.id}>
                  <td className="p-3 font-medium">{l.batchNumber}</td><td className="p-3">{l.productName}</td>
                  <td className="tabular p-3 text-right">{qty(l.remaining)} / {qty(l.quantity)}</td><td className="p-3">{l.producedOn}</td>
                  <td className="p-3">{l.expiresOn ?? 'No expiry'} {l.expiresOn && <Badge tone={TONE[l.status]}>{l.status === 'expired' ? 'Expired' : l.status === 'expiring' ? `${l.daysLeft} d left` : `${l.daysLeft} d`}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <ProductDialog businessId={businessId} product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await products.refresh() }} />}
    </>
  )
}

function ProductDialog({ businessId, product, onClose, onSaved }: { businessId: string; product: FinishedRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('name').length < 2) next.name = 'Enter at least 2 characters.'
    if (s('price') === '' || !(Number(s('price')) >= 0)) next.price = 'Enter the price (0 or more).'
    if (s('shelf') !== '' && !(Number(s('shelf')) >= 1 && Number(s('shelf')) <= 365)) next.shelf = 'Enter 1 to 365 days.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => saveProduct(businessId, {
      id: product?.id ?? null, name: s('name'), sku: s('sku'), unit: product?.unit ?? s('unit'), price: Math.round(Number(s('price')) * 100) / 100,
      shelfLifeDays: s('shelf') === '' ? null : Number(s('shelf')), minStock: s('min') === '' ? null : Number(s('min')), description: '', active: product ? f.get('active') === 'on' : true,
    }, k), 'Saved.')
  }
  return (
    <DetailPage title={product ? `Edit ${product.name}` : 'Add a product'} onClose={onClose} view={!!product} modal={!product}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={product?.name} error={errors.name} autoFocus maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Selling price" name="price" type="number" min="0" step="0.01" defaultValue={product?.price ?? ''} error={errors.price} hint={product ? 'Past sales keep the price they were sold at.' : undefined} />
          {product ? <TextField label="Sold per" value={product.unit} disabled readOnly /> : (
            <SelectField label="Sold per" name="unit" defaultValue="each"><option value="each">Piece / loaf / cake</option><option value="dozen">Dozen</option></SelectField>
          )}
          <TextField label="Shelf life (days)" name="shelf" type="number" min="1" max="365" defaultValue={product?.shelfLifeDays ?? ''} error={errors.shelf} hint="Sets the expiry date of each batch." />
          <TextField label="Keep at least in stock" name="min" type="number" min="0" step="any" defaultValue={product?.minStock ?? ''} />
          <TextField label="Code (optional)" name="sku" defaultValue={product?.sku ?? ''} />
        </div>
        {product && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={product.active} /> Active <span className="text-ink/60">(archived products cannot be sold)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{product ? 'Save' : 'Add product'}</Button></div>
      </form>
    </DetailPage>
  )
}
