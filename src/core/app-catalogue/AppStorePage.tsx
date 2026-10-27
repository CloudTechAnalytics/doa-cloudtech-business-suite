import clsx from 'clsx'
import { ArrowRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { appPath } from '@/app/navigation/navigation'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { INDUSTRIES } from '@/core/industry-registry'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { disableModule, enableModule } from '@/core/module-registry/moduleActions'
import { MODULES } from '@/core/module-registry/registry'
import { usePermissions } from '@/core/permissions/usePermissions'
import { UsagePanel } from '@/core/subscriptions/UsageViews'
import { canManageStaff } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { Badge, Button, EmptyState, ErrorState, PageHeader } from '@/shared/components'
import { AppDetailsPanel } from './AppDetails'
import { ConfirmSwitch } from './ConfirmSwitch'
import { APP_CATEGORIES, STANDALONE_APPS, appState, modulesToSwitchOff } from './apps'
import type { AppState, StandaloneApp } from './apps'
import { STORE_FILTERS, actionsFor, filterApps, installedCount } from './storeLogic'
import type { StoreAction, StoreFilter } from './storeLogic'

const STATE: Record<AppState, { tone: 'success' | 'info' | 'warning' | 'neutral'; text: string }> = {
  active: { tone: 'success', text: 'Installed' }, available: { tone: 'neutral', text: 'Not installed' }, needs_plan: { tone: 'warning', text: 'Needs a higher plan' },
  no_permission: { tone: 'warning', text: 'No access' }, unavailable: { tone: 'neutral', text: 'Not for this business type' },
}
const categoryName = (app: StandaloneApp) => APP_CATEGORIES.find((c) => c.key === app.category)?.label ?? ''

/**
 * The App Store: every app, whether it is installed for this business, and what it does. Installing one switches on only that app (and anything it cannot work without);
 * removing one hides it and keeps every record, so installing it again brings everything back. Whole business types (a school, a farm) are separate businesses, so they start one.
 */
export function AppStorePage() {
  const { active } = useBusiness()
  const { statuses, refresh } = useModules()
  const [filter, setFilter] = useState<StoreFilter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<StandaloneApp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Installing or removing is only done after the person confirms what it changes.
  const [confirm, setConfirm] = useState<{ app: StandaloneApp; on: boolean } | null>(null)
  const perms = usePermissions(active?.id ?? '')
  if (!active) return null
  // The demo's role table has no settings.manage; the demo lets the owner and admins change apps, as the live database does.
  const canManage = isDemoMode ? canManageStaff(active.role ?? null) : perms.can('settings.manage')

  async function toggle(app: StandaloneApp, on: boolean) {
    setBusy(app.id); setError(null)
    let failed = false
    for (const m of on ? app.modules : modulesToSwitchOff(app, statuses)) {
      const s = statuses.find((x) => x.code === m)
      if (on && s?.enabled) continue
      const err = on ? await enableModule(active!.id, m) : await disableModule(active!.id, m)
      if (err) { setError(err); failed = true; break }
    }
    await refresh(); setBusy(null)
    return !failed
  }
  const ask = (app: StandaloneApp, on: boolean) => { setError(null); setConfirm({ app, on }) }

  const apps = filterApps(statuses, filter, query)
  const showBusinesses = filter === 'all' || filter === 'businesses'
  const businesses = Object.values(INDUSTRIES).filter((d) => d.status === 'active' && d.id !== 'general' && (!query.trim() || `${d.name} ${d.description}`.toLowerCase().includes(query.trim().toLowerCase())))

  return (
    <>
      <PageHeader title="Apps" description={`Pick the tools ${active.name} uses. ${installedCount(statuses)} of ${STANDALONE_APPS.length} apps are installed. Removing one hides it and keeps your records.`} />
      {error && !confirm && <ErrorState message={error} />}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-64 flex-1 sm:max-w-md">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/50" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, e.g. invoice, stock, quote" className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm" />
        </label>
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter apps">
        {STORE_FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
            className={clsx('rounded-full border px-3 py-1.5 text-sm transition', filter === f.key ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/80 hover:bg-surface')}>{f.label}</button>
        ))}
      </div>

      {apps.length === 0 && !(showBusinesses && businesses.length) && <EmptyState title="No apps match" description="Try another word, or choose All." />}
      {apps.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white shadow-card">
          {apps.map((app) => {
            const st = appState(app, statuses); const a = actionsFor(app, statuses, canManage)
            return (
              <li key={app.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:bg-surface/60">
                <button type="button" onClick={() => setOpen(app)} className="flex min-w-0 flex-1 basis-72 items-center gap-4 text-left" aria-label={`Details of ${app.name}`}>
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: app.color }}><app.icon className="size-6" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{app.name}</span><span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink/60">{categoryName(app)}</span></span>
                    <span className="block text-sm text-ink/70">{app.tagline}</span>
                  </span>
                </button>
                <Badge tone={STATE[st].tone}>{STATE[st].text}</Badge>
                <span className="flex items-center gap-2"><ActionButtons app={app} action={a.primary} onAsk={ask} busy={busy === app.id} compact /></span>
              </li>
            )
          })}
        </ul>
      )}

      {showBusinesses && businesses.length > 0 && (
        <section className="mt-8" aria-label="Whole businesses">
          <h2 className="text-lg font-semibold">Whole businesses</h2>
          <p className="mb-3 max-w-2xl text-sm text-ink/70">A shop, farm, bakery, pharmacy or school is a business of its own kind, with its own screens, so it is started as a separate business rather than installed into this one. Your businesses stay separate.</p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {businesses.map((d) => (
              <li key={d.id} className="flex items-start gap-3 rounded-xl border border-line bg-white p-4 shadow-card">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-white"><d.icon className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="font-semibold">{d.name}</p><p className="text-xs text-ink/60">{d.description}</p>
                  {d.id === active.industry ? <p className="mt-2 text-xs font-semibold text-success">This is your business type</p> : <Link to="/onboarding" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Start a {d.name.toLowerCase()} business <ArrowRight className="size-3.5" aria-hidden /></Link>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8"><UsagePanel /></div>

      {open && <AppSheet app={open} state={appState(open, statuses)} action={actionsFor(open, statuses, canManage)} busy={busy === open.id} onAsk={ask} onClose={() => setOpen(null)} />}
      {confirm && (
        <ConfirmSwitch app={confirm.app} on={confirm.on} businessId={active.id} businessName={active.name} busy={busy === confirm.app.id} error={error}
          keepsOn={confirm.on ? [] : confirm.app.modules.filter((m) => !modulesToSwitchOff(confirm.app, statuses).includes(m))}
          onCancel={() => { setConfirm(null); setError(null) }}
          onConfirm={() => void toggle(confirm.app, confirm.on).then((ok) => { if (ok) setConfirm(null) })} />
      )}
    </>
  )
}

function ActionButtons({ app, action, onAsk, busy, compact = false }: { app: StandaloneApp; action: StoreAction; onAsk: (a: StandaloneApp, on: boolean) => void; busy: boolean; compact?: boolean }) {
  if (action.kind === 'open') return <Link to={appPath(MODULES[app.home])} className="inline-flex h-9 items-center rounded-md bg-amber px-3 text-sm font-semibold text-ink hover:bg-amber-dark">Open</Link>
  if (action.kind === 'install') return <Button loading={busy} onClick={() => onAsk(app, true)}>Install</Button>
  if (action.kind === 'remove') return <Button variant="secondary" loading={busy} onClick={() => onAsk(app, false)}>Remove</Button>
  if (action.kind === 'plans') return <Link to="/app/settings" className="text-sm font-semibold underline">See plans</Link>
  return compact ? null : <p className="text-xs text-ink/60">{action.note}</p>
}

/** The details of one app, with Install or Remove at the bottom. */
function AppSheet({ app, state, action, busy, onAsk, onClose }: { app: StandaloneApp; state: AppState; action: ReturnType<typeof actionsFor>; busy: boolean; onAsk: (a: StandaloneApp, on: boolean) => void; onClose: () => void }) {
  return (
    <AppDetailsPanel app={app} onClose={onClose} badge={<Badge tone={STATE[state].tone}>{STATE[state].text}</Badge>}
      footer={<><ActionButtons app={app} action={action.primary} onAsk={onAsk} busy={busy} />{action.secondary && <ActionButtons app={app} action={action.secondary} onAsk={onAsk} busy={busy} />}</>} />
  )
}
