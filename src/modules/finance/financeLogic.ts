import type { CashFlow } from '@/demo/demoFinance'
import { label } from '@/shared/utilities/format'

/** Pure rules behind the Finance screens, kept apart from the components so they can be tested on their own. */

const SOURCE: Record<string, string> = {
  sale_receipt: 'Sales received', invoice_receipt: 'Invoice payments received', purchase_payment: 'Supplier payments', refund: 'Refunds paid to customers', expense: 'Expenses',
}
/** A plain name for where money came from or went: "Sales received", "Expenses: Rent". */
export const flowLabel = (kind: string, category: string | null = null) => (kind === 'expense' && category ? `Expenses: ${label(category)}` : SOURCE[kind] ?? label(kind))

export interface FlowCheck { ok: boolean; expected: number }
/** The period must reconcile: opening balance plus money in, less money out, is the closing balance (to the kobo). */
export function reconciles(r: Pick<CashFlow, 'opening' | 'inTotal' | 'outTotal' | 'closing'>): FlowCheck {
  const expected = Math.round((r.opening + r.inTotal - r.outTotal) * 100) / 100
  return { ok: Math.abs(expected - r.closing) < 0.005, expected }
}

/** The report as rows for a CSV file you can open in Excel. */
export function cashFlowExport(r: CashFlow): (string | number | null)[][] {
  return [
    ['Cash flow', 'Amount'], ['Opening balance', r.opening], ['Money in', r.inTotal], ['Money out', r.outTotal], ['Closing balance', r.closing],
    [], ['By month', 'Money in', 'Money out', 'Net'], ...r.byMonth.map((m) => [m.month, m.in, m.out, Math.round((m.in - m.out) * 100) / 100]),
    [], ['Money in by source', 'Amount'], ...r.inByKind.map((k) => [flowLabel(k.kind), k.total]),
    [], ['Money out by source', 'Amount'], ...r.outByKind.map((k) => [flowLabel(k.kind, k.category), k.total]),
    [], ['Balance by way of paying (to the end of the period)', 'Balance'], ...r.byMethod.map((m) => [label(m.method), m.balance]),
    [], ['Expected from invoices (still owed)', 'Amount'], ['Overdue', r.expected.overdue], ['Due in the next 30 days', r.expected.due30], ['No due date', r.expected.noDate],
  ]
}
