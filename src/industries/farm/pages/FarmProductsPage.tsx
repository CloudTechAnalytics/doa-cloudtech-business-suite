import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira } from '@/shared/utilities/format'
import { useFarm } from '../hooks/useFarm'
import { createFarmProduct, loadFarmProducts, updateFarmProduct } from '../services/farmApi'
import { PRODUCT_AREA_LABEL, PRODUCT_SOURCE_LABEL } from '../types'
import type { FarmProduct, ProductArea, ProductSource } from '../types'
import { openRow } from '@/shared/utilities/rows'

const UNITS = [['each', 'Each'], ['dozen', 'Dozen'], ['kg', 'Kilogram'], ['g', 'Gram'], ['l', 'Litre'], ['ml', 'Millilitre']] as const
const qty = (n: number) => Math.round(n * 100) / 100

function sourceNote(p: FarmProduct) {
  if (p.source === 'other') return 'Not stock-tracked'
  if (p.source === 'livestock') return `Live ${p.species} batches`
  return 'Recorded harvests'
}

export function FarmProductsPage() {
  const { active } = useBusiness()
  const farm = useFarm()
  const businessId = active?.id ?? ''
  const products = useAsync(() => loadFarmProducts(businessId), [businessId])
  const [editing, setEditing] = useState<FarmProduct | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const canManage = farm.can('farm.manage')

  const q = search.trim().toLowerCase()
  const list = (products.data ?? []).filter((p) => (showInactive || p.active) && (!source || p.source === source) && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)))

  return (
    <>
      <PageHeader
        title="Products"
        description="What the farm sells, in which unit and at what price. Quantities come from recorded harvests and live batches."
        actions={canManage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add product</Button> : undefined}
      />
      {products.error && <ErrorState message={products.error} />}
      {!products.data && !products.error ? <Spinner /> : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or SKU" /></div>
            <div className="w-56">
              <SelectField label="Stock from" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">All products</option>
                {(Object.keys(PRODUCT_SOURCE_LABEL) as ProductSource[]).map((k) => <option key={k} value={k}>{PRODUCT_SOURCE_LABEL[k]}</option>)}
              </SelectField>
            </div>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
          </div>
          {list.length === 0 ? (
            <Card>
              <EmptyState
                title={products.data?.length ? 'No products match' : 'No products yet'}
                description={products.data?.length ? 'Try a different search or filter.' : 'Add what you sell, such as eggs, catfish or live broilers, to record harvests and sales against it.'}
                action={canManage && !products.data?.length ? <Button onClick={() => setEditing('new')}>Add a product</Button> : undefined}
              />
            </Card>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-ink/70">
                  <tr><th className="p-3">Product</th><th className="p-3">Stock from</th><th className="p-3 text-right">Standard price</th><th className="p-3 text-right">Available</th>{canManage && <th className="w-12 p-3" />}</tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {list.map((p) => (
                    <tr data-row-link onClick={openRow} key={p.id} className={p.active ? '' : 'text-ink/50'}>
                      <td className="p-3">
                        <span className="font-medium">{p.name}</span>{!p.active && <span className="ml-2"><Badge>Inactive</Badge></span>}
                        <div className="text-xs text-ink/60">{PRODUCT_AREA_LABEL[p.area]}{p.sku ? ` · ${p.sku}` : ''}</div>
                      </td>
                      <td className="p-3">{sourceNote(p)}</td>
                      <td className="tabular p-3 text-right">{naira(p.price)} <span className="text-ink/50">/ {p.unit}</span></td>
                      <td className="tabular p-3 text-right font-medium">{p.available === null ? '–' : `${qty(p.available)} ${p.unit}`}</td>
                      {canManage && <td className="p-3 text-right"><button type="button" aria-label={`Open ${p.name}`} onClick={() => setEditing(p)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing} businessId={businessId} species={[...new Set(farm.activeBatches.map((b) => b.species))].sort()}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await products.refresh() }}
        />
      )}
    </>
  )
}

function ProductDialog({ product, businessId, species, onClose, onSaved }: { product: FarmProduct | null; businessId: string; species: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [source, setSource] = useState<ProductSource>(product?.source ?? 'produce')
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('name').length < 2) next.name = 'Enter at least 2 characters.'
    if (s('price') === '' || !(Number(s('price')) >= 0)) next.price = 'Enter the price (0 or more).'
    if (!product && source === 'livestock' && !s('species')) next.species = 'Choose what this product is drawn from.'
    setErrors(next)
    if (Object.keys(next).length) return
    if (product) {
      await runner.run(() => updateFarmProduct(businessId, product.id, { name: s('name'), price: Number(s('price')), description: product.description, active: f.get('active') === 'on' }), 'Product saved.')
    } else {
      await runner.run((k) => createFarmProduct(businessId, {
        name: s('name'), sku: s('sku'), area: s('area') as ProductArea, source, species: s('species'), unit: source === 'livestock' ? 'each' : s('unit'), price: Number(s('price')), description: '',
      }, k), 'Product added.')
    }
  }

  return (
    <DetailPage title={product ? `Edit ${product.name}` : 'Add a product'} onClose={onClose} view={!!product}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={product?.name} error={errors.name} placeholder="e.g. Eggs (crate)" maxLength={120} autoFocus />
        {product ? (
          <>
            <TextField label="Stock comes from" value={PRODUCT_SOURCE_LABEL[product.source]} disabled hint="Fixed once the product is created." readOnly />
            {product.species && <TextField label="Species" value={product.species} disabled readOnly />}
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Farm area" name="area" defaultValue="poultry">
              {(Object.keys(PRODUCT_AREA_LABEL) as ProductArea[]).filter((a) => a !== 'livestock').map((a) => <option key={a} value={a}>{PRODUCT_AREA_LABEL[a]}</option>)}
            </SelectField>
            <SelectField label="Stock comes from" value={source} onChange={(e) => setSource(e.target.value as ProductSource)}>
              {(Object.keys(PRODUCT_SOURCE_LABEL) as ProductSource[]).map((k) => <option key={k} value={k}>{PRODUCT_SOURCE_LABEL[k]}</option>)}
            </SelectField>
          </div>
        )}
        {!product && source === 'livestock' && (
          <>
            <TextField label="Species" name="species" list="farm-species" error={errors.species} placeholder="e.g. Layer" maxLength={80}
              hint="Availability is the head count of active batches of this species. Record animals sold as a removal on the batch." />
            <datalist id="farm-species">{species.map((x) => <option key={x} value={x} />)}</datalist>
          </>
        )}
        {!product && source === 'produce' && <p className="rounded-md bg-surface p-3 text-xs text-ink/70">Stock is filled when you record a harvest of this product, and reduced when you sell it.</p>}
        {!product && source === 'other' && <p className="rounded-md bg-surface p-3 text-xs text-ink/70">Products not drawn from stock (manure, services, hire) are sold without any quantity being deducted.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!product && (
            <SelectField label="Sold in" name="unit" defaultValue="each" disabled={source === 'livestock'} hint={source === 'livestock' ? 'Live animals are sold per head.' : undefined}>
              {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
          )}
          <TextField label="Standard price" name="price" type="number" min="0" step="0.01" defaultValue={product?.price} error={errors.price} />
        </div>
        {!product && <TextField label="SKU / code (optional)" name="sku" maxLength={40} />}
        {product && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={product.active} /> Active <span className="text-ink/60">(inactive products cannot be added to new sales)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={runner.busy}>{product ? 'Save' : 'Add product'}</Button>
        </div>
      </form>
    </DetailPage>
  )
}

