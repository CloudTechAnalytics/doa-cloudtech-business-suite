import { AlertTriangle, ArrowLeftRight, BarChart3, Banknote, CalendarCheck, ClipboardList, Clock, CreditCard, FileCheck, FilePlus, FileText, HandCoins, KanbanSquare, Package, PackagePlus, PieChart, Printer, Receipt, ShoppingBasket, Undo2, UserPlus, Users, Wallet } from 'lucide-react'
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
  /** What it does, in the order a person uses it: shown in the public Apps menu. */
  features: { label: string; icon: LucideIcon }[]
}

/** Where an app's link on the public site goes: the sign-in page for that app. After signing in (or creating an account) the person lands on the app's start page. */
export const startPath = (app: Pick<StandaloneApp, 'id'>) => `/sign-in?app=${app.id}`

export const STANDALONE_APPS: StandaloneApp[] = [
  {
    id: 'crm', name: 'DOA CRM', tagline: 'Know your customers and close more sales', icon: Users, color: '#d6336c', modules: ['customers'], home: 'customers',
    features: [{ label: 'Contacts & customers', icon: Users }, { label: 'Leads', icon: UserPlus }, { label: 'Deals pipeline', icon: KanbanSquare }, { label: 'Quotes', icon: FileText }, { label: 'Follow-ups', icon: CalendarCheck }, { label: 'CRM reports', icon: BarChart3 }],
    description: 'Contacts and customers, leads, a deal pipeline, quotes, follow-ups and a pipeline report.',
    benefits: ['Keep every customer, note and follow-up in one place', 'Move deals from new to won and see what is likely to close', 'Send numbered, printable quotes'],
    free: 'Included in every plan.',
  },
  {
    id: 'pos', name: 'DOA POS', tagline: 'Record sales and print receipts', icon: ShoppingBasket, color: '#2f9e44', modules: ['sales', 'inventory'], home: 'sales',
    features: [{ label: 'Sell products and services', icon: ShoppingBasket }, { label: 'Payments and split payments', icon: CreditCard }, { label: 'Receipts', icon: Receipt }, { label: 'Returns and voids', icon: Undo2 }, { label: 'Products and prices', icon: Package }],
    description: 'Point of sale with payments, split payments, receipts, returns and sales history. It carries its own product list (the same products as Inventory), and needs no retail setup.',
    benefits: ['Sell products and services in a few taps', 'Cash, transfer, card and split payments', 'Printable receipts and a record of every sale'],
    free: 'Included in every plan.',
  },
  {
    id: 'inventory', name: 'DOA Inventory', tagline: 'Know what you have in stock', icon: Package, color: '#e8590c', modules: ['inventory'], home: 'inventory',
    features: [{ label: 'Products', icon: Package }, { label: 'Stock in and adjustments', icon: PackagePlus }, { label: 'Stock counts', icon: ClipboardList }, { label: 'Low-stock alerts', icon: AlertTriangle }],
    description: 'Products, stock in a movement ledger, adjustments, counts and low-stock alerts.',
    benefits: ['Stock is a history of movements, not a number someone can overwrite', 'Counts and adjustments with reasons', 'See what is running low'],
    free: 'Included in every plan.',
  },
  {
    id: 'invoices', name: 'DOA Invoices', tagline: 'Bill customers and see what is owed', icon: FileText, color: '#0b7285', modules: ['invoices'], home: 'invoices',
    features: [{ label: 'New invoice', icon: FilePlus }, { label: 'Payments received', icon: Banknote }, { label: 'Overdue and owed', icon: Clock }, { label: 'Quote to invoice', icon: FileCheck }, { label: 'Print or save as PDF', icon: Printer }],
    description: 'Invoices for your customers, payments against them, what is outstanding and overdue, and printable invoices. An accepted CRM quote becomes an invoice.',
    benefits: ['Numbered invoices with discount and tax', 'Record part and full payments; reverse mistakes with a reason', 'Payments appear in Finance without entering them twice'],
    free: 'Included in every plan.',
  },
  {
    id: 'expenses', name: 'DOA Expenses', tagline: 'Record what the business spends', icon: Receipt, color: '#e03131', modules: ['expenses'], home: 'expenses',
    features: [{ label: 'Record an expense', icon: Receipt }, { label: 'By category and period', icon: PieChart }, { label: 'Spending summaries', icon: BarChart3 }],
    description: 'Expenses by category, payment method and date, with summaries. Expenses appear in Finance without a second entry.',
    benefits: ['Record an expense in seconds', 'See spending by category and period', 'Voided, never deleted, so the books stay honest'],
    free: 'Included in every plan.',
  },
  {
    id: 'finance', name: 'DOA Finance', tagline: 'A simple view of money in and out', icon: BarChart3, color: '#017e84', modules: ['reports'], home: 'reports',
    features: [{ label: 'Cash in and out', icon: ArrowLeftRight }, { label: 'What customers owe', icon: HandCoins }, { label: 'What you owe', icon: Wallet }, { label: 'Summary for any period', icon: BarChart3 }],
    description: 'Income and expense summaries, cash in and out, what customers owe and what you owe. Cash basis: it is not an accounting package and does not calculate audited profit.',
    benefits: ['Cash in and out for any period', 'Receivables from sales and invoices, payables from purchases', 'Plain labels: cash, owed and estimated, never "audited"'],
    free: 'Included in every plan.',
  },
]

