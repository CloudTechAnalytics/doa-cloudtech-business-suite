import { BarChart3, FileText, Package, Receipt, ShoppingBasket, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ModuleStatus } from '@/core/module-registry/availability'
import type { ModuleCode } from '@/shared/types/domain'

/**
 * The standalone apps: tools any business can switch on without an industry. Each one is a shared platform module (or two), so switching an app on or off is
 * enabling or disabling its modules, which the database already enforces (permission, plan and enabled state) and which never deletes records.
 * Industry apps (Farm, Bakery, Mart, Pharmacy, School) are not listed here: they come from the industry registry.
 */
export interface StandaloneApp {
  id: 'crm' | 'pos' | 'expenses' | 'finance' | 'inventory' | 'invoices'
  name: string
  tagline: string
  description: string
  benefits: string[]
  /** What the free plan includes, in plain words. Limits themselves live in the plan data, not here. */
  free: string
  icon: LucideIcon
  color: string
  /** Every module the app needs; the app is on when all of them are on. */
  modules: ModuleCode[]
  /** The module that opens when the app is opened. */
  home: ModuleCode
}

export const STANDALONE_APPS: StandaloneApp[] = [
  {
    id: 'crm', name: 'DOA CRM', tagline: 'Know your customers and close more sales', icon: Users, color: '#d6336c', modules: ['customers'], home: 'customers',
    description: 'Contacts and customers, leads, a deal pipeline, quotes, follow-ups and a pipeline report.',
    benefits: ['Keep every customer, note and follow-up in one place', 'Move deals from new to won and see what is likely to close', 'Send numbered, printable quotes'],
    free: 'Included in every plan.',
  },
  {
    id: 'pos', name: 'DOA POS', tagline: 'Record sales and print receipts', icon: ShoppingBasket, color: '#2f9e44', modules: ['sales'], home: 'sales',
    description: 'Point of sale with payments, split payments, receipts, returns and sales history. No retail setup needed.',
    benefits: ['Sell products and services in a few taps', 'Cash, transfer, card and split payments', 'Printable receipts and a record of every sale'],
    free: 'Included in every plan.',
  },
  {
    id: 'inventory', name: 'DOA Inventory', tagline: 'Know what you have in stock', icon: Package, color: '#e8590c', modules: ['inventory'], home: 'inventory',
    description: 'Products, stock in a movement ledger, adjustments, counts and low-stock alerts.',
    benefits: ['Stock is a history of movements, not a number someone can overwrite', 'Counts and adjustments with reasons', 'See what is running low'],
    free: 'Included in every plan.',
  },
  {
    id: 'invoices', name: 'DOA Invoices', tagline: 'Bill customers and see what is owed', icon: FileText, color: '#0b7285', modules: ['invoices'], home: 'invoices',
    description: 'Invoices for your customers, payments against them, what is outstanding and overdue, and printable invoices. An accepted CRM quote becomes an invoice.',
    benefits: ['Numbered invoices with discount and tax', 'Record part and full payments; reverse mistakes with a reason', 'Payments appear in Finance without entering them twice'],
    free: 'Included in every plan.',
  },
  {
    id: 'expenses', name: 'DOA Expenses', tagline: 'Record what the business spends', icon: Receipt, color: '#e03131', modules: ['expenses'], home: 'expenses',
    description: 'Expenses by category, payment method and date, with summaries. Expenses appear in Finance without a second entry.',
    benefits: ['Record an expense in seconds', 'See spending by category and period', 'Voided, never deleted, so the books stay honest'],
    free: 'Included in every plan.',
  },
  {
    id: 'finance', name: 'DOA Finance', tagline: 'A simple view of money in and out', icon: BarChart3, color: '#017e84', modules: ['reports'], home: 'reports',
    description: 'Income and expense summaries, cash in and out, what customers owe and what you owe. Cash basis: it is not an accounting package and does not calculate audited profit.',
    benefits: ['Cash in and out for any period', 'Receivables from sales and invoices, payables from purchases', 'Plain labels: cash, owed and estimated, never "audited"'],
    free: 'Included in every plan.',
  },
]

export type AppState = 'active' | 'needs_plan' | 'no_permission' | 'available' | 'unavailable'

/**
 * Where an app stands for the open business. "unavailable" means the business type has no such app (for example a school has no POS);
 * "available" means it can be switched on; the rest follow the module states the database reports.
 */
export function appState(app: StandaloneApp, statuses: ModuleStatus[]): AppState {
  const mine = app.modules.map((m) => statuses.find((s) => s.code === m))
  if (mine.some((s) => !s)) return 'unavailable'
  const s = mine as ModuleStatus[]
  if (s.every((x) => x.enabled)) {
    if (s.some((x) => !x.entitled)) return 'needs_plan'
    if (s.some((x) => !x.permitted)) return 'no_permission'
    return 'active'
  }
  return 'available'
}

/** An app can be switched off unless one of its modules is required by the business type. */
export const canSwitchOff = (app: StandaloneApp, statuses: ModuleStatus[]) => app.modules.every((m) => { const s = statuses.find((x) => x.code === m); return !!s && !s.isCore && !s.isRequired })
