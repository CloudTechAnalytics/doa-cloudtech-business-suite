import clsx from 'clsx'
import { useRef, useState } from 'react'
import { Button, Card, EmptyState, ErrorState, Notice, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import * as api from '@/modules/inventory/inventoryApi'
import type { CountRow, InventoryData } from '@/modules/inventory/inventoryApi'

const fmt = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 4 })

/**
 * Stock counts: walk a location with a list, type what is really on the shelf, and post the differences. Each difference becomes one "count adjustment" in the ledger
 * (worked out against the stock at the moment of posting, so sales made while you were counting are not lost). A posted count cannot be changed.
 */
export function CountsTab({ data, businessId, canWrite, onChanged }: { data: InventoryData; businessId: string; canWrite: boolean; onChanged: () => Promise<void> }) {
  const counts = useAsync(() => api.listCounts(businessId), [businessId])
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const startKey = useRef(crypto.randomUUID())
  const where = (id: string) => data.locations.find((l) => l.id === id)?.name ?? 'Location'
  const open = (counts.data ?? []).find((c) => c.id === openId) ?? null

  async function start(location: string) {
    setBusy(true); setError(null)
    const r = await api.startCount(businessId, location, startKey.current)
    setBusy(false)
    if (r.error) return setError(r.error)
    startKey.current = crypto.randomUUID()
    await counts.refresh(); setOpenId(r.countId ?? null)
  }

  if (open) return <CountSheet data={data} businessId={businessId} count={open} canWrite={canWrite} onBack={() => setOpenId(null)} onChanged={async () => { await Promise.all([counts.refresh(), onChanged()]) }} />

  const list = counts.data ?? []
  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-ink/70">A count checks what is on the shelf against what the books say. Start one for a location, type the quantities you find (leave a product blank to skip it), then post: each difference is written to the movement history as a count adjustment.</p>
      {canWrite && data.locations.length > 0 && <StartCount data={data} busy={busy} onStart={start} />}
      {error && <ErrorState message={error} />}
      {counts.error && <ErrorState message={counts.error} />}
      {counts.loading ? <Spinner /> : list.length === 0 ? <EmptyState title="No counts yet" description="Start a count to check your shelves against your records." /> : (
        <Card className="mt-3 p-0">
          <ul className="divide-y divide-ink/10 text-sm">
            {list.map((c) => {
              const done = c.items.filter((i) => i.counted !== null).length
              const off = c.items.filter((i) => i.counted !== null && i.counted !== i.expected).length
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="font-medium">{where(c.locationId)}</span>
                  <span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', c.status === 'open' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>{c.status === 'open' ? 'Open' : 'Posted'}</span>
                  <span className="text-xs text-ink/60">{new Date(c.status === 'posted' && c.postedAt ? c.postedAt : c.createdAt).toLocaleString('en-NG')} · {done} of {c.items.length} counted{off > 0 ? ` · ${off} differ` : ''}</span>
                  <Button variant="ghost" className="ml-auto" onClick={() => setOpenId(c.id)}>{c.status === 'open' ? (canWrite ? 'Continue' : 'View') : 'View'}</Button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}

function StartCount({ data, busy, onStart }: { data: InventoryData; busy: boolean; onStart: (location: string) => Promise<void> }) {
  const [loc, setLoc] = useState(data.locations[0]?.id ?? '')
  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48"><SelectField label="Count which location?" value={loc} onChange={(e) => setLoc(e.target.value)}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField></div>
        <Button loading={busy} disabled={!loc} onClick={() => void onStart(loc)}>Start a count</Button>
      </div>
    </Card>
  )
}

function CountSheet({ data, businessId, count, canWrite, onBack, onChanged }: { data: InventoryData; businessId: string; count: CountRow; canWrite: boolean; onBack: () => void; onChanged: () => Promise<void> }) {
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = useRef(crypto.randomUUID())
  const editable = canWrite && count.status === 'open'
  const product = (id: string) => data.products.find((p) => p.id === id)
  const term = search.trim().toLowerCase()
  const items = count.items.filter((i) => { const p = product(i.productId); return p && (!term || [p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(term))) })
    .sort((a, b) => (product(a.productId)?.name ?? '').localeCompare(product(b.productId)?.name ?? ''))
  const counted = count.items.filter((i) => i.counted !== null)
  const differing = counted.filter((i) => i.counted !== i.expected)

  async function save(productId: string, raw: string, was: number | null) {
    const value = raw.trim() === '' ? null : Number(raw)
    if (value === was) return
    if (value !== null && !(value >= 0)) return setError('A counted quantity must be zero or more.')
    setError(null)
    const err = await api.recordCount(businessId, count.id, productId, value)
    if (err) return setError(err)
    await onChanged()
  }
  async function post() {
    if (!window.confirm(`Post this count? ${differing.length} difference${differing.length === 1 ? '' : 's'} will be written to the movement history. A posted count cannot be changed.`)) return
    setBusy(true); setError(null)
    const r = await api.postCount(businessId, count.id, key.current)
    setBusy(false)
    if (r.error) return setError(r.error)
    key.current = crypto.randomUUID()
    setOk(r.adjusted ? `Count posted. ${r.adjusted} adjustment${r.adjusted === 1 ? '' : 's'} recorded.` : 'Count posted. Everything matched, so nothing needed adjusting.')
    await onChanged()
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={onBack}>All counts</Button>
        <h2 className="text-sm font-semibold">{data.locations.find((l) => l.id === count.locationId)?.name ?? 'Location'} · {count.status === 'open' ? 'open' : 'posted'}</h2>
        <span className="text-xs text-ink/60">{counted.length} of {count.items.length} counted · {differing.length} differ</span>
        {editable && <Button className="ml-auto" loading={busy} disabled={counted.length === 0} onClick={() => void post()}>Post count</Button>}
      </div>
      {error && <ErrorState message={error} />}
      {ok && <Notice>{ok}</Notice>}
      {count.status === 'posted' && !ok && <Notice>This count is posted and cannot be changed.</Notice>}
      {!canWrite && count.status === 'open' && <Notice>Your role can view counts but not change them.</Notice>}
      <div className="mb-3 max-w-xs"><TextField label="Find a product" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or barcode" /></div>
      {items.length === 0 ? <EmptyState title="Nothing to count" description={count.items.length ? 'Try another search.' : 'No products in this location keep stock yet.'} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3 text-right">Books say</th><th className="p-3 text-right">Counted</th><th className="p-3 text-right">Difference</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {items.map((i) => {
                const p = product(i.productId)!
                const diff = i.counted === null ? null : Math.round((i.counted - i.expected) * 10000) / 10000
                return (
                  <tr key={i.productId}>
                    <td className="p-3"><b>{p.name}</b><div className="text-xs text-ink/60">{p.sku ?? 'No SKU'} · {p.unit}</div></td>
                    <td className="p-3 text-right tabular-nums">{fmt(i.expected)}</td>
                    <td className="p-3 text-right">
                      {editable
                        ? <input aria-label={`Counted quantity of ${p.name}`} type="number" min="0" step="any" defaultValue={i.counted ?? ''} onBlur={(e) => void save(i.productId, e.target.value, i.counted)} className="w-24 rounded border border-ink/20 px-2 py-1 text-right tabular-nums" />
                        : <span className="tabular-nums">{i.counted === null ? '–' : fmt(i.counted)}</span>}
                    </td>
                    <td className={clsx('p-3 text-right tabular-nums', diff && diff < 0 && 'text-danger', diff && diff > 0 && 'text-success')}>{diff === null ? '' : diff === 0 ? 'Matches' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
