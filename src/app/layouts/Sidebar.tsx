import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { appPath, sidebarEntries } from '@/app/navigation/navigation'
import type { AppDef } from '@/app/navigation/navigation'

const SHUT_KEY = 'doa.sidebar.shut'
const readShut = (): string[] => { try { return JSON.parse(localStorage.getItem(SHUT_KEY) ?? '[]') as string[] } catch { return [] } }

/**
 * In-app navigation: every usable module, grouped by app. Collapses to icons on wide screens
 * (remembered per browser); on narrow screens the shell shows it as a drawer.
 */
export function Sidebar({ apps, collapsed = false, onNavigate }: { apps: AppDef[]; collapsed?: boolean; onNavigate?: () => void }) {
  const entries = sidebarEntries(apps)
  const { pathname } = useLocation()
  // Section headings fold their links away (remembered per browser); the section holding the open page opens by itself.
  const [shut, setShut] = useState<string[]>(readShut)
  const toggle = (key: string) => setShut((cur) => { const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]; try { localStorage.setItem(SHUT_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ } return next })
  useEffect(() => {
    const here = entries.find((e) => e.kind === 'link' && (pathname === appPath(e.module) || pathname.startsWith(`${appPath(e.module)}/`)))
    if (here && here.kind === 'link' && apps.find((a) => a.id === here.app.id)!.modules.length > 1) setShut((cur) => (cur.includes(`h-${here.app.id}`) ? cur.filter((k) => k !== `h-${here.app.id}`) : cur))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  const item = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'group flex items-center gap-3 rounded-lg text-sm transition-colors',
      collapsed ? 'size-10 justify-center' : 'px-3 py-2',
      isActive ? 'bg-amber/20 font-semibold text-ink shadow-[inset_3px_0_0_var(--color-amber)]' : 'text-ink/75 hover:bg-surface hover:text-ink',
    )

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className={clsx('min-h-0 flex-1 space-y-0.5 overflow-y-auto py-3', collapsed ? 'flex flex-col items-center px-2' : 'px-3')}>
        {entries.map((e) =>
          e.kind === 'heading' ? (
            collapsed ? <hr key={e.key} className="my-2 w-6 border-line" /> : (
              <button key={e.key} type="button" onClick={() => toggle(e.key)} aria-expanded={!shut.includes(e.key)} className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/45 hover:text-ink">
                {e.label}{shut.includes(e.key) ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
              </button>
            )
          ) : !collapsed && shut.includes(`h-${e.app.id}`) && e.app.modules.length > 1 ? null : (
            <NavLink key={e.key} to={appPath(e.module)} onClick={onNavigate} title={collapsed ? e.module.name : undefined} aria-label={collapsed ? e.module.name : undefined} className={item}>
              <e.module.icon className="size-[18px] shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{e.module.name}</span>}
              {!collapsed && e.module.maturity && <span className="ml-auto rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink/50">{e.module.maturity === 'soon' ? 'Soon' : 'Preview'}</span>}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  )
}
