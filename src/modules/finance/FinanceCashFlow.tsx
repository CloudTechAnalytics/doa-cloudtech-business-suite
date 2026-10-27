import clsx from 'clsx'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, Notice, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { label, naira } from '@/shared/utilities/format'
import { PRESETS, periodFor } from './expenseLogic'
import type { Preset } from './expenseLogic'
import { cashFlowExport, flowLabel, reconciles } from './financeLogic'
import { cashFlow } from './financeApi'

const today = () => new Date().toISOString().slice(0, 10)
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })

function Tile({ title, value, tone, note }: { title: string; value: string; tone?: 'good' | 'bad'; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{title}</p>
      <p className={clsx('tabular mt-1 text-xl font-semibold', tone === 'good' && 'text-success', tone === 'bad' && 'text-danger')}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink/60">{note}</p>}
    </div>
  )
}
function Bars({ rows, tone }: { rows: { key: string; name: string; total: number }[]; tone: string }) {
  const top = Math.max(...rows.map((r) => r.total), 0)
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(8rem,12rem)_1fr_7rem] items-center gap-3">
          <span className="truncate">{r.name}</span>
          <span className="h-2 rounded-full bg-canvas"><span className={clsx('block h-2 rounded-full', tone)} style={{ width: `${top ? Math.max((r.total / top) * 100, 2) : 0}%` }} /></span>
          <span className="tabular text-right">{naira(r.total)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cash flow for a period: where you started, what came in and went out and from where, and where you ended, with the balance in each way of paying and what invoices are expected to bring.
 * It is cash basis (money that actually moved), so it is not profit.
 */
export function CashFlowTab({ businessId }: { businessId: string }) {
  const [period, setPeriod] = useState(() => periodFor('this_month', today()))
  const [preset, setPreset] = useState<Preset | 'custom'>('this_month')
  const flow = useAsync(() => cashFlow(businessId, period.from, period.to), [businessId, period.from, period.to])
  const r = flow.data
  const pick = (p: Preset) => { setPreset(p); setPeriod(periodFor(p, today())) }
  const net = r ? Math.round((r.inTotal - r.outTotal) * 100) / 100 : 0
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PRESETS.map((p) => <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => pick(p.key)} className={`rounded-full border px-3 py-1.5 text-sm ${preset === p.key ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-surface'}`}>{p.label}</button>)}
        </div>
        <div className="w-40"><TextField label="From" type="date" value={period.from} max={period.to} onChange={(e) => { setPreset('custom'); setPeriod({ ...period, from: e.target.value }) }} /></div>
        <div className="w-40"><TextField label="To" type="date" value={period.to} min={period.from} max={today()} onChange={(e) => { setPreset('custom'); setPeriod({ ...period, to: e.target.value }) }} /></div>
        {r && <Button variant="secondary" className="ml-auto" onClick={() => downloadCsv(`cash-flow-${period.from}-to-${period.to}.csv`, cashFlowExport(r))}><Download className="size-4" aria-hidden /> Export (CSV)</Button>}
      </div>
      {flow.error && <ErrorState message={flow.error} />}
      {flow.loading && !r ? <Spinner /> : !r ? null : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile title="Opening balance" value={naira(r.opening)} note={`On ${period.from}`} />
            <Tile title="Money in" value={naira(r.inTotal)} tone="good" />
            <Tile title="Money out" value={naira(r.outTotal)} tone="bad" />
            <Tile title="Closing balance" value={naira(r.closing)} note={`${net >= 0 ? 'Up' : 'Down'} ${naira(Math.abs(net))} in the period`} />
          </div>
          {!reconciles(r).ok && <ErrorState title="These figures do not add up" message={`Opening plus money in less money out should be ${naira(reconciles(r).expected)}, but the closing balance is ${naira(r.closing)}. Please tell support.`} />}
          {r.inTotal === 0 && r.outTotal === 0 ? <Card><EmptyState title="No money moved in this period" description="Payments received, supplier payments, refunds and expenses appear here as they are recorded." /></Card> : (
            <>
              {r.byMonth.length > 1 && (
                <Card><h3 className="mb-3 text-sm font-semibold">By month</h3>
                  <table className="w-full text-sm"><thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1">Month</th><th className="py-1 text-right">Money in</th><th className="py-1 text-right">Money out</th><th className="py-1 text-right">Net</th></tr></thead>
                    <tbody className="divide-y divide-ink/10">{r.byMonth.map((m) => { const x = Math.round((m.in - m.out) * 100) / 100; return <tr key={m.month}><td className="py-1.5">{monthLabel(m.month)}</td><td className="tabular py-1.5 text-right text-success">{naira(m.in)}</td><td className="tabular py-1.5 text-right text-danger">{naira(m.out)}</td><td className={clsx('tabular py-1.5 text-right font-medium', x < 0 && 'text-danger')}>{naira(x)}</td></tr> })}</tbody></table>
                </Card>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Card><h3 className="mb-3 text-sm font-semibold">Where money came from</h3>{r.inByKind.length ? <Bars tone="bg-success" rows={r.inByKind.map((k) => ({ key: k.kind, name: flowLabel(k.kind), total: k.total }))} /> : <p className="text-sm text-ink/60">Nothing came in.</p>}</Card>
                <Card><h3 className="mb-3 text-sm font-semibold">Where money went</h3>{r.outByKind.length ? <Bars tone="bg-danger" rows={r.outByKind.map((k) => ({ key: `${k.kind}${k.category ?? ''}`, name: flowLabel(k.kind, k.category), total: k.total }))} /> : <p className="text-sm text-ink/60">Nothing went out.</p>}</Card>
              </div>
            </>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Card><h3 className="mb-1 text-sm font-semibold">Where the money is</h3><p className="mb-3 text-xs text-ink/60">Balance in each way of paying, to the end of the period.</p>
              {r.byMethod.length ? <ul className="divide-y divide-ink/10 text-sm">{r.byMethod.map((m) => <li key={m.method} className="flex justify-between py-1.5"><span>{label(m.method)}</span><b className={clsx('tabular', m.balance < 0 && 'text-danger')}>{naira(m.balance)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No money recorded yet.</p>}
            </Card>
            <Card><h3 className="mb-1 text-sm font-semibold">Expected from invoices</h3><p className="mb-3 text-xs text-ink/60">What is still owed on sent invoices, after credit notes and payments.</p>
              <ul className="divide-y divide-ink/10 text-sm">
                <li className="flex justify-between py-1.5"><span>Overdue</span><b className={clsx('tabular', r.expected.overdue > 0 && 'text-danger')}>{naira(r.expected.overdue)}</b></li>
                <li className="flex justify-between py-1.5"><span>Due in the next 30 days</span><b className="tabular">{naira(r.expected.due30)}</b></li>
                <li className="flex justify-between py-1.5"><span>No due date</span><b className="tabular">{naira(r.expected.noDate)}</b></li>
              </ul>
            </Card>
          </div>
          <Notice>This is cash basis: money that actually moved. It is not profit, because it leaves out stock bought but not yet sold, unpaid invoices and bills, and depreciation.</Notice>
        </div>
      )}
    </>
  )
}
