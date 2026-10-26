import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Check, ChevronDown, LayoutGrid, Menu as MenuIcon, Plus, ShieldCheck, X } from 'lucide-react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ACCOUNT_MODULES, appPath, buildApps, buildQuickActions, findCurrentApp } from '@/app/navigation/navigation'
import type { ModuleDefinition } from '@/shared/types/domain'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { usePlatformRole } from '@/core/platform-admin/platformUi'
import { resetDemoBakery } from '@/demo/demoBakery'
import { resetDemoCrm } from '@/demo/demoCrm'
import { resetDemoFarm } from '@/demo/demoFarm'
import { resetDemoInventory } from '@/demo/demoInventory'
import { resetDemoMart } from '@/demo/demoMart'
import { resetDemoPharmacy } from '@/demo/demoPharmacy'
import { resetDemoSchool } from '@/demo/demoSchool'
import { demoReset } from '@/demo/demoStore'
import { applyTheme, themeByKey } from '@/core/theme/themes'
import { ViewMenu } from '@/shared/view/ViewMenu'
import { AccountMenu, AttentionBell, RefreshButton } from '@/shared/topbar/TopBar'
import { useWorkspaceAttention } from './useWorkspaceAttention'
import { useGridLabels } from '@/shared/view/useGridLabels'
import { useViewPrefs } from '@/shared/view/viewPrefs'
import { resetDemoTrade } from '@/demo/demoTrade'
import { Spinner } from '@/shared/components'
import { CrumbContext } from '@/shared/components/breadcrumb'
import { DetailSlotContext } from '@/shared/components/detail-page'
import { Menu } from '@/shared/components/menu'
import { isDemoMode } from '@/shared/utilities/env'
import { Sidebar } from './Sidebar'

const COLLAPSE_KEY = 'doa.sidebar.collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }

function BusinessSwitcher() {
  const { businesses, active, select } = useBusiness()
  if (!active) return null
  return (
    <Menu
      label="Switch business"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Business: ${active.name}. Switch business`}
          className="flex h-8 max-w-[11rem] items-center gap-1.5 rounded-full bg-canvas px-3 text-sm text-ink hover:bg-line">
          <Building2 className="size-4 shrink-0" aria-hidden />
          <span className="hidden truncate sm:inline">{active.name}</span>
          <ChevronDown className="size-4 shrink-0 text-ink/60" aria-hidden />
        </button>
      )}
      items={[
        { label: 'Your businesses', heading: true },
        ...businesses.map((b) => ({ label: b.name, icon: b.id === active.id ? <Check className="size-4 text-brand" /> : <span className="size-4" />, onSelect: () => select(b.id) })),
        { label: 'All businesses', to: '/businesses', icon: <LayoutGrid className="size-4" />, divider: true },
        { label: 'Add business', to: '/onboarding', icon: <Plus className="size-4" /> },
      ]}
    />
  )
}

function UserMenu({ modules, roleLabel }: { modules: ModuleDefinition[]; roleLabel: string }) {
  const platform = usePlatformRole()
  return (
    <AccountMenu
      roleLabel={roleLabel}
      extra={[
        ...modules.map((m) => ({ label: m.name, to: appPath(m), icon: <m.icon className="size-4" /> })),
        ...(platform.data ? [{ label: 'Platform console', to: '/platform', icon: <ShieldCheck className="size-4" /> }] : []),
      ]}
    />
  )
}

function RecordMenu({ items }: { items: { label: string; to: string }[] }) {
  if (!items.length) return null
  return (
    <Menu
      label="Record"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-label="Record" className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium bg-amber font-semibold text-ink hover:bg-amber-dark`}><Plus className="size-4" aria-hidden /><span className="hidden sm:inline" aria-hidden>Record</span></button>
      )}
      items={items}
    />
  )
}

