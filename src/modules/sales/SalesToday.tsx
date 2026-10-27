import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import { useState } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Button, Card, ErrorState, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { printSheets } from '@/shared/print/printSheets'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { label, naira, qty } from '@/shared/utilities/format'
import { daySummary, listCustomers, listSales } from './tradeApi'
import type { DaySummary } from './tradeApi'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (day: string, by: number) => localDay(new Date(new Date(`${day}T12:00:00`).getTime() + by * 86400000))
const pretty = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** What a shop owner prints at closing time: the day's sales, what came back, what was collected and how, who sold, the best sellers, and what is still owed. */
export function DaySheet({ s, business }: { s: DaySummary; business: string }) {
  const net = s.gross - s.returns
  return (
    <article className="receipt-sheet mx-auto max-w-[150mm] rounded-lg border border-line bg-white p-6 text-[13px] leading-snug text-ink shadow-card" aria-label={`End of day ${s.day}`}>
      <header className="border-b-4 border-double border-ink/70 pb-2 text-center"><h1 className="text-xl font-extrabold uppercase tracking-wide">{business}</h1><p className="text-xs font-semibold uppercase tracking-[0.2em]">End of day</p><p className="text-sm">{pretty(s.day)}</p></header>
      <dl className="mt-3 space-y-1">
        {([['Sales made', String(s.salesCount)], ['Sales total', naira(s.gross)], ['Discounts given', naira(s.discounts)], ['Tax charged', naira(s.tax)], ['Returns', `− ${naira(s.returns)}`], ['Net sales', naira(net)], ['Still owed on these sales', naira(s.outstanding)], ['Voided sales', `${s.voidedCount} (${naira(s.voidedTotal)})`]] as const).map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-dotted border-ink/30 pb-0.5"><dt>{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
      </dl>
      <h2 className="mt-3 text-xs font-bold uppercase tracking-wide">Money received today</h2>
      {s.byMethod.length ? <ul>{s.byMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{label(m.method)}</span><b>{naira(m.amount)}</b></li>)}<li className="mt-1 flex justify-between border-t border-ink/50 pt-1 font-bold"><span>Total received</span><span>{naira(s.byMethod.reduce((a, m) => a + m.amount, 0))}</span></li></ul> : <p className="text-ink/60">No money received.</p>}
      {s.byCashier.length > 0 && <><h2 className="mt-3 text-xs font-bold uppercase tracking-wide">By cashier</h2><ul>{s.byCashier.map((c) => <li key={c.cashier} className="flex justify-between"><span>{c.cashier} ({c.sales})</span><b>{naira(c.total)}</b></li>)}</ul></>}
      {s.topProducts.length > 0 && <><h2 className="mt-3 text-xs font-bold uppercase tracking-wide">Best sellers</h2><ul>{s.topProducts.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name} ({qty(p.quantity)})</span><b>{naira(p.total)}</b></li>)}</ul></>}
      <footer className="mt-8 grid grid-cols-2 gap-8 text-center text-[11px]"><div className="border-t border-ink/70 pt-1">Prepared by</div><div className="border-t border-ink/70 pt-1">Checked by</div></footer>
    </article>
  )
}

/** The Today tab: pick a day (today to begin with) and see how it went. */
export function SalesToday({ businessId }: { businessId: string }) {
  const { active } = useBusiness()
  const [day, setDay] = useState(localDay())
  const data = useAsync(() => daySummary(businessId, day), [businessId, day])
  const s = data.data
  const exportDay = async () => {
    const [sales, customers] = await Promise.all([listSales(businessId, { from: day, to: day }), listCustomers(businessId).catch(() => [])])
    downloadCsv(`sales-${day}.csv`, [['Sale', 'Time', 'Customer', 'Total', 'Paid', 'Balance', 'Status'], ...sales.map((x) => [x.number, x.soldAt, customers.find((c) => c.id === x.customerId)?.name ?? 'Walk-in', x.grandTotal, x.amountPaid, x.balanceDue, x.status])])
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Button variant="secondary" aria-label="Previous day" onClick={() => setDay(shift(day, -1))}><ChevronLeft className="size-4" aria-hidden /></Button>
        <div className="w-44"><TextField label="Day" type="date" value={day} max={localDay()} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
        <Button variant="secondary" aria-label="Next day" disabled={day >= localDay()} onClick={() => setDay(shift(day, 1))}><ChevronRight className="size-4" aria-hidden /></Button>
        {day !== localDay() && <Button variant="secondary" onClick={() => setDay(localDay())}>Today</Button>}
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void exportDay()}><Download className="size-4" aria-hidden /> Export sales</Button>
          <Button variant="secondary" disabled={!s} onClick={() => s && printSheets(<DaySheet s={s} business={active?.name ?? ''} />)}><Printer className="size-4" aria-hidden /> Print summary</Button>
        </span>
      </div>
      <p className="mb-3 text-sm font-medium text-ink/70">{pretty(day)}</p>
      {data.error && <ErrorState message={data.error} />}
      {data.loading && !s ? <Spinner /> : s && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([['Sales', String(s.salesCount), s.salesCount === 1 ? '1 sale' : `${s.salesCount} sales`], ['Sales total', naira(s.gross), s.discounts > 0 ? `${naira(s.discounts)} discounts given` : 'Before returns'], ['Returns', naira(s.returns), 'Handed back today'], ['Net sales', naira(s.gross - s.returns), 'Sales less returns']] as const).map(([t, v, h]) => (
              <div key={t} className="rounded-lg border border-line bg-white p-3"><p className="text-xs uppercase tracking-wide text-ink/60">{t}</p><p className="mt-0.5 text-xl font-bold">{v}</p><p className="text-xs text-ink/60">{h}</p></div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><h3 className="mb-2 text-sm font-semibold">Money received</h3>
              {s.byMethod.length === 0 ? <p className="text-sm text-ink/60">Nothing received on this day.</p> : <ul className="space-y-1 text-sm">{s.byMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{label(m.method)}</span><b className="tabular">{naira(m.amount)}</b></li>)}<li className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="tabular">{naira(s.byMethod.reduce((a, m) => a + m.amount, 0))}</span></li></ul>}
              <p className="mt-3 text-xs text-ink/60">Money that came in today, including payments on earlier sales, less refunds paid out.</p>
              {s.outstanding > 0 && <p className="mt-2 text-sm text-warning">{naira(s.outstanding)} still owed on today&apos;s sales.</p>}
              {s.voidedCount > 0 && <p className="mt-1 text-sm text-ink/70">{s.voidedCount} voided ({naira(s.voidedTotal)}), not counted above.</p>}
            </Card>
            <Card><h3 className="mb-2 text-sm font-semibold">By cashier</h3>
              {s.byCashier.length === 0 ? <p className="text-sm text-ink/60">No sales.</p> : <ul className="space-y-1 text-sm">{s.byCashier.map((c) => <li key={c.cashier} className="flex justify-between"><span>{c.cashier} <span className="text-ink/50">({c.sales})</span></span><b className="tabular">{naira(c.total)}</b></li>)}</ul>}
            </Card>
            <Card className="lg:col-span-2"><h3 className="mb-2 text-sm font-semibold">Best sellers</h3>
              {s.topProducts.length === 0 ? <p className="text-sm text-ink/60">No sales.</p> : <ul className="space-y-1 text-sm">{s.topProducts.map((p) => <li key={p.name} className="flex justify-between gap-2"><span>{p.name} <span className="text-ink/50">× {qty(p.quantity)}</span></span><b className="tabular">{naira(p.total)}</b></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