/** What switching an app off does, in plain words: what stops, what is kept, and what keeps working. Shown in the confirmation before it happens. */
export const SWITCH_OFF_EFFECTS: Record<StandaloneApp['id'], string[]> = {
  crm: ['Customers, leads, deals and quotes are kept but hidden from the menu.', 'Nobody can add contacts or send quotes until it is switched back on.', 'Quotes can no longer be turned into invoices.'],
  pos: ['Selling stops: nobody can record sales or returns.', 'Past sales and receipts are kept and still count in Finance.'],
  inventory: ['Products and stock are hidden, and stock cannot be received, adjusted or counted.', 'Stock levels are kept exactly as they are.'],
  invoices: ['Nobody can create invoices or record payments.', 'Existing invoices and payments are kept, and unpaid invoices still show in Finance as money owed.'],
  expenses: ['Nobody can record expenses.', 'Past expenses are kept and still count in Finance.'],
  finance: ['Reports, the cashbook and the lists of what is owed are hidden.', 'Nothing changes in the apps that feed it; the figures are back when you switch it on again.'],
}

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

/** Other apps that are on and need all of this app's modules (POS carries the Inventory module for its product list, so Inventory cannot go while POS is on). */
export const neededBy = (app: StandaloneApp, statuses: ModuleStatus[]) => STANDALONE_APPS.filter((o) => o.id !== app.id && app.modules.every((m) => o.modules.includes(m)) && appState(o, statuses) === 'active')

/** The modules to switch off for this app: its own, except any that another app that is on still uses. */
export const modulesToSwitchOff = (app: StandaloneApp, statuses: ModuleStatus[]) => app.modules.filter((m) => !STANDALONE_APPS.some((o) => o.id !== app.id && o.modules.includes(m) && appState(o, statuses) === 'active'))

/** An app can be switched off unless a module is required by the business type or another app that is on still needs it. */
export const canSwitchOff = (app: StandaloneApp, statuses: ModuleStatus[]) => app.modules.every((m) => { const s = statuses.find((x) => x.code === m); return !!s && !s.isCore && !s.isRequired }) && neededBy(app, statuses).length === 0

/** The apps whose modules are all on, in catalogue order. The database twin is _business_apps(); a test keeps the two in step. */
export const appsOn = (enabledModules: readonly string[]): StandaloneApp['id'][] => STANDALONE_APPS.filter((a) => a.modules.every((m) => enabledModules.includes(m))).map((a) => a.id)

export const appName = (id: string) => STANDALONE_APPS.find((a) => a.id === id)?.name ?? id
