import { Activity, Building2, CreditCard, HeartPulse, LayoutDashboard, LogOut, Menu as MenuIcon, ScrollText, ShieldCheck, Tag, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { BrandMark } from '@/app/layouts/Brand'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Notice, Spinner } from '@/shared/components'
import { isDemoMode } from '@/shared/utilities/env'
import { resetDemoPlatform } from '@/demo/demoPlatform'
import { PlatformContext, usePlatformRole } from './platformUi'

const NAV = [
  { heading: 'Overview', items: [{ to: '/platform', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { heading: 'Tenancy', items: [{ to: '/platform/businesses', label: 'Businesses', icon: Building2 }, { to: '/platform/users', label: 'Users', icon: Users }, { to: '/platform/subscriptions', label: 'Subscriptions', icon: CreditCard }] },
  { heading: 'Configuration', items: [{ to: '/platform/plans', label: 'Plans & Pricing', icon: Tag }, { to: '/platform/team', label: 'Platform Team', icon: ShieldCheck }] },
  { heading: 'Operations', items: [{ to: '/platform/audit', label: 'Audit Log', icon: ScrollText }, { to: '/platform/health', label: 'System Health', icon: HeartPulse }] },
]

/** The platform console shell. Only people on the platform team get past it; everyone else is sent back to their own businesses. */
export function PlatformLayout() {
  const { email, signOut } = useAuth()
  const role = usePlatformRole()
  const [open, setOpen] = useState(false)
  if (role.loading) return <Spinner />
  if (!role.data) return <Navigate to="/businesses" replace />
  const ctx = { role: role.data, canWrite: role.data !== 'support', isOwner: role.data === 'owner' }

  const sidebar = (
    <nav aria-label="Platform" className="flex h-full flex-col bg-[#071b33] text-white">
      <Link to="/platform" onClick={() => setOpen(false)} className="flex items-center gap-3 px-5 py-5"><BrandMark className="size-9" /><span><span className="block text-[17px] font-extrabold leading-tight">DOA</span><span className="block text-[11px] text-white/60">Platform console</span></span></Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.heading}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g.heading}</p>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={'end' in it && it.end} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/8 hover:text-white'}`}>
                <it.icon className="size-[18px]" aria-hidden />{it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-5 py-3 text-xs text-white/50">Platform console</div>
    </nav>
  )

  return (
    <PlatformContext.Provider value={ctx}>
      <div className="min-h-dvh bg-surface text-ink">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar}</aside>
        {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} /><div className="absolute inset-y-0 left-0 w-64">{sidebar}</div></div>}
        <div className="lg:pl-60">
          {isDemoMode && <div className="bg-amber/25 px-4 py-1 text-center text-xs font-medium">DEMO MODE: browser-only data. <button className="underline" onClick={() => { resetDemoPlatform(); location.reload() }}>Reset console data</button></div>}
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-3">
              <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-md hover:bg-surface lg:hidden">{open ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}</button>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink/70"><Activity className="size-4 text-amber-dark" aria-hidden />Platform console</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link to="/businesses" className="hidden text-ink/70 hover:text-ink sm:inline">My businesses</Link>
              <span className="hidden text-ink/60 sm:inline">{email}</span><Badge tone={role.data === 'support' ? 'neutral' : 'info'}>{role.data}</Badge>
              <button type="button" onClick={signOut} aria-label="Sign out" className="grid size-9 place-items-center rounded-md text-ink/70 hover:bg-surface hover:text-ink"><LogOut className="size-[18px]" aria-hidden /></button>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            {role.data === 'support' && <div className="mb-4"><Notice>You have read-only access. Ask a platform engineer or owner to make changes.</Notice></div>}
            <Outlet />
          </main>
        </div>
      </div>
    </PlatformContext.Provider>
  )
}
