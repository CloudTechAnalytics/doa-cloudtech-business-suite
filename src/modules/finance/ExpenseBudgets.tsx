import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { label, naira } from '@/shared/utilities/format'
import { budgetTotals, categoryChoices, shiftMonth, toSlug, usage } from './expenseLogic'
import { budgetStatus, setBudget } from './financeApi'

const monthName = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })
const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`
const BAR = { ok: 'bg-success', near: 'bg-warning', over: 'bg-danger', none: 'bg-line' } as const

/**
 * Monthly budgets next to what was actually spent. A budget is an amount per category that applies to every month until it is changed or removed. The bar turns amber at 80%
 * and red once the budget is passed. Spending in a category with no budget is listed too, so nothing is hidden.
 */
export function BudgetsTab({ businessId, industry, canEdit }: { businessId: string; industry: string; canEdit: boolean }) {
  const [month, setMonth] = useState(thisMonth)
  const status = useAsync(() => budgetStatus(businessId, month), [businessId, month])
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState(''); const [fresh, setFresh] = useState(''); const [amount, setAmount] = useState('')
  const rows = status.data?.rows ?? []
  const t = budgetTotals(rows)
  const choices = categoryChoices(industry, rows.map((r) => r.category)).filter((c) => !rows.some((r) => r.category === c && r.budget !== null))
  const current = month === thisMonth()

  async function save(category: string, value: string) {
    setError(null)
    const n = value.trim() === '' ? null : Number(value)
    if (n !== null && !(n >= 0)) return setError('A budget must be zero or more.')
    const err = await setBudget(businessId, category, n)
    if (err) return setError(err)
    await status.refresh()
  }
  async function add() {
    const category = fresh.trim() ? toSlug(fresh) : cat
    if (!category) return setError(fresh.trim() ? 'Use letters and numbers for a new category name.' : 'Choose a category.')
    if (!(Number(amount) > 0)) return setError('Enter the monthly budget.')
    await save(category, amount)
    setCat(''); setFresh(''); setAmount('')
  }

  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-ink/70">Set what you plan to spend on each category in a month, and see how far you are. A budget repeats every month until you change it. Voided expenses are not counted.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="size-4" aria-hidden /></Button>
        <h2 className="min-w-40 text-center text-sm font-semibold">{monthName(month)}</h2>
        <Button variant="secondary" aria-label="Next month" disabled={current} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="size-4" aria-hidden /></Button>
        {!current && <Button variant="ghost" onClick={() => setMonth(thisMonth())}>This month</Button>}
      </div>
      {(error || status.error) && <ErrorState message={error ?? status.error!} />}
      {status.loading && !status.data ? <Spinner /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            {([['Budgeted', naira(t.budgeted)], ['Spent on budgeted', naira(t.spentOnBudgeted)], [t.remaining >= 0 ? 'Left to spend' : 'Over budget by', naira(Math.abs(t.remaining))], ['Spent with no budget', naira(t.unbudgetedSpend)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-white p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{k}</p><p className={clsx('tabular mt-1 text-lg font-semibold', k === 'Over budget by' && 'text-danger')}>{v}</p></div>
            ))}
          </div>
          {rows.length === 0 ? <EmptyState title="No budgets or spending this month" description="Add a budget below, for example Transport or Marketing." /> : (
            <Card className="p-0">
              <ul className="divide-y divide-ink/10 text-sm">
                {rows.map((r) => {
                  const u = usage(r.budget, r.spent)
                  return (
                    <li key={r.category} className="grid items-center gap-x-4 gap-y-1 p-3 sm:grid-cols-[10rem_1fr_9rem_auto]">
                      <span className="font-medium">{label(r.category)}</span>
                      <span className="block">
                        <span className="block h-2 overflow-hidden rounded-full bg-canvas"><span className={clsx('block h-2 rounded-full', BAR[u.state])} style={{ width: `${r.budget ? Math.min(u.pct, 100) : 0}%` }} /></span>
                        <span className="mt-1 block text-xs text-ink/60">{r.budget === null ? 'No budget set' : u.state === 'over' ? `${naira(r.spent - r.budget)} over budget` : `${naira(r.budget - r.spent)} left (${u.pct}% used)`}</span>
                      </span>
                      <span className="tabular text-right">{naira(r.spent)}{r.budget !== null && <span className="text-ink/50"> of {naira(r.budget)}</span>}</span>
                      {canEdit ? (
                        <span className="flex items-center gap-1">
                          <input aria-label={`Monthly budget for ${label(r.category)}`} type="number" min="0" step="0.01" defaultValue={r.budget ?? ''} placeholder="Budget" key={`${r.category}-${r.budget}`}
                            onBlur={(e) => { if ((e.target.value === '' ? null : Number(e.target.value)) !== r.budget) void save(r.category, e.target.value) }} className="w-28 rounded border border-line px-2 py-1 text-right tabular-nums" />
                          {r.budget !== null && <Button variant="ghost" onClick={() => void save(r.category, '')}>Remove</Button>}
                        </span>
                      ) : <span />}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
          {canEdit && (
            <Card className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Add a budget</h3>
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_10rem_auto]">
                <SelectField label="Category" value={cat} onChange={(e) => { setCat(e.target.value); setFresh('') }}><option value="">Choose…</option>{choices.map((c) => <option key={c} value={c}>{label(c)}</option>)}</SelectField>
                <TextField label="Or a new category" value={fresh} onChange={(e) => { setFresh(e.target.value); setCat('') }} maxLength={40} placeholder="e.g. Staff welfare" />
                <TextField label="Per month (₦)" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Button onClick={() => void add()}>Add budget</Button>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  )
}
