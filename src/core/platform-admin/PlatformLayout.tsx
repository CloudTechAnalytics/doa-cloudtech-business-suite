import { Activity, Building2, CreditCard, HeartPulse, LayoutDashboard, LayoutGrid, Menu as MenuIcon, ScrollText, ShieldCheck, Tag, Users, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { BrandMark, Wordmark } from '@/app/layouts/Brand'
import { Notice, Spinner } from '@/shared/components'
import { AccountMenu, AttentionBell, RefreshButton } from '@/shared/topbar/TopBar'
import { EdgeToggle } from '@/shared/topbar/EdgeToggle'
import { useGridLabels } from '@/shared/view/useGridLabels'
import { isDemoMode } from '@/shared/utilities/env'
import { resetDemoPlatform } from '@/demo/demoPlatform'
import { PlatformContext, usePlatformAttention, usePlatformRole } from './platformUi'

const NAV = [
  { heading: 'Overview', items: [{ to: '/platform', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { heading: 'Tenancy', items: [{ to: '/platform/businesses', label: 'Businesses', icon: Building2 }, { to: '/platform/users', label: 'Users', icon: Users }, { to: '/platform/subscriptions', label: 'Subscriptions', icon: CreditCard }] },
  { heading: 'Configuration', items: [{ to: '/platform/plans', label: 'Plans & Pricing', icon: Tag }, { to: '/platform/team', label: 'Platform Team', icon: ShieldCheck }] },
  { heading: 'Operations', items: [{ to: '/platform/audit', label: 'Audit Log', icon: ScrollText }, { to: '/platform/health', label: 'System Health', icon: HeartPulse }] },
]

/** The platform console shell. Only people on the platform team get past it; everyone else is sent back to their own businesses. */
export function PlatformLayout() {
  const role = usePlatformRole()
  const attention = usePlatformAttention()
  const [open, setOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  useGridLabels(true, mainRef) // tables become cards on a phone, so each cell needs its column heading
  const [refreshKey, setRefreshKey] = useState(0)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('doa.platform.collapsed') === '1' } catch { return false } })
  const toggle = () => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem('doa.platform.collapsed', next ? '1' : '0') } catch { /* storage unavailable */ } }
  if (role.loading) return <Spinner />
  if (!role.data) return <Navigate to="/businesses" replace />
  const ctx = { role: role.data, canWrite: role.data !== 'support', isOwner: role.data === 'owner' }

  // On a wide screen the sidebar can fold down to icons; in the phone drawer it is always the full one.
  const nav = (folded: boolean) => (
    <nav aria-label="Platform" className="flex h-full flex-col bg-brand text-white">
      <Link to="/platform" onClick={() => setOpen(false)} aria-label="DOA platform home" className={`flex items-center py-5 ${folded ? 'justify-center' : 'px-5'}`}>{folded ? <BrandMark className="size-8" /> : <Wordmark light className="h-6" />}</Link>
      <div className={`flex-1 space-y-5 overflow-y-auto pb-4 ${folded ? 'px-2' : 'px-3'}`}>
        {NAV.map((g) => (
          <div key={g.heading}>
            {folded ? <hr className="mx-3 mb-2 border-white/10" /> : <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g.heading}</p>}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={'end' in it && it.end} onClick={() => setOpen(false)} title={folded ? it.label : undefined} aria-label={folded ? it.label : undefined} className={({ isActive }) => `flex items-center rounded-lg py-2 text-sm font-medium transition ${folded ? 'justify-center px-0' : 'gap-3 px-3'} ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/8 hover:text-white'}`}>
                <it.icon className="size-[18px]" aria-hidden />{!folded && it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <PlatformContext.Provider value={ctx}>
      <div className="min-h-dvh bg-surface text-ink">
        <aside className={`fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 lg:block ${collapsed ? 'w-16' : 'w-60'}`}>{nav(collapsed)}<EdgeToggle collapsed={collapsed} onToggle={toggle} /></aside>
        {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} /><div className="absolute inset-y-0 left-0 w-64">{nav(false)}</div></div>}
        <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-60'}`}>
          {isDemoMode && <div className="bg-amber/25 px-4 py-1 text-center text-xs font-medium">DEMO MODE: browser-only data. <button className="underline" onClick={() => { resetDemoPlatform(); location.reload() }}>Reset console data</button></div>}
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-3">
              <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-md hover:bg-surface lg:hidden">{open ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}</button>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink/70"><Activity className="size-4 text-amber-dark" aria-hidden />Platform console</span>
            </div>
            <div className="flex items-center gap-1">
              <RefreshButton onRefresh={() => { setRefreshKey((k) => k + 1); return attention.refresh() }} />
              <AttentionBell items={attention.items} loading={attention.loading} />
              <AccountMenu roleLabel={`Platform ${role.data}`} emailSubtitle extra={[{ label: 'My businesses', to: '/businesses', icon: <LayoutGrid className="size-4" /> }, { label: 'Platform team', to: '/platform/team', icon: <ShieldCheck className="size-4" /> }]} />
            </div>
          </header>
          <main ref={mainRef} className="px-4 py-6 sm:px-6">
            {role.data === 'support' && <div className="mb-4"><Notice>You have read-only access. Ask a platform engineer or owner to make changes.</Notice></div>}
            <Outlet key={refreshKey} />
          </main>
        </div>
      </div>
    </PlatformContext.Provider>
  )
}
