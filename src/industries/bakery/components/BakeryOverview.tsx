import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Card, EmptyState, ErrorState, SelectField, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira, qty } from '@/shared/utilities/format'
import { loadOverview } from '../services/bakeryApi'
import type { BakeryOverview as Overview } from '../services/bakeryApi'

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

/** Horizontal bars that scale to the biggest value. Plain markup, so it prints and works without a chart library. */
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

function Columns({ days }: { days: { day: string; produced: number; sold: number }[] }) {
  const max = Math.max(...days.flatMap((d) => [d.produced, d.sold]), 0)
  if (!max) return <p className="text-sm text-ink/60">Nothing produced or sold in this period yet.</p>
  return (
    <div>
      <div className="flex h-36 items-end gap-1">
        {days.map((d) => (
          <div key={d.day} className="flex flex-1 items-end justify-center gap-0.5" title={`${d.day}: made ${qty(d.produced)}, sold ${qty(d.sold)}`}>
            <span className="w-full max-w-3 rounded-t bg-amber" style={{ height: `${(d.produced / max) * 100}%` }} />
            <span className="w-full max-w-3 rounded-t bg-brand" style={{ height: `${(d.sold / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <p className="mt-2 flex gap-4 text-xs text-ink/60"><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-amber" /> Made</span><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-brand" /> Sold</span><span className="ml-auto">{days[0]?.day} to {days.at(-1)?.day}</span></p>
    </div>
  )
}

/** The bakery dashboard: everything comes from the records for the chosen period. Money figures show only to roles allowed to read financial reports. */
export function BakeryOverview() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('today')
  const range = () => { const to = new Date(); const from = new Date(); if (period !== 'today') from.setDate(from.getDate() - Number(period) + 1); return { from: iso(from), to: iso(to) } }
  const { from, to } = range()
  const data = useAsync(() => loadOverview(businessId, from, to), [businessId, from, to])
  if (!active) return null
  const o: Overview | null = data.data
  const f = o?.financial ?? null
  const empty = !!o && o.salesCount === 0 && o.batchesCompleted === 0 && o.wasteRecords === 0

  return (
    <div className="space-y-4">
      <div className="max-w-xs"><SelectField label="Period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField></div>
      {data.error && <ErrorState message={data.error} />}
      {data.loading && !o ? <Spinner /> : !o ? null : (
        <>
          {empty && <Card><EmptyState title="Nothing recorded in this period" description="Record a production batch and a sale and the figures appear here. Nothing on this page is estimated from sample numbers." /></Card>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {f && <Kpi title="Net sales" value={naira(f.netSales)} note={`${o.salesCount} sale${o.salesCount === 1 ? '' : 's'}, after discounts, tax and refunds`} />}
            {f && <Kpi title="Cost of goods sold" value={naira(f.cogs)} note="Units sold at the cost they left stock at" />}
            {f && <Kpi title="Gross profit" value={naira(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} note={f.grossMarginPercent === null ? 'No sales yet' : `${f.grossMarginPercent}% margin`} />}
            {f && <Kpi title="Operating expenses" value={naira(f.operatingExpenses)} note="Recorded expenses (ingredients are stock, not expenses)" />}
            {f && <Kpi title="Operating profit (estimate)" value={naira(f.operatingProfitEstimate)} tone={f.operatingProfitEstimate >= 0 ? 'good' : 'bad'} note="Not accounting profit: excludes tax, depreciation and unrecorded costs" />}
            {f && <Kpi title="Owed by customers" value={naira(f.outstandingBalances)} note="All open credit sales" />}
            <Kpi title="Sales" value={String(o.salesCount)} note="Transactions" />
            <Kpi title="Units produced" value={qty(o.unitsProduced)} note={`${o.batchesCompleted} batch${o.batchesCompleted === 1 ? '' : 'es'}${o.failedUnits ? `, ${qty(o.failedUnits)} failed` : ''}`} to="/app/bakery/production" />
            <Kpi title="Units sold" value={qty(o.unitsSold)} />
            <Kpi title="Waste recorded" value={String(o.wasteRecords)} note={f ? `Estimated loss ${naira(f.wasteLoss)}` : 'Entries'} to="/app/bakery/waste" />
            <Kpi title="Low-stock ingredients" value={String(o.lowStockIngredients)} tone={o.lowStockIngredients ? 'warn' : undefined} to="/app/bakery/ingredients" />
            <Kpi title="Stock expiring or expired" value={`${o.expiringLots} / ${o.expiredLots}`} tone={o.expiredLots ? 'bad' : o.expiringLots ? 'warn' : undefined} note="Expiring soon / already expired" to="/app/bakery/finished-goods" />
          </div>
          {o.openBatches > 0 && <Card><p className="text-sm"><b>{o.openBatches}</b> production batch{o.openBatches === 1 ? ' is' : 'es are'} planned or in progress. <Link className="font-semibold underline" to="/app/bakery/production">Open production</Link></p></Card>}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card><h3 className="mb-3 text-sm font-semibold">Made versus sold</h3><Columns days={o.productionVsSales} /></Card>
            <Card><h3 className="mb-3 text-sm font-semibold">Best sellers</h3>{o.bestSellers.length ? <Bars rows={o.bestSellers.map((b) => ({ name: b.product, value: b.units }))} format={qty} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>
            <Card><h3 className="mb-3 text-sm font-semibold">Net sales by day</h3>{o.daily.length ? <Bars rows={o.daily.map((d) => ({ name: d.day, value: d.netSales }))} format={naira} /> : <p className="text-sm text-ink/60">No sales in this period.</p>}</Card>
            {f && <Card><h3 className="mb-3 text-sm font-semibold">Sales by payment method</h3>{f.paymentMethods.length ? <Bars rows={f.paymentMethods.map((p) => ({ name: label(p.method), value: p.amount }))} format={naira} /> : <p className="text-sm text-ink/60">No payments in this period.</p>}</Card>}
          </div>
        </>
      )}
    </div>
  )
}
