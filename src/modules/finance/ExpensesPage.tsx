import clsx from 'clsx'
import { Copy, Download, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { UsageNotice } from '@/core/subscriptions/UsageViews'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { listSuppliers } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { downloadCsv } from '@/shared/utilities/csvExport'
import { label, naira } from '@/shared/utilities/format'
import { BudgetsTab } from './ExpenseBudgets'
import { ReportTab } from './ExpenseReport'
import { categoryChoices, expensesExport, filterExpenses, toSlug } from './expenseLogic'
import { PAY_METHODS, listBatchChoices, listExpenses, myFinancePermissions, recordExpense, voidExpense } from './financeApi'
import type { ExpenseDto } from './financeApi'

/** Which part is open is in the address (?tab=budgets), so the sidebar, the tabs and the back button agree. */
const TABS = [['expenses', 'Expenses'], ['budgets', 'Budgets'], ['report', 'Report']] as const

const today = () => new Date().toISOString().slice(0, 10)

/** Money paid out: feed, labour, medication, repairs and so on. Deleting one takes it out of the totals; the entry is kept in the log. Shared by Expenses and Farm Expenses. */
export function ExpensesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const isFarm = active?.industry === 'farm'
  const expenses = useAsync(() => listExpenses(businessId), [businessId])
  const suppliers = useAsync(() => listSuppliers(businessId).catch(() => []), [businessId])
  const batches = useAsync(() => (isFarm ? listBatchChoices(businessId) : Promise.resolve([])), [businessId, isFarm])
  const perms = useAsync(() => myFinancePermissions(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<ExpenseDto | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [status, setStatus] = useState<'all' | 'posted' | 'voided'>('posted')
  const [copyOf, setCopyOf] = useState<ExpenseDto | null>(null)
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(([k, l]) => k === (params.get('tab') ?? '').toLowerCase() || l.toLowerCase() === (params.get('tab') ?? '').toLowerCase())?.[0] ?? 'expenses'
  if (!active) return null
  const canRecord = perms.data?.includes('expenses.record') ?? false
  const choices = categoryChoices(active.industry, (expenses.data ?? []).map((e) => e.category))

  const list = filterExpenses(expenses.data ?? [], { q: search, category, method, status, from, to })
  const posted = list.filter((e) => e.status === 'posted')
  const total = posted.reduce((a, e) => a + Math.round(e.amount * 100), 0) / 100
  const byCat = new Map<string, number>()
  for (const e of posted) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Math.round(e.amount * 100))
  const name = (id: string | null, from: { id: string; name: string }[] | null) => from?.find((x) => x.id === id)?.name

  return (
    <>
      <PageHeader
        title={isFarm ? 'Farm expenses' : 'Expenses'}
        description="Money paid out. Each entry shows in Cash & Bank and lowers the profit. Delete a wrong entry: it stops counting, and a note of it is kept."
        actions={canRecord ? <Button onClick={() => { setCopyOf(null); setAdding(true) }}><Plus className="size-4" aria-hidden /> Record expense</Button> : undefined}
      />
      <UsageNotice keys={['expenses_per_month']} />
      <div role="tablist" aria-label="Expense sections" className="mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{l}</button>)}
      </div>
      {tab === 'budgets' && <BudgetsTab businessId={businessId} industry={active.industry} canEdit={canRecord} />}
      {tab === 'report' && <ReportTab businessId={businessId} />}
      {tab === 'expenses' && <>
      {expenses.error && <ErrorState message={expenses.error} />}
      {expenses.loading ? <Spinner /> : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description or number" /></div>
            <div className="w-52">
              <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {choices.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </SelectField>
            </div>
            <div className="w-40"><SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Any way</option>{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField></div>
            <div className="w-36"><TextField label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="w-36"><TextField label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="w-32"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="posted">Current</option><option value="voided">Deleted</option><option value="all">All</option></SelectField></div>
            <div className="ml-auto flex items-center gap-3"><p className="text-sm text-ink/70">Total shown: <b className="tabular text-ink">{naira(total)}</b></p>{list.length > 0 && <Button variant="secondary" onClick={() => downloadCsv('expenses.csv', expensesExport(list, (id) => name(id, suppliers.data)))}><Download className="size-4" aria-hidden /> Export</Button>}</div>
          </div>
          {byCat.size > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {[...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => <span key={c} className="rounded-full bg-canvas px-2.5 py-1">{label(c)} <b className="tabular">{naira(v / 100)}</b></span>)}
            </div>
          )}
          {list.length === 0 ? (
            <Card><EmptyState title={expenses.data?.length ? 'No expenses match' : 'No expenses yet'} description={expenses.data?.length ? 'Try a different search or category.' : 'Record feed, labour, medication, repairs and other costs as they are paid.'} /></Card>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-ink/70">
                  <tr><th className="p-3">Entry</th><th className="p-3">Category</th><th className="p-3">Paid</th><th className="p-3 text-right">Amount</th>{canRecord && <th className="w-20 p-3" />}</tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {list.map((e) => (
                    <tr key={e.id} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) setOpen(e.id) }} className={`cursor-pointer hover:bg-surface ${e.status === 'voided' ? 'text-ink/45' : ''}`}>
                      <td className="p-3">
                        <span className={e.status === 'voided' ? 'line-through' : 'font-medium'}>{e.description}</span>
                        <div className="text-xs text-ink/60">{e.number} · {e.date}{name(e.supplierId, suppliers.data) ? ` · ${name(e.supplierId, suppliers.data)}` : ''}{name(e.batchId, batches.data?.map((b) => ({ id: b.id, name: b.label })) ?? null) ? ` · ${name(e.batchId, batches.data?.map((b) => ({ id: b.id, name: b.label })) ?? null)}` : ''}</div>
                        {e.status === 'voided' && <div className="text-xs">Deleted: {e.voidReason}</div>}
                      </td>
                      <td className="p-3"><Badge>{label(e.category)}</Badge></td>
                      <td className="p-3">{label(e.method)}</td>
                      <td className="tabular p-3 text-right">{naira(e.amount)}</td>
                      {canRecord && <td className="p-3 text-right">{e.status === 'posted' && e.source === 'manual' && <Button variant="ghost" onClick={() => setVoiding(e)}>Delete</Button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
      </>}
      {adding && <ExpenseDialog businessId={businessId} industry={active.industry} used={(expenses.data ?? []).map((e) => e.category)} seed={copyOf} suppliers={suppliers.data ?? []} batches={batches.data ?? []} onClose={() => { setAdding(false); setCopyOf(null) }} onSaved={async () => { setAdding(false); setCopyOf(null); await expenses.refresh() }} />}
      {open && expenses.data?.find((x) => x.id === open) && <ExpenseDetail e={expenses.data.find((x) => x.id === open)!} supplier={name(expenses.data.find((x) => x.id === open)!.supplierId, suppliers.data)} batch={name(expenses.data.find((x) => x.id === open)!.batchId, batches.data?.map((b) => ({ id: b.id, name: b.label })) ?? null)} onClose={() => setOpen(null)} onRepeat={canRecord ? (x) => { setOpen(null); setCopyOf(x); setAdding(true) } : undefined} />}
      {voiding && <VoidDialog businessId={businessId} expense={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await expenses.refresh() }} />}
    </>
  )
}

/** One expense entry: what was paid, to whom, how, and whether it was voided. */
function ExpenseDetail({ e, supplier, batch, onClose, onRepeat }: { e: ExpenseDto; supplier?: string; batch?: string; onClose: () => void; onRepeat?: (e: ExpenseDto) => void }) {
  return (
    <DetailPage title={`${e.number}: ${e.description}`} onClose={onClose}>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-ink/60">Amount</dt><dd className="tabular text-lg font-semibold">{naira(e.amount)}</dd></div>
        <div><dt className="text-xs text-ink/60">Status</dt><dd><Badge tone={e.status === 'voided' ? 'danger' : 'success'}>{e.status === 'voided' ? 'Deleted' : 'Current'}</Badge></dd></div>
        <div><dt className="text-xs text-ink/60">Date</dt><dd>{e.date}</dd></div>
        <div><dt className="text-xs text-ink/60">Category</dt><dd>{label(e.category)}</dd></div>
        <div><dt className="text-xs text-ink/60">Paid by</dt><dd>{label(e.method)}</dd></div>
        <div><dt className="text-xs text-ink/60">Recorded from</dt><dd>{e.source === 'manual' ? 'Entered by hand' : label(e.source)}</dd></div>
        {supplier && <div><dt className="text-xs text-ink/60">Supplier</dt><dd>{supplier}</dd></div>}
        {batch && <div><dt className="text-xs text-ink/60">Batch</dt><dd>{batch}</dd></div>}
        {e.status === 'voided' && <div className="sm:col-span-2"><dt className="text-xs text-ink/60">Why it was deleted</dt><dd>{e.voidReason}</dd></div>}
      </dl>
      <p className="mt-4 text-xs text-ink/60">Expenses are never deleted, because they are money records. To correct a mistake, void the entry with a reason: it stays on record but is left out of every total.</p>
      <div className="mt-5 flex justify-end gap-2">{onRepeat && e.source === 'manual' && <Button variant="secondary" onClick={() => onRepeat(e)}><Copy className="size-4" aria-hidden /> Record again</Button>}<Button variant="secondary" onClick={onClose}>Back to expenses</Button></div>
    </DetailPage>
  )
}

function ExpenseDialog({ businessId, industry, used, seed, suppliers, batches, onClose, onSaved }: { businessId: string; industry: string; used: string[]; seed: ExpenseDto | null; suppliers: { id: string; name: string }[]; batches: { id: string; label: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!(Number(s('amount')) > 0)) next.amount = 'Enter an amount above zero.'
    if (s('description').length < 2) next.description = 'Describe the expense.'
    if (!s('date') || s('date') > today()) next.date = 'Choose today or an earlier date.'
    const category = s('newCategory') ? toSlug(s('newCategory')) : s('category')
    if (!category) next.newCategory = 'Use letters and numbers for a new category name.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordExpense(businessId, {
      category, amount: Math.round(Number(s('amount')) * 100) / 100, method: s('method'), description: s('description'),
      date: s('date'), supplierId: s('supplier') || null, batchId: s('batch') || null,
    }, k), 'Expense recorded.')
  }
  return (
    <DetailPage modal title={seed ? `Record again: ${seed.description}` : 'Record an expense'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="What was it for?" name="description" error={errors.description} placeholder={industry === 'farm' ? 'e.g. 20 bags of layer mash' : 'e.g. Fuel for the delivery van'} maxLength={300} defaultValue={seed?.description} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" name="category" defaultValue={seed?.category ?? (industry === 'farm' ? 'feed' : 'supplies')}>{categoryChoices(industry, [...used, ...(seed ? [seed.category] : [])]).map((c) => <option key={c} value={c}>{label(c)}</option>)}</SelectField>
          <TextField label="Or a new category" name="newCategory" error={errors.newCategory} maxLength={40} placeholder="e.g. Staff welfare" hint="Leave blank to use the one on the left." />
          <TextField label="Amount" name="amount" type="number" min="0" step="0.01" error={errors.amount} defaultValue={seed?.amount} />
          <SelectField label="Paid by" name="method" defaultValue={seed?.method ?? 'cash'}>{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
          <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} error={errors.date} />
        </div>
        {suppliers.length > 0 && (
          <SelectField label="Supplier (optional)" name="supplier" defaultValue={seed?.supplierId ?? ''}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
        )}
        {batches.length > 0 && (
          <SelectField label="Batch (optional)" name="batch" defaultValue="" hint="Charge the cost to one batch."><option value="">Whole farm</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</SelectField>
        )}
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record expense</Button></div>
      </form>
    </DetailPage>
  )
}

function VoidDialog({ businessId, expense, onClose, onSaved }: { businessId: string; expense: ExpenseDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`Delete ${expense.number}?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidExpense(businessId, expense.id, reason, k), 'Expense deleted.') }} className="space-y-4">
        <p className="text-sm text-ink/80">{expense.description}: <b>{naira(expense.amount)}</b>. It stops counting as money paid out. A note of it is kept in the log.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not deleted" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Delete expense</Button></div>
      </form>
    </Dialog>
  )
}
