import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { label, naira } from '@/shared/utilities/format'
import { PRESETS, periodFor, reportExport } from './expenseLogic'
import type { Preset } from './expenseLogic'
import { expenseReport } from './financeApi'

const today = () => new Date().toISOString().slice(0, 10)
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })

function Bars({ rows, name }: { rows: { key: string; total: number }[]; name: (k: string) => string }) {
  const top = Math.max(...rows.map((r) => r.total), 0)
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3">
          <span className="truncate">{name(r.key)}</span>
          <span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-accent" style={{ width: `${top ? Math.max((r.total / top) * 100, 2) : 0}%` }} /></span>
          <span className="tabular text-right">{naira(r.total)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Where the money went in a period, worked out on the server from posted expenses (voided ones are left out). */
export function ReportTab({ businessId }: { businessId: string }) {
  const [period, setPeriod] = useState(() => periodFor('this_month', today()))
  const [preset, setPreset] = useState<Preset | 'custom'>('this_month')
  const report = useAsync(() => expenseReport(businessId, period.from, period.to), [businessId, period.from, period.to])
  const r = report.data
  const pick = (p: Preset) => { setPreset(p); setPeriod(periodFor(p, today())) }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PRESETS.map((p) => <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => pick(p.key)} className={`rounded-full border px-3 py-1.5 text-sm ${preset === p.key ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-surface'}`}>{p.label}</button>)}
        </div>
        <div className="w-40"><TextField label="From" type="date" value={period.from} max={period.to} onChange={(e) => { setPreset('custom'); setPeriod({ ...period, from: e.target.value }) }} /></div>
        <div className="w-40"><TextField label="To" type="date" value={period.to} min={period.from} max={today()} onChange={(e) => { setPreset('custom'); setPeriod({ ...period, to: e.target.value }) }} /></div>
        {r && r.count > 0 && <Button variant="secondary" className="ml-auto" onClick={() => downloadCsv(`expense-report-${period.from}-to-${period.to}.csv`, reportExport(r))}><Download className="size-4" aria-hidden /> Export (CSV)</Button>}
      </div>
      {report.error && <ErrorState message={report.error} />}
      {report.loading && !r ? <Spinner /> : !r ? null : r.count === 0 ? <Card><EmptyState title="No expenses in this period" description="Try a longer period." /></Card> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {([['Total spent', naira(r.total)], ['Entries', String(r.count)], ['Average entry', naira(r.total / r.count)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-white p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{k}</p><p className="tabular mt-1 text-xl font-semibold">{v}</p></div>
            ))}
          </div>
          <Card><h3 className="mb-3 text-sm font-semibold">By category</h3>
            <ul className="space-y-2 text-sm">
              {r.byCategory.map((c) => (
                <li key={c.category} className="grid grid-cols-[9rem_1fr_7rem_3.5rem] items-center gap-3">
                  <span className="truncate">{label(c.category)}</span>
                  <span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.max((c.total / r.byCategory[0].total) * 100, 2)}%` }} /></span>
                  <span className="tabular text-right">{naira(c.total)}</span>
                  <span className="tabular text-right text-xs text-ink/60">{r.total ? Math.round((c.total / r.total) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </Card>
          {r.byMonth.length > 1 && <Card><h3 className="mb-3 text-sm font-semibold">By month</h3><Bars rows={r.byMonth.map((m) => ({ key: m.month, total: m.total }))} name={monthLabel} /></Card>}
          <div className="grid gap-4 md:grid-cols-2">
            <Card><h3 className="mb-3 text-sm font-semibold">By how it was paid</h3><Bars rows={r.byMethod.map((m) => ({ key: m.method, total: m.total }))} name={label} /></Card>
            {r.bySupplier.length > 0 && <Card><h3 className="mb-3 text-sm font-semibold">Top suppliers</h3><Bars rows={r.bySupplier.map((s) => ({ key: s.supplier, total: s.total }))} name={(k) => k} /></Card>}
          </div>
        </div>
      )}
    </>
  )
}
