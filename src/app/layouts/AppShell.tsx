import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronsUpDown, LayoutGrid, Menu as MenuIcon, Plus, ShieldCheck, X } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ACCOUNT_MODULES, appPath, buildApps, buildQuickActions, findCurrentApp } from '@/app/navigation/navigation'
import { breadcrumb, pageIndex } from '@/app/navigation/crumbs'
import { GlobalSearch } from './GlobalSearch'
import type { ModuleDefinition } from '@/shared/types/domain'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { usePlatformRole } from '@/core/platform-admin/platformUi'
import { resetDemoBakery } from '@/demo/demoBakery'
import { resetDemoCalendar } from '@/demo/demoCalendar'
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
import { EdgeToggle } from '@/shared/topbar/EdgeToggle'
import { useWorkspaceAttention } from './useWorkspaceAttention'
import { useGridLabels } from '@/shared/view/useGridLabels'
import { useViewPrefs } from '@/shared/view/viewPrefs'
import { resetDemoTrade } from '@/demo/demoTrade'
import { AccessSuspended } from './AccessSuspended'
import { getIndustry } from '@/core/industry-registry'
import { Spinner } from '@/shared/components'
import { CrumbContext } from '@/shared/components/breadcrumb'
import { DetailSlotContext } from '@/shared/components/detail-page'
import { Menu } from '@/shared/components/menu'
import { isDemoMode } from '@/shared/utilities/env'
import { Sidebar } from './Sidebar'
import { ChunkErrorBoundary } from '@/shared/components/ChunkErrorBoundary'

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
          className="flex h-10 max-w-[15rem] items-center gap-2.5 rounded-lg border border-line bg-white pl-1.5 pr-2 text-ink transition hover:border-ink/25 hover:bg-surface">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-xs font-bold text-white">{active.name.trim().charAt(0).toUpperCase() || '?'}</span>
          <span className="hidden min-w-0 text-left leading-tight sm:block"><span className="block text-[10px] font-medium uppercase tracking-wide text-ink/50">Business</span><span className="block truncate text-sm font-semibold">{active.name}</span></span>
          <ChevronsUpDown className="size-4 shrink-0 text-ink/50" aria-hidden />
        </button>
      )}
      items={[
        { label: 'Switch business', heading: true },
        ...businesses.map((b) => ({ label: b.name, icon: b.id === active.id ? <Check className="size-4 text-brand" /> : <span className="size-4" />, onSelect: () => select(b.id) })),
        { label: 'All businesses', to: '/businesses', icon: <LayoutGrid className="size-4" />, divider: true },
        { label: 'Add another business', to: '/onboarding', icon: <Plus className="size-4" /> },
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
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-label="Record" className="flex h-9 items-center justify-center gap-2 rounded-lg bg-amber px-3 text-sm font-semibold text-ink shadow-pill transition hover:bg-amber-dark sm:min-w-[8.5rem] sm:px-4"><Plus className="size-4" aria-hidden /><span className="hidden sm:inline" aria-hidden>Record</span><ChevronDown className="hidden size-4 opacity-60 sm:block" aria-hidden /></button>
      )}
      items={items}
    />
  )
}

