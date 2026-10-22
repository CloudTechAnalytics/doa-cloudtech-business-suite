import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { listSuppliers } from '@/modules/sales/tradeApi'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { EXPENSE_CATEGORIES, PAY_METHODS, listBatchChoices, listExpenses, myFinancePermissions, recordExpense, voidExpense } from './financeApi'
import type { ExpenseCategory, ExpenseDto } from './financeApi'

const today = () => new Date().toISOString().slice(0, 10)

/** Money paid out: feed, labour, medication, repairs and so on. Voided, never deleted. Shared by Expenses and Farm Expenses. */
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
  if (!active) return null
  const canRecord = perms.data?.includes('expenses.record') ?? false

  const q = search.trim().toLowerCase()
  const list = (expenses.data ?? []).filter((e) => (!category || e.category === category) && (!q || e.description.toLowerCase().includes(q) || e.number.toLowerCase().includes(q)))
  const posted = list.filter((e) => e.status === 'posted')
  const total = posted.reduce((a, e) => a + Math.round(e.amount * 100), 0) / 100
  const byCat = new Map<string, number>()
  for (const e of posted) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Math.round(e.amount * 100))
  const name = (id: string | null, from: { id: string; name: string }[] | null) => from?.find((x) => x.id === id)?.name

  return (
    <>
      <PageHeader
        title={isFarm ? 'Farm expenses' : 'Expenses'}
        description="Money paid out. Each entry shows in the cashbook and lowers the operating surplus. A wrong entry is voided with a reason, never deleted."
        actions={canRecord ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record expense</Button> : undefined}
      />
      {expenses.error && <ErrorState message={expenses.error} />}
      {expenses.loading ? <Spinner /> : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description or number" /></div>
            <div className="w-52">
              <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </SelectField>
            </div>
            <p className="ml-auto text-sm text-ink/70">Total shown: <b className="tabular text-ink">{naira(total)}</b></p>
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
                        {e.status === 'voided' && <div className="text-xs">Voided: {e.voidReason}</div>}
                      </td>
                      <td className="p-3"><Badge>{label(e.category)}</Badge></td>
                      <td className="p-3">{label(e.method)}</td>
                      <td className="tabular p-3 text-right">{naira(e.amount)}</td>
                      {canRecord && <td className="p-3 text-right">{e.status === 'posted' && e.source === 'manual' && <Button variant="ghost" onClick={() => setVoiding(e)}>Void</Button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
      {adding && <ExpenseDialog businessId={businessId} suppliers={suppliers.data ?? []} batches={batches.data ?? []} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await expenses.refresh() }} />}
      {open && expenses.data?.find((x) => x.id === open) && <ExpenseDetail e={expenses.data.find((x) => x.id === open)!} supplier={name(expenses.data.find((x) => x.id === open)!.supplierId, suppliers.data)} batch={name(expenses.data.find((x) => x.id === open)!.batchId, batches.data?.map((b) => ({ id: b.id, name: b.label })) ?? null)} onClose={() => setOpen(null)} />}
      {voiding && <VoidDialog businessId={businessId} expense={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await expenses.refresh() }} />}
    </>
  )
}

/** One expense entry: what was paid, to whom, how, and whether it was voided. */
function ExpenseDetail({ e, supplier, batch, onClose }: { e: ExpenseDto; supplier?: string; batch?: string; onClose: () => void }) {
  return (
    <DetailPage title={`${e.number}: ${e.description}`} onClose={onClose}>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-ink/60">Amount</dt><dd className="tabular text-lg font-semibold">{naira(e.amount)}</dd></div>
        <div><dt className="text-xs text-ink/60">Status</dt><dd><Badge tone={e.status === 'voided' ? 'danger' : 'success'}>{e.status === 'voided' ? 'Voided' : 'Posted'}</Badge></dd></div>
        <div><dt className="text-xs text-ink/60">Date</dt><dd>{e.date}</dd></div>
        <div><dt className="text-xs text-ink/60">Category</dt><dd>{label(e.category)}</dd></div>
        <div><dt className="text-xs text-ink/60">Paid by</dt><dd>{label(e.method)}</dd></div>
        <div><dt className="text-xs text-ink/60">Recorded from</dt><dd>{e.source === 'manual' ? 'Entered by hand' : label(e.source)}</dd></div>
        {supplier && <div><dt className="text-xs text-ink/60">Supplier</dt><dd>{supplier}</dd></div>}
        {batch && <div><dt className="text-xs text-ink/60">Batch</dt><dd>{batch}</dd></div>}
        {e.status === 'voided' && <div className="sm:col-span-2"><dt className="text-xs text-ink/60">Why it was voided</dt><dd>{e.voidReason}</dd></div>}
      </dl>
      <div className="mt-5 flex justify-end"><Button variant="secondary" onClick={onClose}>Back to expenses</Button></div>
    </DetailPage>
  )
}

function ExpenseDialog({ businessId, suppliers, batches, onClose, onSaved }: { businessId: string; suppliers: { id: string; name: string }[]; batches: { id: string; label: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!(Number(s('amount')) > 0)) next.amount = 'Enter an amount above zero.'
    if (s('description').length < 2) next.description = 'Describe the expense.'
    if (!s('date') || s('date') > today()) next.date = 'Choose today or an earlier date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordExpense(businessId, {
      category: s('category') as ExpenseCategory, amount: Math.round(Number(s('amount')) * 100) / 100, method: s('method'), description: s('description'),
      date: s('date'), supplierId: s('supplier') || null, batchId: s('batch') || null,
    }, k), 'Expense recorded.')
  }
  return (
    <DetailPage modal title="Record an expense" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="What was it for?" name="description" error={errors.description} placeholder="e.g. 20 bags of layer mash" maxLength={300} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" name="category" defaultValue="feed">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</SelectField>
          <TextField label="Amount" name="amount" type="number" min="0" step="0.01" error={errors.amount} />
          <SelectField label="Paid by" name="method" defaultValue="cash">{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
          <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} error={errors.date} />
        </div>
        {suppliers.length > 0 && (
          <SelectField label="Supplier (optional)" name="supplier" defaultValue=""><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
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
    <Dialog title={`Void ${expense.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidExpense(businessId, expense.id, reason, k), 'Expense voided.') }} className="space-y-4">
        <p className="text-sm text-ink/80">{expense.description}: <b>{naira(expense.amount)}</b>. It stays on record, marked as voided, and no longer counts as money paid out.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {runner.error && <ErrorState title="Not voided" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Void expense</Button></div>
      </form>
    </Dialog>
  )
}
