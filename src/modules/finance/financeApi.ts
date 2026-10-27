import * as demo from '@/demo/demoFinance'
import type { BudgetRow, BudgetStatus, CashEntry, CashFlow, ExpenseCategory, ExpenseReport, NewExpense, PayableRow, ReceivableRow, ReportSummary } from '@/demo/demoFinance'
import { demoCan as invCan } from '@/demo/demoInventory'
import { demoCanTrade, ensureDemoTrade } from '@/demo/demoTrade'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Expenses, receivables, payables, cashbook and the summary report. Live mode reads the database views and calls the
 *  functions; demo mode runs the browser mirror. Mutations return an error message or null. */
export type { BudgetRow, BudgetStatus, CashEntry, CashFlow, ExpenseCategory, ExpenseReport, NewExpense, PayableRow, ReceivableRow, ReportSummary }
export { EXPENSE_CATEGORIES, PAY_METHODS } from '@/demo/demoFinance'

export interface ExpenseDto {
  id: string; number: string; category: ExpenseCategory; amount: number; method: string; description: string; date: string
  supplierId: string | null; batchId: string | null; source: string; status: 'posted' | 'voided'; voidReason: string | null
}

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!

export async function myFinancePermissions(businessId: string): Promise<string[]> {
  if (isDemoMode) return ['expenses.record', 'procurement.request', 'procurement.approve', 'purchases.pay', 'sales.create'].filter((p) => demoCanTrade(businessId, p) || invCan(businessId, p))
  const { data } = await db().rpc('my_permissions', { p_business: businessId })
  return (data as string[] | null) ?? []
}

export async function listExpenses(b: string): Promise<ExpenseDto[]> {
  if (isDemoMode) {
    return demo.getFinance().expenses.filter((e) => e.businessId === b).map((e) => ({ id: e.id, number: e.number, category: e.category, amount: e.amount, method: e.method, description: e.description, date: e.date, supplierId: e.supplierId, batchId: e.batchId, source: e.source, status: e.status, voidReason: e.voidReason })).reverse()
  }
  const r = await db().from('expenses').select('*').eq('business_id', b).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((e) => ({ id: e.id, number: e.expense_number, category: e.category as ExpenseCategory, amount: n(e.amount), method: e.payment_method, description: e.description, date: e.expense_date, supplierId: e.supplier_id, batchId: e.farm_batch_id, source: e.source, status: e.status as 'posted' | 'voided', voidReason: e.void_reason }))
}

export async function recordExpense(b: string, v: NewExpense, key: string) {
  if (isDemoMode) return demo.demoRecordExpense(b, v, key).error
  return msg((await db().rpc('record_expense', { p_business: b, p_category: v.category, p_amount: v.amount, p_method: v.method, p_description: v.description, p_date: v.date, p_supplier: v.supplierId, p_batch: v.batchId, p_key: key })).error)
}

export async function voidExpense(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidExpense(b, id, reason, key)
  return msg((await db().rpc('void_expense', { p_expense: id, p_reason: reason, p_key: key })).error)
}

export async function listReceivables(b: string): Promise<ReceivableRow[]> {
  if (isDemoMode) { ensureDemoTrade(b); return demo.demoReceivables(b) }
  const r = await db().from('receivables').select('*').eq('business_id', b).order('sold_at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ saleId: x.sale_id!, number: x.sale_number!, customerId: x.customer_id, customerName: x.customer_name ?? 'Walk-in', soldAt: x.sold_at!, grandTotal: n(x.grand_total), amountPaid: n(x.amount_paid), balanceDue: n(x.balance_due), ageDays: n(x.age_days), source: x.source === 'invoice' ? 'invoice' as const : 'sale' as const }))
}

export async function listPayables(b: string): Promise<PayableRow[]> {
  if (isDemoMode) { ensureDemoTrade(b); return demo.demoPayables(b) }
  const r = await db().from('payables').select('*').eq('business_id', b).order('purchased_at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ purchaseId: x.purchase_id!, number: x.purchase_number!, supplierId: x.supplier_id!, supplierName: x.supplier_name!, at: x.purchased_at!, total: n(x.total_amount), amountPaid: n(x.amount_paid), balanceDue: n(x.balance_due), ageDays: n(x.age_days) }))
}

export async function listCashbook(b: string): Promise<CashEntry[]> {
  if (isDemoMode) { ensureDemoTrade(b); return demo.demoCashbook(b) }
  const r = await db().from('cashbook').select('*').eq('business_id', b).order('entry_at').limit(2000)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ at: x.entry_at!, kind: x.kind!, direction: x.direction as 'in' | 'out', method: x.method!, amount: n(x.amount), reference: x.reference ?? '', sourceId: x.source_id! }))
}

