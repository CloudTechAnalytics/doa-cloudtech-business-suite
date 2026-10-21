import clsx from 'clsx'
import { ChevronsLeft, ChevronsRight, LayoutGrid } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { appPath, sidebarEntries } from '@/app/navigation/navigation'
import type { AppDef } from '@/app/navigation/navigation'

/**
 * In-app navigation: every usable module, grouped by app. Collapses to icons on wide screens
 * (remembered per browser); on narrow screens the shell shows it as a drawer.
 */
export function Sidebar({ apps, collapsed = false, onToggle, onNavigate }: { apps: AppDef[]; collapsed?: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const entries = sidebarEntries(apps)
  const item = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'group flex items-center gap-3 rounded-lg text-sm transition-colors',
      collapsed ? 'size-10 justify-center' : 'px-3 py-2',
      isActive ? 'bg-brand/10 font-medium text-brand' : 'text-ink/75 hover:bg-surface hover:text-ink',
    )

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className={clsx('min-h-0 flex-1 space-y-0.5 overflow-y-auto py-3', collapsed ? 'flex flex-col items-center px-2' : 'px-3')}>
        <NavLink to="/app" end onClick={onNavigate} title="All apps" className={item}>
          <LayoutGrid className="size-[18px] shrink-0" aria-hidden />
          {!collapsed && 'All apps'}
        </NavLink>
        {entries.map((e) =>
          e.kind === 'heading' ? (
            collapsed ? <hr key={e.key} className="my-2 w-6 border-line" /> : <p key={e.key} className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink/45">{e.label}</p>
          ) : (
            <NavLink key={e.key} to={appPath(e.module)} onClick={onNavigate} title={collapsed ? e.module.name : undefined} aria-label={collapsed ? e.module.name : undefined} className={item}>
              <e.module.icon className="size-[18px] shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{e.module.name}</span>}
              {!collapsed && e.module.maturity && <span className="ml-auto rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink/50">{e.module.maturity === 'soon' ? 'Soon' : 'Preview'}</span>}
            </NavLink>
          ),
        )}
      </div>
      {onToggle && (
        <div className={clsx('border-t border-line p-2', collapsed && 'flex justify-center')}>
          <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink/60 hover:bg-surface hover:text-ink">
            {collapsed ? <ChevronsRight className="size-[18px]" aria-hidden /> : <><ChevronsLeft className="size-[18px]" aria-hidden />Collapse</>}
          </button>
        </div>
      )}
    </nav>
  )
}
