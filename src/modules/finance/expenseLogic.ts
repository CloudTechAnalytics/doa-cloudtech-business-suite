import { CATEGORY_PATTERN, EXPENSE_CATEGORIES } from '@/demo/demoFinance'
import type { BudgetRow, ExpenseReport } from '@/demo/demoFinance'
import { label } from '@/shared/utilities/format'
import type { ExpenseDto } from './financeApi'

/** Pure rules behind the Expenses screens, kept apart from the components so they can be tested on their own. */

const money = (n: number) => Math.round(n * 100) / 100

// ------------------------------------------------------------------------------------------------ categories
/** "Staff welfare" becomes staff_welfare. Returns '' when nothing usable is left (it must start with a letter and be at least two characters). */
export function toSlug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '')
  return CATEGORY_PATTERN.test(s) ? s : ''
}

const FARM_SET: readonly string[] = EXPENSE_CATEGORIES
const GENERAL_SET = ['supplies', 'rent', 'utilities', 'salaries', 'transport', 'marketing', 'software', 'repairs', 'fuel_energy', 'insurance', 'taxes', 'bank_charges', 'professional_fees', 'travel', 'meals', 'equipment', 'other']

/** The categories to offer: the starting set for this kind of business, plus every category already used (so old entries and typed ones stay choosable). "Other" is last. */
export function categoryChoices(industry: string, used: Iterable<string> = []): string[] {
  const all = new Set<string>([...(industry === 'farm' ? FARM_SET : GENERAL_SET), ...used])
  return [...all].sort((a, z) => (a === 'other' ? 1 : z === 'other' ? -1 : label(a).localeCompare(label(z))))
}

// --------------------------------------------------------------------------------------------------- budgets
export interface BudgetTotals { budgeted: number; spentOnBudgeted: number; remaining: number; unbudgetedSpend: number; overCount: number }
export function budgetTotals(rows: BudgetRow[]): BudgetTotals {
  const withBudget = rows.filter((r) => r.budget !== null)
  const budgeted = money(withBudget.reduce((a, r) => a + (r.budget ?? 0), 0))
  const spentOnBudgeted = money(withBudget.reduce((a, r) => a + r.spent, 0))
  return { budgeted, spentOnBudgeted, remaining: money(budgeted - spentOnBudgeted), unbudgetedSpend: money(rows.filter((r) => r.budget === null).reduce((a, r) => a + r.spent, 0)), overCount: withBudget.filter((r) => r.spent > (r.budget ?? 0)).length }
}
export type Usage = { pct: number; state: 'ok' | 'near' | 'over' | 'none' }
/** How much of a budget is used: near at 80%, over above 100%. No budget, no state. */
export function usage(budget: number | null, spent: number): Usage {
  if (budget === null || budget <= 0) return { pct: 0, state: 'none' }
  const pct = Math.round((spent / budget) * 100)
  return { pct, state: spent > budget ? 'over' : pct >= 80 ? 'near' : 'ok' }
}
/** A month as YYYY-MM-01, moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// ---------------------------------------------------------------------------------------------------- periods
export type Preset = 'this_month' | 'last_month' | 'this_year' | 'last_30'
export const PRESETS: { key: Preset; label: string }[] = [{ key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: 'last_30', label: 'Last 30 days' }, { key: 'this_year', label: 'This year' }]
/** The dates a preset means, as of `today` (YYYY-MM-DD). */
export function periodFor(preset: Preset, today: string): { from: string; to: string } {
  const first = `${today.slice(0, 7)}-01`
  if (preset === 'this_month') return { from: first, to: today }
  if (preset === 'last_month') { const f = shiftMonth(first, -1); const lastDay = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10); return { from: f, to: lastDay } }
  if (preset === 'this_year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29)
  return { from: d.toISOString().slice(0, 10), to: today }
}

// --------------------------------------------------------------------------------------------------- the list
export interface ExpenseFilter { q?: string; category?: string; method?: string; status?: 'all' | 'posted' | 'voided'; from?: string; to?: string }
export function filterExpenses(list: ExpenseDto[], f: ExpenseFilter): ExpenseDto[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return list.filter((e) => (!f.category || e.category === f.category) && (!f.method || e.method === f.method) && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to)
    && (!f.status || f.status === 'all' || e.status === f.status) && (!q || e.description.toLowerCase().includes(q) || e.number.toLowerCase().includes(q) || label(e.category).toLowerCase().includes(q)))
}

export function expensesExport(list: ExpenseDto[], supplier: (id: string | null) => string | undefined): (string | number | null)[][] {
  return [
    ['Number', 'Date', 'Description', 'Category', 'Amount', 'Paid by', 'Supplier', 'Status', 'Void reason'],
    ...list.map((e) => [e.number, e.date, e.description, label(e.category), e.amount, label(e.method), supplier(e.supplierId) ?? null, e.status, e.voidReason]),
  ]
}

export function reportExport(r: ExpenseReport): (string | number | null)[][] {
  return [
    ['By category', 'Amount', 'Entries', 'Share of total (%)'],
    ...r.byCategory.map((c) => [label(c.category), c.total, c.count, r.total ? Math.round((c.total / r.total) * 1000) / 10 : 0]),
    [], ['By month', 'Amount'], ...r.byMonth.map((m) => [m.month, m.total]),
    [], ['By payment method', 'Amount'], ...r.byMethod.map((m) => [label(m.method), m.total]),
    [], ['Top suppliers', 'Amount'], ...r.bySupplier.map((s) => [s.supplier, s.total]),
  ]
}
