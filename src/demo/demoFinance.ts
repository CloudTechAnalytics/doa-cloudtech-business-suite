import { getInv, newId } from '@/demo/demoInventory'
import { demoAllowed, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only expenses, receivables, payables, cashbook and summary report for demo mode. Mirrors
 * supabase/migrations/20261021000010_finance.sql: cash basis, voids instead of deletes, read-only derived views.
 */
export const EXPENSE_CATEGORIES = ['feed', 'labour', 'medication', 'fuel_energy', 'repairs', 'transport', 'utilities', 'rent', 'supplies', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export const PAY_METHODS = ['cash', 'bank_transfer', 'card', 'pos', 'other'] as const

export interface DExpense {
  id: string; businessId: string; number: string; category: ExpenseCategory; amount: number; method: string; description: string
  date: string; supplierId: string | null; batchId: string | null; source: 'manual' | 'maintenance'; status: 'posted' | 'voided'; voidReason: string | null
}
interface Fin { expenses: DExpense[]; seq: Record<string, number>; keys: Record<string, string> }

const KEY = 'doa.demo.finance.v1'
const empty = (): Fin => ({ expenses: [], seq: {}, keys: {} })
function load(): Fin {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Fin) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Fin) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getFinance = () => state
/** Credit notes against a purchase order; the mart module replaces this when it loads. */
export const creditHook = { credit: (_purchaseId: string): number => 0 }
export const resetDemoFinance = () => commit(empty())

const today = () => new Date().toISOString().slice(0, 10)
const allowedAny = (biz: string, perm: string) => demoAllowed(biz, 'expenses', perm) || demoAllowed(biz, 'farm-expenses', perm)

type Out<R> = { error: string | null; result?: R }
function run<R>(biz: string, op: string, key: string, perm: string, fn: (f: Fin) => R): Out<R> {
  if (!allowedAny(biz, perm)) return { error: 'permission denied' }
  if (!key || key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  const prev = state.keys[`${biz}|${key}`]
  if (prev) {
    const i = prev.indexOf('|')
    return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' }
  }
  const f: Fin = JSON.parse(JSON.stringify(state)) as Fin
  try {
    const result = fn(f)
    f.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commit(f)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export interface NewExpense { category: ExpenseCategory; amount: number; method: string; description: string; date: string; supplierId: string | null; batchId: string | null }

/** Shared by the manual form and by modules that create expenses (equipment maintenance). */
export function postExpense(f: Fin, biz: string, v: NewExpense, source: DExpense['source'] = 'manual'): DExpense {
  if (!(v.amount > 0) || Math.round(v.amount * 100) / 100 !== v.amount) throw new Error('amount must be positive with at most 2 decimals')
  if (!v.date || v.date > today()) throw new Error('the expense date cannot be in the future')
  if (v.description.trim().length < 2) throw new Error('describe the expense (at least 2 characters)')
  if (!EXPENSE_CATEGORIES.includes(v.category)) throw new Error('unknown category')
  if (!(PAY_METHODS as readonly string[]).includes(v.method)) throw new Error('unknown payment method')
  if (v.supplierId && !getTrade().suppliers.some((s) => s.id === v.supplierId && s.businessId === biz)) throw new Error('unknown supplier')
  const k = `${biz}|expense`
  f.seq[k] = (f.seq[k] ?? 0) + 1
  const e: DExpense = {
    id: newId('x'), businessId: biz, number: `EXP-${String(f.seq[k]).padStart(6, '0')}`, category: v.category, amount: v.amount, method: v.method,
    description: v.description.trim(), date: v.date, supplierId: v.supplierId, batchId: v.batchId, source, status: 'posted', voidReason: null,
  }
  f.expenses.push(e)
  return e
}

export function demoRecordExpense(biz: string, v: NewExpense, key: string) {
  return run(biz, 'expense_record', key, 'expenses.record', (f) => ({ expenseId: postExpense(f, biz, v).id }))
}

export function demoVoidExpense(biz: string, id: string, reason: string, key: string) {
  return run(biz, 'expense_void', key, 'expenses.record', (f) => {
    const e = f.expenses.find((x) => x.id === id && x.businessId === biz)
    if (!e) throw new Error('expense not found')
    if (e.status === 'voided') throw new Error('expense is already voided')
    if (e.source !== 'manual') throw new Error('this expense was created by another record; correct it there')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    e.status = 'voided'; e.voidReason = reason.trim()
    return { expenseId: id }
  }).error
}

// ---------------------------------------------------------------- derived views
const c = (n: number) => Math.round(n * 100)
const m = (n: number) => n / 100
const ageDays = (iso: string) => Math.floor((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 86400000)

export interface ReceivableRow { saleId: string; number: string; customerId: string | null; customerName: string; soldAt: string; grandTotal: number; amountPaid: number; balanceDue: number; ageDays: number }
export interface PayableRow { purchaseId: string; number: string; supplierId: string; supplierName: string; at: string; total: number; amountPaid: number; balanceDue: number; ageDays: number }
export interface CashEntry { at: string; kind: string; direction: 'in' | 'out'; method: string; amount: number; reference: string; sourceId: string }

export function demoReceivables(biz: string): ReceivableRow[] {
  const t = getTrade()
  return t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && s.balanceDue > 0).map((s) => ({
    saleId: s.id, number: s.number, customerId: s.customerId, customerName: t.customers.find((x) => x.id === s.customerId)?.name ?? 'Walk-in',
    soldAt: s.soldAt, grandTotal: s.grandTotal, amountPaid: s.amountPaid, balanceDue: s.balanceDue, ageDays: ageDays(s.soldAt),
  }))
}

export function demoPayables(biz: string): PayableRow[] {
  const t = getTrade()
  return t.purchases.filter((p) => p.businessId === biz && p.status !== 'cancelled' && c(p.total) - c(p.amountPaid) - c(creditHook.credit(p.id)) > 0).map((p) => ({
    purchaseId: p.id, number: p.number, supplierId: p.supplierId, supplierName: t.suppliers.find((x) => x.id === p.supplierId)?.name ?? 'Unknown',
    at: p.at, total: p.total, amountPaid: p.amountPaid, balanceDue: m(Math.max(c(p.total) - c(p.amountPaid) - c(creditHook.credit(p.id)), 0)), ageDays: ageDays(p.at),
  }))
}

export function demoCashbook(biz: string): CashEntry[] {
  const t = getTrade()
  const pays: CashEntry[] = t.payments.filter((p) => p.businessId === biz && p.status === 'successful').map((p) => ({
    at: p.at, kind: p.type, direction: p.type === 'sale_receipt' ? 'in' : 'out', method: p.method, amount: p.amount,
    reference: (p.saleId ? t.sales.find((s) => s.id === p.saleId)?.number : t.purchases.find((x) => x.id === p.purchaseId)?.number) ?? '', sourceId: p.id,
  }))
  const exps: CashEntry[] = state.expenses.filter((e) => e.businessId === biz && e.status === 'posted').map((e) => ({
    at: `${e.date}T00:00:00.000Z`, kind: 'expense', direction: 'out', method: e.method, amount: e.amount, reference: e.number, sourceId: e.id,
  }))
  return [...pays, ...exps].sort((a, b) => a.at.localeCompare(b.at))
}

export interface ReportSummary {
  salesCount: number; salesTotal: number; purchasesTotal: number; expensesTotal: number; expensesByCategory: Record<string, number>
  cashIn: number; cashOut: number; operatingSurplus: number; receivablesOpen: number; payablesOpen: number; stockValue: number
}

/** Same figures as report_summary(): sales net of returns, cash basis surplus, open receivables/payables, stock at average cost. */
export function demoReportSummary(biz: string, from: string, to: string): ReportSummary {
  if (!demoAllowed(biz, 'reports', 'reports.finance.read')) throw new Error('permission denied')
  if (!from || !to || to < from) throw new Error('choose a valid period')
  const t = getTrade()
  const inRange = (iso: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to
  const sales = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && inRange(s.soldAt))
  const exps = state.expenses.filter((e) => e.businessId === biz && e.status === 'posted' && e.date >= from && e.date <= to)
  const cash = demoCashbook(biz).filter((e) => inRange(e.at))
  const byCat: Record<string, number> = {}
  for (const e of exps) byCat[e.category] = m(c(byCat[e.category] ?? 0) + c(e.amount))
  const cashIn = cash.filter((e) => e.direction === 'in').reduce((a, e) => a + c(e.amount), 0)
  const cashOut = cash.filter((e) => e.direction === 'out').reduce((a, e) => a + c(e.amount), 0)
  const inv = getInv()
  const stock = Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|`)).reduce((a, [, v]) => a + v.qty * (v.avg ?? 0), 0)
  return {
    salesCount: sales.length, salesTotal: m(sales.reduce((a, s) => a + c(s.grandTotal) - c(s.returnedTotal), 0)),
    purchasesTotal: m(t.purchases.filter((p) => p.businessId === biz && p.status !== 'cancelled' && inRange(p.at)).reduce((a, p) => a + c(p.total), 0)),
    expensesTotal: m(exps.reduce((a, e) => a + c(e.amount), 0)), expensesByCategory: byCat,
    cashIn: m(cashIn), cashOut: m(cashOut), operatingSurplus: m(cashIn - cashOut),
    receivablesOpen: m(demoReceivables(biz).reduce((a, r) => a + c(r.balanceDue), 0)), payablesOpen: m(demoPayables(biz).reduce((a, r) => a + c(r.balanceDue), 0)),
    stockValue: Math.round(stock * 100) / 100,
  }
}

/** For modules that create expenses themselves (equipment maintenance); mirrors an expense with source 'maintenance'. Call last in an operation. */
export function demoMaintenanceExpense(biz: string, v: { amount: number; method: string; description: string; date: string }): string {
  const f: Fin = JSON.parse(JSON.stringify(state)) as Fin
  const e = postExpense(f, biz, { category: 'repairs', amount: v.amount, method: v.method, description: v.description, date: v.date, supplierId: null, batchId: null }, 'maintenance')
  commit(f)
  return e.id
}

export function demoVoidMaintenanceExpense(biz: string, id: string, reason: string) {
  const f: Fin = JSON.parse(JSON.stringify(state)) as Fin
  const e = f.expenses.find((x) => x.id === id && x.businessId === biz)
  if (e) { e.status = 'voided'; e.voidReason = `Maintenance record voided: ${reason}`; commit(f) }
}
