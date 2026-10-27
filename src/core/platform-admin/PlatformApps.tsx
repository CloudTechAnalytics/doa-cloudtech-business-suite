import { Link } from 'react-router-dom'
import { STANDALONE_APPS, appName } from '@/core/app-catalogue/apps'
import { Badge, Card } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { loadAppAdoption } from './platformApi'
import type { PBusinessDetail } from './platformApi'
import { AppChips, when } from './platformUi'

/** Which app each module belongs to, so the history of modules can be read as apps (POS also carries Inventory, so inventory counts for both). */
const appsOfModule = (module: string) => STANDALONE_APPS.filter((a) => a.modules.includes(module)).map((a) => a.id)

/**
 * What a Business apps workspace really is: the app it started as, the apps it has on now, how much each is used, and when each was switched on or off.
 * An app that is on but never used shows as "not used yet", which is the signal the platform team wants.
 */
export function AppsCard({ b }: { b: PBusinessDetail }) {
  const started = b.startedWithApp
  const events = b.appEvents.filter((e) => appsOfModule(e.module).length)
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Apps</h2>
        <p className="text-sm text-ink/70">{started ? <>Started with <b>{appName(started)}</b></> : 'Starting app not recorded'}{b.apps.length > 1 && started ? <> · now uses {b.apps.length} apps</> : null}</p>
      </div>
      <div className="mt-2"><AppChips apps={b.apps} startedWith={started} /></div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1.5 pr-3">App</th><th className="py-1.5 pr-3">State</th><th className="py-1.5 pr-3 text-right">Records</th><th className="py-1.5">Last used</th></tr></thead>
          <tbody className="divide-y divide-ink/10">
            {STANDALONE_APPS.map((a) => {
              const on = b.apps.includes(a.id); const act = b.appActivity[a.id]
              return (
                <tr key={a.id} className={on ? '' : 'text-ink/50'}>
                  <td className="py-1.5 pr-3 font-medium">{a.name}</td>
                  <td className="py-1.5 pr-3">{on ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{a.id === 'finance' ? '–' : act?.records ?? 0}</td>
                  <td className="py-1.5">{a.id === 'finance' ? <span className="text-ink/60">Reads the other apps</span> : act?.lastAt ? when(act.lastAt) : on ? <span className="text-warning">Not used yet</span> : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h3 className="mb-1 mt-4 text-sm font-semibold">When apps were switched on or off</h3>
      {events.length ? (
        <ul className="divide-y divide-ink/10 text-sm">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span><b>{appsOfModule(e.module).map(appName).join(' / ')}</b> {e.action === 'start' ? 'was the starting app' : e.action === 'on' ? 'switched on' : 'switched off'}{e.by ? <span className="text-ink/60"> by {e.by}</span> : null}</span>
              <span className="text-xs text-ink/60">{when(e.at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink/60">No changes since the workspace was set up.</p>}
    </Card>
  )
}

/** Across all Business apps workspaces: for each app, how many use it, started with it, grew from it to a second app, and used it in the last 30 days. */
export function AdoptionCard() {
  const data = useAsync(loadAppAdoption, [])
  const rows = data.data ?? []
  const total = rows.reduce((a, r) => a + r.started, 0)
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold">Apps in use</h2><Link to="/platform/businesses" className="text-sm font-semibold underline">See workspaces</Link></div>
      {data.loading && !data.data ? <p className="text-sm text-ink/60">Loading…</p> : total === 0 && rows.every((r) => r.workspaces === 0) ? <p className="text-sm text-ink/60">No apps workspaces yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-1.5 pr-3">App</th><th className="py-1.5 pr-3 text-right" title="Workspaces with the app on now">Using</th><th className="py-1.5 pr-3 text-right" title="Workspaces that began with this app">Started</th><th className="py-1.5 pr-3 text-right" title="Began with this app and later added another">Grew</th><th className="py-1.5 text-right" title="Used in the last 30 days">Active</th></tr></thead>
            <tbody className="divide-y divide-ink/10">{rows.map((r) => <tr key={r.app}><td className="py-1.5 pr-3 font-medium">{appName(r.app)}</td><td className="tabular py-1.5 pr-3 text-right">{r.workspaces}</td><td className="tabular py-1.5 pr-3 text-right">{r.started}</td><td className="tabular py-1.5 pr-3 text-right">{r.grew}</td><td className="tabular py-1.5 text-right">{r.active30d}</td></tr>)}</tbody>
          </table>
          <p className="mt-2 text-xs text-ink/60">Counts Business apps workspaces only. Grew = started with the app and has since switched on another. Active = used in the last 30 days.</p>
        </div>
      )}
    </Card>
  )
}
