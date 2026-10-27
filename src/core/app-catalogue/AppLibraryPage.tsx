import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { appPath } from '@/app/navigation/navigation'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { getIndustry } from '@/core/industry-registry'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { disableModule, enableModule } from '@/core/module-registry/moduleActions'
import { MODULES } from '@/core/module-registry/registry'
import { usePermissions } from '@/core/permissions/usePermissions'
import { UsagePanel } from '@/core/subscriptions/UsageViews'
import { canManageStaff } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { Badge, Button, ErrorState, PageHeader } from '@/shared/components'
import { ConfirmSwitch } from './ConfirmSwitch'
import { STANDALONE_APPS, appState, canSwitchOff, modulesToSwitchOff, neededBy } from './apps'
import type { AppState, StandaloneApp } from './apps'

const STATE: Record<AppState, { tone: 'success' | 'info' | 'warning' | 'neutral'; text: string }> = {
  active: { tone: 'success', text: 'On' }, available: { tone: 'neutral', text: 'Off' }, needs_plan: { tone: 'warning', text: 'Needs a higher plan' },
  no_permission: { tone: 'warning', text: 'No access' }, unavailable: { tone: 'neutral', text: 'Not for this business type' },
}

/**
 * The App Library: the standalone apps with what each does, whether it is on for this business, and a switch. Switching an app off hides it from the menus and
 * never deletes its records; switching it on again brings everything back. Only people who can change settings see the buttons, and the database checks that too.
 */
export function AppLibraryPage() {
  const { active } = useBusiness()
  const { statuses, refresh } = useModules()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // The switch is only made after the person confirms what it changes.
  const [confirm, setConfirm] = useState<{ app: StandaloneApp; on: boolean } | null>(null)
  const perms = usePermissions(active?.id ?? '')
  if (!active) return null
  const industry = getIndustry(active.industry)
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

  const ownModules = industry.modules.filter((m) => statuses.find((s) => s.code === m.code)?.enabled)
  return (
    <>
      <PageHeader title="App Library" description={`Switch on the tools ${active.name} needs. Switching one off hides it; your records are kept and come back when you switch it on again.`} />
      {error && <ErrorState message={error} />}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STANDALONE_APPS.map((app) => {
          const st = appState(app, statuses); const info = STATE[st]
          return (
            <li key={app.id} className="flex flex-col rounded-xl border border-line bg-white p-4 shadow-card">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: app.color }}><app.icon className="size-5" aria-hidden /></span>
                <div className="min-w-0"><h2 className="font-semibold">{app.name}</h2><p className="text-xs text-ink/60">{app.tagline}</p></div>
                <span className="ml-auto shrink-0"><Badge tone={info.tone}>{info.text}</Badge></span>
              </div>
              <p className="mt-3 text-sm text-ink/80">{app.description}</p>
              <ul className="mt-2 space-y-1 text-xs text-ink/70">{app.benefits.map((b) => <li key={b} className="flex gap-1.5"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />{b}</li>)}</ul>
              <p className="mt-2 text-xs font-medium text-ink/60">{app.free}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {st === 'active' && <Link to={appPath(MODULES[app.home])} className="inline-flex h-9 items-center rounded-md bg-amber px-3 text-sm font-semibold text-ink hover:bg-amber-dark">Open</Link>}
                {st === 'available' && canManage && <Button onClick={() => { setError(null); setConfirm({ app, on: true }) }}>Switch on</Button>}
                {st === 'available' && !canManage && <span className="text-xs text-ink/60">Ask the business owner to switch it on.</span>}
                {st === 'active' && canManage && neededBy(app, statuses).length > 0 && <span className="text-xs text-ink/60">Needed by {neededBy(app, statuses).map((o) => o.name).join(', ')}.</span>}
                {st === 'active' && canManage && canSwitchOff(app, statuses) && <Button variant="secondary" onClick={() => { setError(null); setConfirm({ app, on: false }) }}>Switch off</Button>}
                {st === 'needs_plan' && <Link to="/app/settings" className="text-sm font-semibold underline">See plans</Link>}
                {st === 'unavailable' && <span className="text-xs text-ink/60">{industry.name} has its own tools for this. Create a Business apps workspace to use it on its own.</span>}
              </div>
            </li>
          )
        })}
      </ul>

      {confirm && (
        <ConfirmSwitch app={confirm.app} on={confirm.on} businessId={active.id} businessName={active.name} busy={busy === confirm.app.id} error={error}
          keepsOn={confirm.on ? [] : confirm.app.modules.filter((m) => !modulesToSwitchOff(confirm.app, statuses).includes(m))}
          onCancel={() => { setConfirm(null); setError(null) }}
          onConfirm={() => void toggle(confirm.app, confirm.on).then((ok) => { if (ok) setConfirm(null) })} />
      )}

      <div className="mt-8"><UsagePanel /></div>

      <h2 className="mb-2 mt-8 text-lg font-semibold">Industry app for this business</h2>
      <div className="rounded-xl border border-line bg-white p-4 shadow-card">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-accent text-white"><industry.icon className="size-5" aria-hidden /></span>
          <div><p className="font-semibold">{industry.name}</p><p className="text-xs text-ink/60">{industry.description}</p></div></div>
        {ownModules.length > 0
          ? <p className="mt-3 text-xs text-ink/70">Includes: {ownModules.map((m) => m.name).join(', ')}.</p>
          : <p className="mt-3 text-xs text-ink/70">{active.industry === 'general' ? 'This workspace has no industry, so it uses the apps above. To run a shop, farm, bakery, pharmacy or school, create a business of that type from Businesses. Each business keeps its own records.' : 'Its screens are in the menu.'}</p>}
      </div>
    </>
  )
}
