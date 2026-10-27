import * as demo from '@/demo/demoFinance'
import type { CashEntry, ExpenseCategory, NewExpense, PayableRow, ReceivableRow, ReportSummary } from '@/demo/demoFinance'
import { demoCan as invCan } from '@/demo/demoInventory'
import { demoCanTrade, ensureDemoTrade } from '@/demo/demoTrade'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Expenses, receivables, payables, cashbook and the summary report. Live mode reads the database views and calls the
 *  functions; demo mode runs the browser mirror. Mutations return an error message or null. */
export type { CashEntry, ExpenseCategory, NewExpense, PayableRow, ReceivableRow, ReportSummary }
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
  const r = await db().from('expenses').select('*').eq('business_id', b).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
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
