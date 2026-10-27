import clsx from 'clsx'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { CashbookPage } from './CashbookPage'
import { CashFlowTab } from './FinanceCashFlow'
import { PayablesPage, ReceivablesPage } from './OwedPages'
import { reportSummary } from './financeApi'

/** Which part is open is in the address (?tab=cashflow), so the sidebar, the tabs and the back button agree. */
const TABS = [['overview', 'Overview'], ['cashflow', 'Cash flow'], ['cashbook', 'Cashbook'], ['owed', 'Owed to you'], ['bills', 'You owe']] as const

const iso = (d: Date) => d.toISOString().slice(0, 10)

function Figure({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink/60">{title}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink/60">{note}</p>}
    </Card>
  )
}

/** One screen of financial figures for a period, computed on the server from the ledgers. */
function Overview({ businessId }: { businessId: string }) {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return iso(d) })
  const [to, setTo] = useState(() => iso(new Date()))
  const report = useAsync(() => reportSummary(businessId, from, to), [businessId, from, to])
  const r = report.data
  const cats = Object.entries(r?.expensesByCategory ?? {}).sort((a, b) => b[1] - a[1])
  const top = cats[0]?.[1] ?? 0

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44"><TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><TextField label="To" type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {report.error && <ErrorState message={report.error} />}
      {report.loading && !r ? <Spinner /> : !r ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure title="Sales" value={naira(r.salesTotal)} note={`${r.salesCount} sale${r.salesCount === 1 ? '' : 's'}, net of returns`} />
            <Figure title="Purchases" value={naira(r.purchasesTotal)} note="Orders raised in the period" />
            <Figure title="Expenses" value={naira(r.expensesTotal)} note="Posted, not voided" />
            <Figure title="Stock on hand (now)" value={naira(r.stockValue)} note="At average cost" />
            <Figure title="Cash in" value={naira(r.cashIn)} tone="good" note="Payments received" />
            <Figure title="Cash out" value={naira(r.cashOut)} tone="bad" note="Supplier payments, refunds and expenses" />
            <Figure title="Operating surplus" value={naira(r.operatingSurplus)} tone={r.operatingSurplus >= 0 ? 'good' : 'bad'} note="Cash in minus cash out" />
            <Figure title="Owed to you / by you (now)" value={`${naira(r.receivablesOpen)} / ${naira(r.payablesOpen)}`} note="Open invoices / unpaid orders" />
          </div>
          <Notice>Operating surplus is recorded cash in minus cash out. It is not accounting profit: it ignores stock on hand, unpaid invoices and bills, and depreciation.</Notice>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Expenses by category</h2>
          {cats.length === 0 ? <Card><EmptyState title="No expenses in this period" /></Card> : (
            <Card>
              <ul className="space-y-2 text-sm">
                {cats.map(([c, v]) => (
                  <li key={c} className="grid grid-cols-[8rem_1fr_8rem] items-center gap-3">
                    <span>{label(c)}</span>
                    <span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-accent" style={{ width: `${top ? Math.max((v / top) * 100, 2) : 0}%` }} /></span>
                    <span className="tabular text-right">{naira(v)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  )
}

/** The Finance app: the summary, cash flow, the cashbook, and what is owed each way, in one place. Figures come from the recorded ledgers of the other apps. */
export function ReportsPage() {
  const { active } = useBusiness()
  const [params, setParams] = useSearchParams()
  if (!active) return null
  const want = (params.get('tab') ?? '').toLowerCase()
  const tab = TABS.find(([k, l]) => k === want || l.toLowerCase() === want)?.[0] ?? 'overview'
  return (
    <>
      <PageHeader title="Reports" description="Sales, purchases, expenses and cash for a period, plus what is owed each way. Figures come from the recorded ledgers." />
      <div role="tablist" aria-label="Finance sections" className="mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview businessId={active.id} />}
      {tab === 'cashflow' && <CashFlowTab businessId={active.id} />}
      {tab === 'cashbook' && <CashbookPage embedded />}
      {tab === 'owed' && <ReceivablesPage embedded />}
      {tab === 'bills' && <PayablesPage embedded />}
    </>
  )
}
