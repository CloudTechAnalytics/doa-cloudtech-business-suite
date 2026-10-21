import clsx from 'clsx'
import { Building2, Check, ChevronsUpDown, LogOut, Menu as MenuIcon, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import type { ModuleDefinition } from '@/shared/types/domain'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { resetDemoCrm } from '@/demo/demoCrm'
import { resetDemoFarm } from '@/demo/demoFarm'
import { resetDemoInventory } from '@/demo/demoInventory'
import { resetDemoTrade } from '@/demo/demoTrade'
import { demoReset } from '@/demo/demoStore'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { INDUSTRY_TEMPLATES, MODULES } from '@/core/module-registry/registry'
import { isDemoMode } from '@/shared/utilities/env'
import { Spinner } from '@/shared/components'
import { Menu } from '@/shared/components/menu'
import { buildNavigation, buildQuickActions } from '@/app/navigation/navigation'
import { BrandLockup } from '@/app/layouts/Brand'

const initialsOf = (name: string) => name.split(/[\s@.]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

function SidebarLink({ m, onNavigate }: { m: ModuleDefinition; onNavigate?: () => void }) {
  const Icon = m.icon
  return (
    <NavLink
      to={m.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition-colors',
          isActive ? 'bg-white/10 font-medium text-white shadow-pill' : 'text-white/70 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={clsx('size-[18px] shrink-0', isActive && 'text-gold')} aria-hidden />
          {m.name}
        </>
      )}
    </NavLink>
  )
}

function BusinessSwitcher() {
  const { businesses, active, select } = useBusiness()
  if (!active) return null
  const many = businesses.length > 1
  const card = (open?: boolean) => (
    <span className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left">
      <Building2 className="size-4 shrink-0 text-gold" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{active.name}</span>
        <span className="block truncate text-xs text-white/60">{INDUSTRY_TEMPLATES[active.industry].name}</span>
      </span>
      {many && <ChevronsUpDown className={clsx('size-4 text-white/60', open && 'text-gold')} aria-hidden />}
    </span>
  )
  if (!many) return <div className="px-3">{card()}</div>
  return (
    <div className="px-3">
      <Menu
        label="Switch business" align="start"
        trigger={({ open, toggle }) => (
          <button type="button" className="w-full rounded-lg" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Switch business">{card(open)}</button>
        )}
        items={businesses.map((b) => ({
          label: b.name,
          icon: b.id === active.id ? <Check className="size-4 text-gold-ink" /> : <span className="size-4" />,
          onSelect: () => select(b.id),
        }))}
      />
      <Link to="/onboarding" className="mt-2 flex items-center gap-2 px-3 text-xs text-white/60 hover:text-white"><Plus className="size-3.5" /> Add business</Link>
    </div>
  )
}

function SidebarUser() {
  const { email, signOut } = useAuth()
  const name = email ?? 'Account'
  return (
    <Menu
      label="Account menu" align="start" side="top"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-label="Account menu" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">{initialsOf(name)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-white/80">{name}</span>
        </button>
      )}
      items={[{ label: 'Sign out', icon: <LogOut className="size-4" />, onSelect: signOut }]}
    />
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { statuses } = useModules()
  const { active } = useBusiness()
  const usable = new Set(statuses.filter((s) => s.usable).map((s) => s.code))
  const groups = active ? buildNavigation(active.industry, usable) : []
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5"><BrandLockup inverted /></div>
      <BusinessSwitcher />
      <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-6" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wide text-white/50">{g.label}</p>
            <div className="space-y-1">{g.items.map((m) => <SidebarLink key={m.code} m={m} onNavigate={onNavigate} />)}</div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-3 py-3"><SidebarUser /></div>
    </div>
  )
}

function RecordMenu({ asFab = false }: { asFab?: boolean }) {
  const { statuses } = useModules()
  const { active } = useBusiness()
  const usable = new Set(statuses.filter((s) => s.usable).map((s) => s.code))
  const items = active ? buildQuickActions(active.industry, usable).map((a) => ({ label: a.label, to: a.to })) : []
  if (!items.length) return null
  return (
    <Menu
      label="Record" side={asFab ? 'top' : 'bottom'} align={asFab ? 'start' : 'end'} items={items}
      trigger={({ toggle }) =>
        asFab ? (
          <button type="button" onClick={toggle} aria-label="Record" className="-mt-5 grid size-12 place-items-center rounded-full bg-gold text-navy shadow-raised"><Plus className="size-6" /></button>
        ) : (
          <button type="button" onClick={toggle} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-gold px-3 text-sm font-semibold text-navy hover:bg-gold-dark hover:text-white"><Plus className="size-4" /> Record</button>
        )
      }
    />
  )
}

function MobileBottomBar({ onMenu }: { onMenu: () => void }) {
  const { statuses } = useModules()
  const usable = (c: string) => statuses.some((s) => s.code === c && s.usable)
  const item = 'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-navy/60 aria-[current=page]:text-gold-ink'
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-navy/10 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick navigation">
      <NavLink to="/app/dashboard" className={item}><MODULES.dashboard.icon className="size-5" /> Home</NavLink>
      {usable('sales') ? <NavLink to="/app/sales" className={item}><MODULES.sales.icon className="size-5" /> Sales</NavLink> : <span className="flex-1" />}
      <div className="flex flex-1 items-center justify-center"><RecordMenu asFab /></div>
      {usable('inventory') ? <NavLink to="/app/inventory" className={item}><MODULES.inventory.icon className="size-5" /> Stock</NavLink> : <span className="flex-1" />}
      <button type="button" onClick={onMenu} className={item}><MenuIcon className="size-5" /> Menu</button>
    </nav>
  )
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const { active, loading } = useBusiness()

  useEffect(() => { setDrawer(false) }, [location.pathname])

  if (loading) return <Spinner />
  if (!active) return <Navigate to="/onboarding" replace />

  return (
    <div className="min-h-dvh bg-navy lg:pl-64">
      {isDemoMode && (
        <div className="no-print flex flex-wrap items-center justify-center gap-3 bg-gold px-4 py-1.5 text-xs font-semibold text-navy">
          DEMO MODE: browser-only data, not a real backend.
          <button className="underline" onClick={() => { demoReset(); resetDemoInventory(); resetDemoTrade(); resetDemoCrm(); resetDemoFarm() }}>Reset demo data</button>
        </div>
      )}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><SidebarContent /></aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-navy shadow-raised">
            <SidebarContent onNavigate={() => setDrawer(false)} />
            <button type="button" className="absolute right-2 top-4 rounded-md p-2 text-white/70 hover:bg-white/10" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="size-5" /></button>
          </div>
        </div>
      )}

      <div className="lg:py-2 lg:pr-2">
        <div className="print-full min-h-dvh bg-white lg:min-h-[calc(100dvh-1rem)] lg:rounded-xl lg:shadow-card">
          <header className="no-print sticky top-0 z-20 border-b border-navy/10 bg-white/95 lg:rounded-t-xl">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
              <button type="button" className="rounded-md p-2 text-navy hover:bg-surface lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><MenuIcon className="size-5" /></button>
              <span className="truncate font-brand text-lg font-semibold lg:hidden">{active.name}</span>
              <div className="ml-auto hidden items-center gap-2 sm:flex"><RecordMenu /></div>
            </div>
          </header>
          <main className="bg-white px-4 pb-24 pt-6 sm:px-6 lg:pb-10">
            {/* Keyed by business so no view state or data leaks across a business switch. */}
            <Outlet key={active.id} />
          </main>
        </div>
      </div>
      <MobileBottomBar onMenu={() => setDrawer(true)} />
    </div>
  )
}