export function AppShell() {
  const location = useLocation()
  const { active, loading, blocked } = useBusiness()
  const { statuses } = useModules()
  // The business's chosen colour theme paints the whole workspace, and the website's default comes back when leaving it.
  useEffect(() => applyTheme(themeByKey(active?.theme)), [active?.theme])
  const [refreshKey, setRefreshKey] = useState(0)
  // Some kinds of business word their menus differently (an online school says Courses); looked up again as the person moves about, so a change in Settings shows up.
  const [menuNames, setMenuNames] = useState<Record<string, string>>({})
  const namesFor = active ? `${active.id}|${active.industry}` : ''
  useEffect(() => {
    if (!active) return
    const lookup = getIndustry(active.industry).moduleLabels
    let live = true
    if (lookup) void lookup(active.id).then((l) => { if (live) setMenuNames(l) }).catch(() => undefined)
    else setMenuNames({})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesFor, location.pathname])
  const view = useViewPrefs()
  const mainRef = useRef<HTMLElement>(null)
  const attention = useWorkspaceAttention(active?.id ?? null, !!active?.isOwner, statuses.some((s) => s.usable && (s.code === 'inventory' || s.code === 'retail-products' || s.code === 'pharmacy-medicines')), statuses.some((s) => s.usable && s.code === 'calendar'))
  useGridLabels(true, mainRef) // card view and the phone layout both read the column headings off each cell
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
  if (!active && blocked.length) return <AccessSuspended blocked={blocked} />
  if (!active) return <Navigate to="/onboarding" replace />

  const usable = new Set(statuses.filter((s) => s.usable).map((s) => s.code))
  const apps = buildApps(active.industry, usable).map((a) => ({ ...a, modules: a.modules.map((m) => (menuNames[m.code] ? { ...m, name: menuNames[m.code] } : m)) }))
  const current = findCurrentApp(apps, location.pathname)
  const isHome = location.pathname.replace(/\/$/, '') === '/app'
  const quick = buildQuickActions(active.industry, usable).map((a) => ({ label: a.label, to: a.to }))
  const trail = breadcrumb(apps, location.pathname, location.search)

  return (
    <div className="min-h-dvh bg-surface" style={{ ['--side-w' as string]: isHome ? '0px' : collapsed ? '4rem' : '15rem' }}>
      {isDemoMode && (
        <div className="no-print flex flex-wrap items-center justify-center gap-3 border-b border-amber/40 bg-amber/20 px-4 py-1 text-xs font-medium text-ink">
          DEMO MODE: browser-only data, not a real backend.
          <button className="underline" onClick={() => { demoReset(); resetDemoInventory(); resetDemoTrade(); resetDemoCrm(); resetDemoFarm(); resetDemoMart(); resetDemoBakery(); resetDemoPharmacy(); resetDemoSchool(); resetDemoCalendar() }}>Reset demo data</button>
        </div>
      )}
      <header className={`no-print sticky top-0 z-40 h-12 border-b border-b-line bg-gradient-to-r from-white via-[#f7fafd] to-white text-ink shadow-[0_6px_18px_-14px_rgb(11_42_74/0.35)]`}>
        <div className="flex h-full items-center gap-1 px-2 sm:px-3">
          {!isHome && (
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface lg:hidden"><MenuIcon className="size-5" aria-hidden /></button>
          )}
          <NavLink to="/app" end aria-label="Apps home" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-surface"><LayoutGrid className="size-5" aria-hidden /></NavLink>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center px-2 text-[15px] max-[380px]:hidden lg:w-[max(9rem,calc(var(--side-w)-2rem))] lg:flex-none">
            <ol className="flex min-w-0 items-center gap-1.5">
              {trail.map((c, i) => {
                const last = i === trail.length - 1
                return (
                  <li key={`${c.label}-${i}`} className={`flex min-w-0 items-center gap-1.5 ${last ? '' : 'max-md:hidden'}`}>
                    {i > 0 && <span aria-hidden className="text-ink/30 max-md:hidden">/</span>}
                    {c.to ? <Link to={c.to} className="truncate text-ink/60 hover:text-ink hover:underline">{c.label}</Link> : <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-semibold' : 'text-ink/60'}`}>{c.label}</span>}
                  </li>
                )
              })}
            </ol>
          </nav>
          {/* The search takes the middle of the bar, so it sits straight above the page content. */}
          <GlobalSearch businessId={active.id} industry={active.industry} usable={usable} pages={pageIndex(apps, quick)} />
          <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:gap-2">
            {/* On a phone the bar keeps only what is used all the time; refresh and the list style are for bigger screens (a phone pulls down to refresh, and always shows cards). */}
            <div className="hidden sm:contents"><RefreshButton onRefresh={() => { setRefreshKey((k) => k + 1); return attention.refresh() }} /></div>
            <AttentionBell items={attention.items} loading={attention.loading} />
            <div className="hidden sm:contents"><ViewMenu /></div>
            <RecordMenu items={quick} />
            <BusinessSwitcher />
            <UserMenu modules={[...new Map(apps.flatMap((a) => a.modules).filter((m) => ACCOUNT_MODULES.includes(m.code)).map((m) => [m.code, m])).values()]} roleLabel={active.isOwner ? 'Owner' : active.role ? active.role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Member'} />
          </div>
        </div>
      </header>

      <CrumbContext.Provider value={current?.label ?? null}>
        {isHome ? <ChunkErrorBoundary><Outlet key={`${active.id}-${refreshKey}`} /></ChunkErrorBoundary> : (
          <div className="flex">
            <aside className={`no-print sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 self-start border-r border-line bg-white transition-[width] lg:block ${collapsed ? 'w-16' : 'w-60'}`}>
              <Sidebar apps={apps} collapsed={collapsed} />
              <EdgeToggle collapsed={collapsed} onToggle={toggleCollapsed} />
            </aside>
            <main ref={mainRef} data-list-view={view.list} className="min-w-0 flex-1 px-4 py-5 sm:px-6">
              <DetailSlotContext.Provider value={detailSlot}>
                <div className={panel ? 'flex items-start gap-4' : 'max-w-[1400px]'}>
                  {/* Keyed by business so no view state or data leaks across a business switch. */}
                  <div hidden={detailOpen > 0 && !panel} className={panel ? 'min-w-0 flex-1' : undefined}><ChunkErrorBoundary><Outlet key={`${active.id}-${refreshKey}`} /></ChunkErrorBoundary></div>
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
