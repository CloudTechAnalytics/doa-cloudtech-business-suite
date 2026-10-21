import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Card, EmptyState, ErrorState, SelectField, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira, qty } from '@/shared/utilities/format'
import { loadOverview } from '../services/martApi'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const PERIODS = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']] as const

function Kpi({ title, value, note, tone, to }: { title: string; value: string; note?: string; tone?: 'good' | 'bad' | 'warn'; to?: string }) {
  const body = (
    <Card className={to ? 'h-full transition hover:shadow-raised' : 'h-full'}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink/60">{title}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : ''}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink/60">{note}</p>}
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function Bars({ rows, format }: { rows: { name: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3">
          <span className="truncate">{r.name}</span>
          <span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-amber" style={{ width: `${max ? Math.max((r.value / max) * 100, 2) : 0}%` }} /></span>
          <span className="tabular text-right">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** The mart dashboard. Everything comes from the records for the chosen period; money figures show only to roles that may read financial reports. */
export function MartOverview() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('today')
  const to = new Date(); const from = new Date(); if (period !== 'today') from.setDate(from.getDate() - Number(period) + 1)
  const data = useAsync(() => loadOverview(businessId, iso(from), iso(to)), [businessId, period])
  if (!active) return null
  const o = data.data; const f = o?.financial ?? null

  return (
    <div className="space-y-4">
      <div className="max-w-xs"><SelectField label="Period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField></div>
      {data.error && <ErrorState message={data.error} />}
      {data.loading && !o ? <Spinner /> : !o ? null : (
        <>
          {o.transactions === 0 && <Card><EmptyState title="No sales in this period" description="Ring up a sale at the till and the figures appear here. Nothing on this page is estimated from sample numbers." /></Card>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {f && <Kpi title="Net sales" value={naira(f.netSales)} note={`${o.transactions} sale${o.transactions === 1 ? '' : 's'}, after discounts, tax and refunds`} />}
            {f && <Kpi title="Cost of goods sold" value={naira(f.cogs)} note="Units sold at the cost they left stock at" />}
            {f && <Kpi title="Gross profit" value={naira(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} note={f.grossMarginPercent === null ? 'No sales yet' : `${f.grossMarginPercent}% margin`} />}
            {f && <Kpi title="Operating profit (estimate)" value={naira(f.operatingProfitEstimate)} tone={f.operatingProfitEstimate >= 0 ? 'good' : 'bad'} note={`After expenses of ${naira(f.operatingExpenses)}; stock purchases are not expenses`} />}
            <Kpi title="Transactions" value={String(o.transactions)} note={o.avgTransaction === null ? undefined : `Average ${naira(o.avgTransaction)}`} to="/app/sales" />
            <Kpi title="Units sold" value={qty(o.unitsSold)} />
            {f && <Kpi title="Stock value" value={naira(f.inventoryValue)} note="On hand at average cost" to="/app/retail/products" />}
            {f && <Kpi title="Owed to suppliers" value={naira(f.supplierBalances)} note={`Owed by customers ${naira(f.customerBalances)}`} />}
            <Kpi title="Low stock" value={`${o.lowStock} / ${o.outOfStock}`} tone={o.outOfStock ? 'bad' : o.lowStock ? 'warn' : undefined} note="Low / out of stock" to="/app/retail/products" />
            <Kpi title="Expiring or expired" value={`${o.expiringLots} / ${o.expiredLots}`} tone={o.expiredLots ? 'bad' : o.expiringLots ? 'warn' : undefined} note="Within 7 days / already expired" to="/app/retail/products" />
            <Kpi title="Open shifts" value={String(o.openShifts)} to="/app/retail/shifts" />
            {f && <Kpi title="Cash variance (shifts)" value={naira(f.shiftVariance)} tone={f.shiftVariance === 0 ? undefined : 'warn'} note="Counted less expected, closed shifts" to="/app/retail/shifts" />}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card><h3 className="mb-3 text-sm font-semibold">Net sales by day</h3>{o.daily.length ? <Bars rows={o.daily.map((d) => ({ name: d.day, value: d.netSales }))} format={naira} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>
            <Card><h3 className="mb-3 text-sm font-semibold">Best sellers</h3>{o.bestSellers.length ? <Bars rows={o.bestSellers.map((b) => ({ name: b.product, value: b.units }))} format={qty} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>
            {f && <Card><h3 className="mb-3 text-sm font-semibold">Sales by category</h3>{f.byCategory.length ? <Bars rows={f.byCategory.map((c) => ({ name: c.category, value: c.revenue }))} format={naira} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>}
            {f && <Card><h3 className="mb-3 text-sm font-semibold">Payment methods</h3>{f.paymentMethods.length ? <Bars rows={f.paymentMethods.map((p) => ({ name: label(p.method), value: p.amount }))} format={naira} /> : <p className="text-sm text-ink/60">No payments in this period.</p>}</Card>}
            {f && <Card><h3 className="mb-3 text-sm font-semibold">Sales by cashier</h3>{f.byCashier.length ? <Bars rows={f.byCashier.map((c) => ({ name: c.cashier, value: c.netSales }))} format={naira} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Slow movers (no sales in 30 days)</h3>
              {o.slowMovers.length ? <ul className="divide-y divide-ink/10 text-sm">{o.slowMovers.map((s) => <li key={s.product} className="flex justify-between py-1.5"><span>{s.product}</span><span className="tabular text-ink/70">{qty(s.onHand)} · {naira(s.value)}</span></li>)}</ul> : <p className="text-sm text-ink/60">None.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