export async function reportSummary(b: string, from: string, to: string): Promise<ReportSummary> {
  if (isDemoMode) { ensureDemoTrade(b); return demo.demoReportSummary(b, from, to) }
  const { data, error } = await db().rpc('report_summary', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown>
  return {
    salesCount: n(x.sales_count), salesTotal: n(x.sales_total), purchasesTotal: n(x.purchases_total), expensesTotal: n(x.expenses_total),
    expensesByCategory: Object.fromEntries(Object.entries((x.expenses_by_category ?? {}) as Record<string, unknown>).map(([k, v]) => [k, n(v)])),
    cashIn: n(x.cash_in), cashOut: n(x.cash_out), operatingSurplus: n(x.operating_surplus), receivablesOpen: n(x.receivables_open), payablesOpen: n(x.payables_open), stockValue: n(x.stock_value), invoicedTotal: n(x.invoiced_total),
  }
}

/** Running balance per payment method, oldest first. Used by the cashbook screen. */
export function withRunningBalance(entries: CashEntry[]): (CashEntry & { balance: number })[] {
  const bal = new Map<string, number>()
  return entries.map((e) => {
    const next = Math.round(((bal.get(e.method) ?? 0) + (e.direction === 'in' ? e.amount : -e.amount)) * 100) / 100
    bal.set(e.method, next)
    return { ...e, balance: next }
  })
}

/** Active farm batches, for charging an expense to one batch. Empty outside farms. */
export async function listBatchChoices(b: string): Promise<{ id: string; label: string }[]> {
  if (isDemoMode) {
    const farm = await import('@/demo/demoFarm')
    farm.ensureDemoFarm(b)
    return farm.getFarm().batches.filter((x) => x.businessId === b && x.status === 'active').map((x) => ({ id: x.id, label: `${x.code} · ${x.species}` }))
  }
  const r = await db().from('farm_batches').select('id, batch_code, species_or_crop').eq('business_id', b).eq('status', 'active').order('batch_code')
  if (r.error) return []
  return (r.data ?? []).map((x) => ({ id: x.id, label: `${x.batch_code} · ${x.species_or_crop}` }))
}

// ------------------------------------------------------------------------------ budgets and the spending report
/** Monthly budget against what was actually spent, for the month that contains `month` (YYYY-MM-DD). */
export async function budgetStatus(b: string, month: string): Promise<BudgetStatus> {
  if (isDemoMode) return demo.demoBudgetStatus(b, month)
  const { data, error } = await db().rpc('expense_budget_status', { p_business: b, p_month: month })
  if (error) throw new Error(error.message)
  const x = data as { month: string; rows: { category: string; budget: number | null; spent: number }[] }
  return { month: x.month, rows: x.rows.map((r): BudgetRow => ({ category: r.category, budget: r.budget === null ? null : n(r.budget), spent: n(r.spent) })) }
}
/** Sets a category's monthly budget; zero or nothing removes it. */
export async function setBudget(b: string, category: string, amount: number | null) {
  if (isDemoMode) return demo.demoSetBudget(b, category, amount)
  return msg((await db().rpc('expense_set_budget', { p_business: b, p_category: category, p_amount: amount })).error)
}
export async function expenseReport(b: string, from: string, to: string): Promise<ExpenseReport> {
  if (isDemoMode) return demo.demoExpenseReport(b, from, to)
  const { data, error } = await db().rpc('expense_report', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as { total: number; count: number; by_category: { category: string; total: number; count: number }[]; by_month: { month: string; total: number }[]; by_method: { method: string; total: number }[]; by_supplier: { supplier: string; total: number }[] }
  return { total: n(x.total), count: n(x.count), byCategory: x.by_category.map((r) => ({ category: r.category, total: n(r.total), count: n(r.count) })), byMonth: x.by_month.map((r) => ({ month: r.month, total: n(r.total) })), byMethod: x.by_method.map((r) => ({ method: r.method, total: n(r.total) })), bySupplier: x.by_supplier.map((r) => ({ supplier: r.supplier, total: n(r.total) })) }
}

/** Cash flow for a period: opening and closing balance, in and out by month and source, the balance in each way of paying, and what is expected from invoices. */
export async function cashFlow(b: string, from: string, to: string): Promise<CashFlow> {
  if (isDemoMode) { ensureDemoTrade(b); return demo.demoCashFlow(b, from, to) }
  const { data, error } = await db().rpc('finance_cash_flow', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as { opening: number; in_total: number; out_total: number; closing: number; by_month: { month: string; in: number; out: number }[]; in_by_kind: { kind: string; total: number }[]; out_by_kind: { kind: string; category: string | null; total: number }[]; by_method: { method: string; balance: number }[]; expected: { overdue: number; due_30: number; no_date: number } }
  return {
    opening: n(x.opening), inTotal: n(x.in_total), outTotal: n(x.out_total), closing: n(x.closing),
    byMonth: x.by_month.map((r) => ({ month: r.month, in: n(r.in), out: n(r.out) })), inByKind: x.in_by_kind.map((r) => ({ kind: r.kind, total: n(r.total) })),
    outByKind: x.out_by_kind.map((r) => ({ kind: r.kind, category: r.category, total: n(r.total) })), byMethod: x.by_method.map((r) => ({ method: r.method, balance: n(r.balance) })),
    expected: { overdue: n(x.expected.overdue), due30: n(x.expected.due_30), noDate: n(x.expected.no_date) },
  }
}