export function AppShell() {
  const location = useLocation()
  const { active, loading } = useBusiness()
  const { statuses } = useModules()
  // The business's chosen colour theme paints the whole workspace, and the website's default comes back when leaving it.
  useEffect(() => applyTheme(themeByKey(active?.theme)), [active?.theme])
  const [refreshKey, setRefreshKey] = useState(0)
  const view = useViewPrefs()
  const mainRef = useRef<HTMLElement>(null)
  const attention = useWorkspaceAttention(active?.id ?? null, !!active?.isOwner, statuses.some((s) => s.usable && (s.code === 'inventory' || s.code === 'retail-products' || s.code === 'pharmacy-medicines')))
  useGridLabels(view.list === 'grid', mainRef)
  const panel = view.detail === 'panel'
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // The drawer is open only for the page it was opened on, so navigating closes it without an effect.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  // A record's own page replaces the content area while it is open; the page underneath stays mounted.
  const [detailNode, setDetailNode] = useState<HTMLElement | null>(null)
  const [detailOpen, setDetailOpen] = useState(0)
  const enter = useCallback(() => setDetailOpen((n) => n + 1), [])
  const leave = useCallback(() => setDetailOpen((n) => Math.max(n - 1, 0)), [])
  const detailSlot = useMemo(() => ({ node: detailNode, enter, leave, panel }), [detailNode, enter, leave, panel])
  const drawer = drawerPath === location.pathname
  const setDrawer = (open: boolean) => setDrawerPath(open ? location.pathname : null)
  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
  }

  if (loading) return <Spinner />
  if (!active) return <Navigate to="/onboarding" replace />

  const usable = new Set(statuses.filter((s) => s.usable).map((s) => s.code))
  const apps = buildApps(active.industry, usable)
  const current = findCurrentApp(apps, location.pathname)
  const isHome = location.pathname.replace(/\/$/, '') === '/app'
  const quick = buildQuickActions(active.industry, usable).map((a) => ({ label: a.label, to: a.to }))

  return (
    <div className="min-h-dvh bg-surface">
      {isDemoMode && (
        <div className="no-print flex flex-wrap items-center justify-center gap-3 border-b border-amber/40 bg-amber/20 px-4 py-1 text-xs font-medium text-ink">
          DEMO MODE: browser-only data, not a real backend.
          <button className="underline" onClick={() => { demoReset(); resetDemoInventory(); resetDemoTrade(); resetDemoCrm(); resetDemoFarm(); resetDemoMart(); resetDemoBakery(); resetDemoPharmacy(); resetDemoSchool() }}>Reset demo data</button>
        </div>
      )}
      <header className={`no-print sticky top-0 z-40 h-12 border-b-2 border-b-amber bg-gradient-to-r from-white via-[#f7fafd] to-white text-ink shadow-[0_6px_18px_-14px_rgb(11_42_74/0.35)]`}>
        <div className="flex h-full items-center gap-1 px-2 sm:px-3">
          {!isHome && (
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface lg:hidden"><MenuIcon className="size-5" aria-hidden /></button>
          )}
          <NavLink to="/app" end aria-label="Apps home" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface"><LayoutGrid className="size-5" aria-hidden /></NavLink>
          <span className="px-2 text-[15px] font-semibold">{current?.label ?? 'DOA'}</span>
          <div className="ml-auto flex items-center gap-2">
            <RefreshButton onRefresh={() => { setRefreshKey((k) => k + 1); return attention.refresh() }} />
            <AttentionBell items={attention.items} loading={attention.loading} />
            <ViewMenu />
            <RecordMenu items={quick} />
            <BusinessSwitcher />
            <UserMenu modules={[...new Map(apps.flatMap((a) => a.modules).filter((m) => ACCOUNT_MODULES.includes(m.code)).map((m) => [m.code, m])).values()]} roleLabel={active.isOwner ? 'Owner' : active.role ? active.role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Member'} />
          </div>
        </div>
      </header>

      <CrumbContext.Provider value={current?.label ?? null}>
        {isHome ? <Outlet key={`${active.id}-${refreshKey}`} /> : (
          <div className="flex">
            <aside className={`no-print sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 self-start border-r border-line bg-white transition-[width] lg:block ${collapsed ? 'w-16' : 'w-60'}`}>
              <Sidebar apps={apps} collapsed={collapsed} onToggle={toggleCollapsed} />
            </aside>
            <main ref={mainRef} data-list-view={view.list} className="min-w-0 flex-1 px-4 py-5 sm:px-6">
              <DetailSlotContext.Provider value={detailSlot}>
                <div className={panel ? 'flex items-start gap-4' : 'max-w-[1400px]'}>
                  {/* Keyed by business so no view state or data leaks across a business switch. */}
                  <div hidden={detailOpen > 0 && !panel} className={panel ? 'min-w-0 flex-1' : undefined}><Outlet key={`${active.id}-${refreshKey}`} /></div>
                  {/* Full page: the record replaces the list. Side panel: it sits beside the list and the list stays in view. */}
                  <div ref={setDetailNode} className={panel ? (detailOpen > 0 ? 'sticky top-14 max-h-[calc(100dvh-4.5rem)] w-full max-w-[46%] shrink-0 basis-[46%] overflow-y-auto' : 'hidden') : undefined} />
                </div>
              </DetailSlotContext.Provider>
            </main>
          </div>
        )}
      </CrumbContext.Provider>

      {drawer && !isHome && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-raised">
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="absolute right-2 top-2 rounded-md p-2 text-ink/60 hover:bg-surface"><X className="size-5" aria-hidden /></button>
            <div className="h-full pt-10"><Sidebar apps={apps} onNavigate={() => setDrawer(false)} /></div>
          </div>
        </div>
      )}
    </div>
  )
}
