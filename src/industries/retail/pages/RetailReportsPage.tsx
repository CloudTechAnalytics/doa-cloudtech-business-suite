import { Download } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira, qty } from '@/shared/utilities/format'
import { toCsv } from '../csv'
import { loadLosses, loadLots, loadOverview, loadProducts } from '../services/martApi'

const iso = (d: Date) => d.toISOString().slice(0, 10)

function download(name: string, rows: (string | number)[][]) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href)
}
function Figure({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return <Card><p className="text-xs font-medium uppercase tracking-wide text-ink/60">{title}</p><p className={`tabular mt-2 text-2xl font-semibold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>{note && <p className="mt-1 text-xs text-ink/60">{note}</p>}</Card>
}
function Section({ title, onExport, children }: { title: string; onExport?: () => void; children: React.ReactNode }) {
  return <section aria-label={title}><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{onExport && <Button variant="secondary" onClick={onExport}><Download className="size-4" aria-hidden /> Export CSV</Button>}</div>{children}</section>
}

/** Sales, profit, stock value, slow movers, expiry, losses, balances and cash variance for a period. Every figure is worked out from the records. */
export function RetailReportsPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return iso(d) })
  const [to, setTo] = useState(() => iso(new Date()))
  const valid = from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000
  const overview = useAsync(() => (valid ? loadOverview(businessId, from, to) : Promise.reject(new Error('Choose a period of up to a year, starting before it ends.'))), [businessId, from, to, valid])
  const products = useAsync(() => loadProducts(businessId), [businessId])
  const lots = useAsync(() => loadLots(businessId), [businessId])
  const losses = useAsync(() => loadLosses(businessId), [businessId])
  if (!active) return null
  const o = overview.data; const f = o?.financial ?? null
  const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to
  const lossRows = (losses.data ?? []).filter((l) => l.status === 'posted' && inRange(l.createdAt))
  const lossTotal = lossRows.reduce((a, l) => a + Math.round(l.loss * 100), 0) / 100
  const risky = (lots.data ?? []).filter((l) => l.status === 'expired' || l.status === 'expiring')
  const stock = (products.data ?? []).filter((p) => p.active)

  return (
    <>
      <PageHeader title="Mart reports" description="Sales, profit, stock and cash for a period. Figures come from the recorded transactions, so they match what you see on each screen." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44"><TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><TextField label="To" type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {overview.error && <ErrorState message={overview.error} />}
      {overview.loading && !o ? <Spinner /> : o && (
        <div className="space-y-6">
          {f ? (
            <section aria-label="Sales and profit">
              <h2 className="mb-2 text-sm font-semibold">Sales and profit</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure title="Net sales" value={naira(f.netSales)} note={`${o.transactions} sales; discounts ${naira(f.discounts)}, refunds ${naira(f.refunds)}`} />
                <Figure title="Cost of goods sold" value={naira(f.cogs)} />
                <Figure title="Gross profit" value={naira(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} note={f.grossMarginPercent === null ? undefined : `${f.grossMarginPercent}% margin`} />
                <Figure title="Operating profit (estimate)" value={naira(f.operatingProfitEstimate)} tone={f.operatingProfitEstimate >= 0 ? 'good' : 'bad'} note={`After expenses of ${naira(f.operatingExpenses)} and stock lost of ${naira((f.stockWriteOffs ?? 0) - (f.countDifference ?? 0))}`} />
                <Figure title="Stock lost" value={naira((f.stockWriteOffs ?? 0) - (f.countDifference ?? 0))} note={`Written off ${naira(f.stockWriteOffs ?? 0)}; counts ${(f.countDifference ?? 0) < 0 ? 'found short' : 'found extra'} ${naira(Math.abs(f.countDifference ?? 0))}`} />
                <Figure title="Stock value (now)" value={naira(f.inventoryValue)} note="On hand at average cost" />
                <Figure title="Owed to suppliers (now)" value={naira(f.supplierBalances)} />
                <Figure title="Owed by customers (now)" value={naira(f.customerBalances)} />
                <Figure title="Cash variance" value={naira(f.shiftVariance)} note="Counted less expected, shifts closed in this period" />
              </div>
              <Notice>Net sales = sales less discounts, tax and refunds. Gross profit = net sales less cost of goods sold, using the cost recorded at the time of each sale. Operating profit = gross profit less recorded expenses. It is an estimate: tax, depreciation and unrecorded costs are not included, and stock purchases are not expenses.</Notice>
            </section>
          ) : <Notice>Profit, stock value and balances are shown to roles that may read financial reports.</Notice>}

          <Section title="Best sellers" onExport={o.bestSellers.length ? () => download(`best-sellers-${from}-to-${to}`, [['Product', 'Units', 'Revenue'], ...o.bestSellers.map((b) => [b.product, b.units, b.revenue])]) : undefined}>
            {o.bestSellers.length === 0 ? <Card><EmptyState title="No sales in this period" /></Card> : <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3 text-right">Units</th><th className="p-3 text-right">Revenue</th></tr></thead><tbody className="divide-y divide-ink/10">{o.bestSellers.map((b) => <tr key={b.product}><td className="p-3 font-medium">{b.product}</td><td className="tabular p-3 text-right">{qty(b.units)}</td><td className="tabular p-3 text-right">{naira(b.revenue)}</td></tr>)}</tbody></table></Card>}
          </Section>

          {f && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Section title="By category" onExport={f.byCategory.length ? () => download(`sales-by-category-${from}-to-${to}`, [['Category', 'Units', 'Revenue'], ...f.byCategory.map((c) => [c.category, c.units, c.revenue])]) : undefined}>
                <Card>{f.byCategory.length ? <ul className="divide-y divide-ink/10 text-sm">{f.byCategory.map((c) => <li key={c.category} className="flex justify-between py-1.5"><span>{c.category}</span><b className="tabular">{naira(c.revenue)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No sales.</p>}</Card>
              </Section>
              <Section title="By cashier" onExport={f.byCashier.length ? () => download(`sales-by-cashier-${from}-to-${to}`, [['Cashier', 'Sales', 'Net sales'], ...f.byCashier.map((c) => [c.cashier, c.sales, c.netSales])]) : undefined}>
                <Card>{f.byCashier.length ? <ul className="divide-y divide-ink/10 text-sm">{f.byCashier.map((c) => <li key={c.cashier} className="flex justify-between py-1.5"><span>{c.cashier} <span className="text-ink/60">({c.sales})</span></span><b className="tabular">{naira(c.netSales)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No sales.</p>}</Card>
              </Section>
              <Section title="By payment method">
                <Card>{f.paymentMethods.length ? <ul className="divide-y divide-ink/10 text-sm">{f.paymentMethods.map((p) => <li key={p.method} className="flex justify-between py-1.5"><span>{label(p.method)}</span><b className="tabular">{naira(p.amount)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No payments.</p>}</Card>
              </Section>
            </div>
          )}

          <Section title="Inventory valuation (now)" onExport={stock.length ? () => download('inventory-valuation', [['Product', 'Category', 'On hand', 'Unit', 'Average cost', 'Value'], ...stock.map((p) => [p.name, p.categoryName ?? '', p.onHand, p.unit, p.avgCost ?? p.costPrice ?? '', p.stockValue])]) : undefined}>
            {stock.length === 0 ? <Card><EmptyState title="No products" /></Card> : <Card className="max-h-80 overflow-auto p-0"><table className="w-full text-sm"><thead className="sticky top-0 bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Product</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Average cost</th><th className="p-3 text-right">Value</th></tr></thead><tbody className="divide-y divide-ink/10">{stock.map((p) => <tr key={p.id}><td className="p-3">{p.name}{p.out && <> <Badge tone="danger">Out</Badge></>}{p.low && <> <Badge tone="warning">Low</Badge></>}</td><td className="tabular p-3 text-right">{qty(p.onHand)} {p.unit}</td><td className="tabular p-3 text-right">{p.avgCost === null ? '–' : naira(p.avgCost)}</td><td className="tabular p-3 text-right">{naira(p.stockValue)}</td></tr>)}</tbody></table></Card>}
          </Section>

          <Section title="Slow movers (no sales in 30 days)" onExport={o.slowMovers.length ? () => download('slow-movers', [['Product', 'On hand', 'Value'], ...o.slowMovers.map((s) => [s.product, s.onHand, s.value])]) : undefined}>
            {o.slowMovers.length === 0 ? <Card><EmptyState title="Everything in stock has sold recently" /></Card> : <Card><ul className="divide-y divide-ink/10 text-sm">{o.slowMovers.map((s) => <li key={s.product} className="flex justify-between py-1.5"><span>{s.product}</span><span className="tabular text-ink/70">{qty(s.onHand)} on hand · {naira(s.value)}</span></li>)}</ul></Card>}
          </Section>

          <Section title="Expired and expiring stock (now)">
            {risky.length === 0 ? <Card><EmptyState title="Nothing is expired or about to expire" /></Card> : <Card><ul className="divide-y divide-ink/10 text-sm">{risky.map((l) => <li key={l.id} className="flex justify-between py-2"><span>{l.productName} <span className="text-ink/60">{l.batchNumber}</span></span><span><Badge tone={l.status === 'expired' ? 'danger' : 'warning'}>{l.status === 'expired' ? 'Expired' : `${l.daysLeft} d left`}</Badge> <b className="tabular">{qty(l.remaining)}</b> left, expires {l.expiresOn}</span></li>)}</ul></Card>}
          </Section>

          <Section title="Damaged, expired and missing stock" onExport={lossRows.length ? () => download(`losses-${from}-to-${to}`, [['Entry', 'Date', 'Product', 'Quantity', 'Reason', 'Estimated loss'], ...lossRows.map((l) => [l.number, l.createdAt.slice(0, 10), products.data?.find((p) => p.id === l.productId)?.name ?? '', l.quantity, l.reason, l.loss])]) : undefined}>
            {lossRows.length === 0 ? <Card><EmptyState title="No losses recorded in this period" /></Card> : <Card><p className="text-sm">{lossRows.length} entr{lossRows.length === 1 ? 'y' : 'ies'}, estimated loss <b className="tabular">{naira(lossTotal)}</b>. Estimates use the cost of the stock at the time.</p></Card>}
          </Section>
        </div>
      )}
    </>
  )
}
