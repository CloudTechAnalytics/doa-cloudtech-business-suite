import { Download } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira, qty } from '@/shared/utilities/format'
import { loadBatches, loadIngredients, loadLots, loadOverview, loadRecipes, loadWaste } from '../services/bakeryApi'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100

function csv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }))
  a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href)
}

function Figure({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return <Card><p className="text-xs font-medium uppercase tracking-wide text-ink/60">{title}</p><p className={`tabular mt-2 text-2xl font-semibold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>{note && <p className="mt-1 text-xs text-ink/60">{note}</p>}</Card>
}

/** Sales and profit, production and yield, ingredient use, waste and expiry for a period. Every figure is worked out from the records. */
export function BakeryReportsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return iso(d) })
  const [to, setTo] = useState(() => iso(new Date()))
  const valid = from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000
  const overview = useAsync(() => (valid ? loadOverview(businessId, from, to) : Promise.reject(new Error('Choose a period of up to a year, starting before it ends.'))), [businessId, from, to, valid])
  const batches = useAsync(() => loadBatches(businessId), [businessId])
  const recipes = useAsync(() => loadRecipes(businessId), [businessId])
  const ingredients = useAsync(() => loadIngredients(businessId), [businessId])
  const waste = useAsync(() => loadWaste(businessId), [businessId])
  const lots = useAsync(() => loadLots(businessId), [businessId])
  if (!active) return null

  const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to
  const done = (batches.data?.batches ?? []).filter((b) => b.status === 'completed' && inRange(b.date))
  const recipe = (id: string) => recipes.data?.find((r) => r.id === id)
  const iName = (id: string) => ingredients.data?.find((i) => i.id === id)?.name ?? 'Ingredient'
  const iUnit = (id: string) => ingredients.data?.find((i) => i.id === id)?.unit ?? ''
  const consumption = new Map<string, { qty: number; cost: number }>()
  for (const u of (batches.data?.usage ?? []).filter((x) => done.some((b) => b.id === x.batchId))) {
    const cur = consumption.get(u.ingredientId) ?? { qty: 0, cost: 0 }
    consumption.set(u.ingredientId, { qty: cur.qty + (u.actual ?? 0), cost: round2(cur.cost + (u.lineCost ?? 0)) })
  }
  const wasteRows = (waste.data ?? []).filter((w) => w.status === 'posted' && inRange(w.createdAt))
  const byReason = new Map<string, { n: number; loss: number }>()
  for (const w of wasteRows) { const cur = byReason.get(w.reason) ?? { n: 0, loss: 0 }; byReason.set(w.reason, { n: cur.n + 1, loss: round2(cur.loss + w.loss) }) }
  const o = overview.data; const f = o?.financial ?? null
  const risky = (lots.data ?? []).filter((l) => l.status !== 'ok')

  return (
    <>
      <PageHeader title="Bakery reports" description="Sales, profit, production, ingredient use and waste for a period. Figures come from the recorded transactions, so they match what you see on each screen." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44"><TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><TextField label="To" type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {overview.error && <ErrorState message={overview.error} />}
      {overview.loading && !o ? <Spinner /> : (
        <div className="space-y-6">
          {f ? (
            <section aria-label="Sales and profit">
              <h2 className="mb-2 text-sm font-semibold">Sales and profit</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure title="Net sales" value={naira(f.netSales)} note={`${o!.salesCount} sales; discounts ${naira(f.discounts)}, refunds ${naira(f.refunds)}`} />
                <Figure title="Cost of goods sold" value={naira(f.cogs)} />
                <Figure title="Gross profit" value={naira(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} note={f.grossMarginPercent === null ? undefined : `${f.grossMarginPercent}% margin`} />
                <Figure title="Operating profit (estimate)" value={naira(f.operatingProfitEstimate)} tone={f.operatingProfitEstimate >= 0 ? 'good' : 'bad'} note={`After expenses of ${naira(f.operatingExpenses)}`} />
              </div>
              <Notice>Net sales = sales less discounts, tax and refunds. Gross profit = net sales less cost of goods sold. Operating profit = gross profit less recorded expenses. It is an estimate: tax, depreciation and costs not recorded are not included, and ingredient purchases are stock, not expenses.</Notice>
            </section>
          ) : o && <Notice>Profit figures are shown to roles that may read financial reports.</Notice>}

          <section aria-label="Production">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Production and yield</h2>
              <Button variant="secondary" disabled={!done.length} onClick={() => csv(`production-${from}-to-${to}`, [['Batch', 'Date', 'Recipe', 'Planned', 'Made', 'Failed', 'Yield %', 'Ingredient cost', 'Cost each'], ...done.map((b) => [b.number, b.date, recipe(b.recipeId)?.name ?? '', b.planned, b.actual ?? 0, b.failed, b.planned ? Math.round(((b.actual ?? 0) / b.planned) * 1000) / 10 : 0, b.ingredientCost ?? 0, b.unitCost ?? ''])])}><Download className="size-4" aria-hidden /> Export CSV</Button></div>
            {done.length === 0 ? <Card><EmptyState title="No completed batches in this period" /></Card> : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Batch</th><th className="p-3">Recipe</th><th className="p-3 text-right">Planned</th><th className="p-3 text-right">Made</th><th className="p-3 text-right">Failed</th><th className="p-3 text-right">Yield</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">Cost each</th></tr></thead>
                  <tbody className="divide-y divide-ink/10">
                    {done.map((b) => { const y = b.planned ? Math.round(((b.actual ?? 0) / b.planned) * 1000) / 10 : 0; return (
                      <tr key={b.id}><td className="p-3 font-medium">{b.number}<div className="text-xs font-normal text-ink/60">{b.date}</div></td><td className="p-3">{recipe(b.recipeId)?.name ?? ''}</td><td className="tabular p-3 text-right">{qty(b.planned)}</td><td className="tabular p-3 text-right">{qty(b.actual ?? 0)}</td><td className="tabular p-3 text-right">{qty(b.failed)}</td>
                        <td className="p-3 text-right"><Badge tone={y >= 98 ? 'success' : y >= 90 ? 'warning' : 'danger'}>{y}%</Badge></td><td className="tabular p-3 text-right">{naira(b.ingredientCost ?? 0)}</td><td className="tabular p-3 text-right">{b.unitCost === null ? '–' : naira(b.unitCost)}</td></tr>) })}
                  </tbody>
                </table>
              </Card>
            )}
          </section>

          <section aria-label="Ingredient use">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Ingredients used</h2>
              <Button variant="secondary" disabled={!consumption.size} onClick={() => csv(`ingredients-${from}-to-${to}`, [['Ingredient', 'Quantity', 'Unit', 'Cost'], ...[...consumption].map(([id, v]) => [iName(id), v.qty, iUnit(id), v.cost])])}><Download className="size-4" aria-hidden /> Export CSV</Button></div>
            {consumption.size === 0 ? <Card><EmptyState title="No ingredients used in this period" /></Card> : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Ingredient</th><th className="p-3 text-right">Used</th><th className="p-3 text-right">Cost</th></tr></thead>
                  <tbody className="divide-y divide-ink/10">{[...consumption].sort((a, b) => b[1].cost - a[1].cost).map(([id, v]) => <tr key={id}><td className="p-3 font-medium">{iName(id)}</td><td className="tabular p-3 text-right">{qty(v.qty)} {iUnit(id)}</td><td className="tabular p-3 text-right">{naira(v.cost)}</td></tr>)}</tbody></table>
              </Card>
            )}
          </section>

          <section aria-label="Waste">
            <h2 className="mb-2 text-sm font-semibold">Waste by reason</h2>
            {byReason.size === 0 ? <Card><EmptyState title="No waste recorded in this period" /></Card> : (
              <Card><ul className="divide-y divide-ink/10 text-sm">{[...byReason].sort((a, b) => b[1].loss - a[1].loss).map(([r, v]) => <li key={r} className="flex justify-between py-2"><span>{label(r)} <span className="text-ink/60">({v.n} entr{v.n === 1 ? 'y' : 'ies'})</span></span><b className="tabular">{naira(v.loss)}</b></li>)}</ul>
                <p className="mt-2 text-xs text-ink/60">Losses are estimates at the cost of the item. Failed units inside a production batch are counted in that batch's cost above, not here.</p></Card>
            )}
          </section>

          <section aria-label="Expiry">
            <h2 className="mb-2 text-sm font-semibold">Expired and expiring stock (now)</h2>
            {risky.length === 0 ? <Card><EmptyState title="Nothing is expired or about to expire" /></Card> : (
              <Card><ul className="divide-y divide-ink/10 text-sm">{risky.map((l) => <li key={l.id} className="flex justify-between py-2"><span>{l.productName} <span className="text-ink/60">{l.batchNumber}</span></span><span><Badge tone={l.status === 'expired' ? 'danger' : 'warning'}>{l.status === 'expired' ? 'Expired' : `${l.daysLeft} d left`}</Badge> <b className="tabular">{qty(l.remaining)}</b> left, expires {l.expiresOn}</span></li>)}</ul></Card>
            )}
          </section>
        </div>
      )}
    </>
  )
}
