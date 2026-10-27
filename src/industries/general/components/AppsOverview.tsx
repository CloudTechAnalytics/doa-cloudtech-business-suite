import clsx from 'clsx'
import { Boxes, FileText, ShoppingBasket, Users, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { crmReport } from '@/modules/crm/dealsApi'
import { reportSummary } from '@/modules/finance/financeApi'
import { invoiceSummary } from '@/modules/invoices/invoicesApi'
import { stockRows, summarise } from '@/modules/inventory/stockLogic'
import { daySummary, loadCatalog } from '@/modules/sales/tradeApi'
import { Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { naira } from '@/shared/utilities/format'
import type { ModuleCode } from '@/shared/types/domain'

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The dashboard of a Business apps workspace: one card per app that is switched on, each with the few figures that matter and a link into the app.
 * Every card loads its own figures, so one app that cannot be read by this person's role does not hide the others.
 */
export function AppsOverview() {
  const { active } = useBusiness()
  const { statuses } = useModules()
  if (!active) return null
  const on = (c: ModuleCode) => statuses.some((s) => s.code === c && s.usable)
  const b = active.id
  const cards: ReactNode[] = []
  if (on('customers')) cards.push(<CrmCard key="crm" b={b} />)
  if (on('sales')) cards.push(<PosCard key="pos" b={b} />)
  if (on('invoices')) cards.push(<InvoicesCard key="inv" b={b} />)
  if (on('inventory')) cards.push(<StockCard key="stock" b={b} industry={active.industry} />)
  if (on('expenses') || on('reports')) cards.push(<MoneyCard key="money" b={b} />)
  if (!cards.length) return <p className="p-4 text-sm text-ink/70">No app is switched on yet. Open the App Library to switch one on.</p>
  return <div className="grid gap-4 md:grid-cols-2">{cards}</div>
}

function AppCard({ title, icon: Icon, color, to, children }: { title: string; icon: LucideIcon; color: string; to: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-white p-4 shadow-card">
      <header className="mb-3 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md text-white" style={{ background: color }}><Icon className="size-4" aria-hidden /></span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link to={to} className="ml-auto text-xs font-semibold underline">Open</Link>
      </header>
      {children}
    </section>
  )
}
const Stats = ({ items }: { items: { label: string; value: string; tone?: 'warn' | 'bad' }[] }) => (
  <dl className="grid grid-cols-2 gap-3">
    {items.map((i) => (
      <div key={i.label}><dt className="text-[11px] font-medium uppercase tracking-wide text-ink/60">{i.label}</dt><dd className={clsx('tabular mt-0.5 text-lg font-semibold', i.tone === 'warn' && 'text-warning', i.tone === 'bad' && 'text-danger')}>{i.value}</dd></div>
    ))}
  </dl>
)
/** Shows the figures when they loaded, a spinner while they load, and a quiet line when this person may not see them. */
function Load<T>({ state, children }: { state: { data: T | null; loading: boolean; error: string | null }; children: (d: T) => ReactNode }) {
  if (state.data) return <>{children(state.data)}</>
  if (state.loading) return <Spinner />
  return <p className="text-sm text-ink/60">These figures are not available to your role.</p>
}

function CrmCard({ b }: { b: string }) {
  const s = useAsync(() => crmReport(b), [b])
  return (
    <AppCard title="CRM" icon={Users} color="#7048e8" to="/app/customers">
      <Load state={s}>{(r) => <Stats items={[
        { label: 'Open pipeline', value: naira(r.openValue) }, { label: 'Likely to close', value: naira(r.weightedValue) },
        { label: 'Won this month', value: naira(r.wonThisMonth) }, { label: 'Tasks overdue', value: String(r.overdueTasks), tone: r.overdueTasks ? 'bad' : undefined },
      ]} />}</Load>
    </AppCard>
  )
}
function PosCard({ b }: { b: string }) {
  const s = useAsync(() => daySummary(b, iso(new Date())), [b])
  return (
    <AppCard title="POS: today" icon={ShoppingBasket} color="#e8590c" to="/app/sales?tab=today">
      <Load state={s}>{(r) => <Stats items={[
        { label: 'Sales made', value: String(r.salesCount) }, { label: 'Sales total', value: naira(r.gross) },
        { label: 'Still owed', value: naira(r.outstanding), tone: r.outstanding ? 'warn' : undefined }, { label: 'Returns', value: naira(r.returns) },
      ]} />}</Load>
    </AppCard>
  )
}
function InvoicesCard({ b }: { b: string }) {
  const s = useAsync(() => invoiceSummary(b), [b])
  return (
    <AppCard title="Invoices" icon={FileText} color="#1c7ed6" to="/app/invoices">
      <Load state={s}>{(r) => <Stats items={[
        { label: 'Waiting to be paid', value: naira(r.outstanding) }, { label: 'Overdue', value: naira(r.overdue), tone: r.overdue ? 'bad' : undefined },
        { label: 'Paid this month', value: naira(r.paidThisMonth) }, { label: 'Drafts', value: String(r.drafts) },
      ]} />}</Load>
    </AppCard>
  )
}
function StockCard({ b, industry }: { b: string; industry: Parameters<typeof loadCatalog>[1] }) {
  const s = useAsync(async () => { const d = await loadCatalog(b, industry); return summarise(d, stockRows(d)) }, [b, industry])
  return (
    <AppCard title="Inventory" icon={Boxes} color="#0ca678" to="/app/inventory">
      <Load state={s}>{(r) => <Stats items={[
        { label: 'Stock value', value: naira(r.value) }, { label: 'Products in stock', value: String(r.products) },
        { label: 'Out of stock', value: String(r.out), tone: r.out ? 'bad' : undefined }, { label: 'Running low', value: String(r.low), tone: r.low ? 'warn' : undefined },
      ]} />}</Load>
    </AppCard>
  )
}
function MoneyCard({ b }: { b: string }) {
  const s = useAsync(() => { const today = iso(new Date()); return reportSummary(b, `${today.slice(0, 8)}01`, today) }, [b])
  return (
    <AppCard title="Money this month" icon={Wallet} color="#d6336c" to="/app/reports">
      <Load state={s}>{(r) => <Stats items={[
        { label: 'Money in', value: naira(r.cashIn) }, { label: 'Money out', value: naira(r.cashOut) },
        { label: 'Surplus', value: naira(r.operatingSurplus), tone: r.operatingSurplus < 0 ? 'bad' : undefined }, { label: 'Owed to you', value: naira(r.receivablesOpen) },
      ]} />}</Load>
    </AppCard>
  )
}
