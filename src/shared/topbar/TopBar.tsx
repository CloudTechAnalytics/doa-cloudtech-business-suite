import { Bell, ChevronDown, LogOut, RefreshCw, UserCircle } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useProfile } from '@/core/auth/useProfile'
import { Menu } from '@/shared/components/menu'
import type { MenuItem } from '@/shared/components/menu'

/** One thing that needs a person's attention, with where to go to deal with it. */
export interface Attention { key: string; label: string; detail?: string; to: string; tone?: 'warn' | 'bad' | 'info' }

const iconButton = 'relative grid size-9 place-items-center rounded-md text-ink/70 transition hover:bg-surface hover:text-ink'

/** Reloads what is on the page. The spin lasts as long as the reload takes (at least a moment, so it is clear something happened). */
export function RefreshButton({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const [spinning, setSpinning] = useState(false)
  async function go() {
    setSpinning(true)
    await Promise.all([Promise.resolve(onRefresh()), new Promise((r) => setTimeout(r, 600))])
    setSpinning(false)
  }
  return <button type="button" onClick={() => void go()} aria-label="Refresh this page" title="Refresh" className={iconButton}><RefreshCw className={`size-[18px] ${spinning ? 'animate-spin' : ''}`} aria-hidden /></button>
}

/** The bell: a count of real things that need attention, and a list of them. It shows no count (and says so) when there is nothing. */
export function AttentionBell({ items, loading }: { items: Attention[]; loading?: boolean }) {
  const tones = { warn: 'bg-amber-dark', bad: 'bg-danger', info: 'bg-accent' } as const
  const menu: MenuItem[] = [
    { label: 'Needs attention', heading: true },
    ...(items.length
      ? items.map((i): MenuItem => ({ label: i.label, to: i.to, icon: <span className={`size-2 rounded-full ${tones[i.tone ?? 'warn']}`} aria-hidden />, custom: <span className="min-w-0"><span className="block truncate font-medium">{i.label}</span>{i.detail && <span className="block truncate text-xs text-ink/60">{i.detail}</span>}</span> }))
      : [{ label: loading ? 'Checking…' : 'Nothing needs attention right now.', heading: true } as MenuItem]),
  ]
  return (
    <Menu
      label="Notifications"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-label={items.length ? `${items.length} things need attention` : 'Notifications'} title="Notifications" className={iconButton}>
          <Bell className="size-[18px]" aria-hidden />
          {items.length > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{items.length}</span>}
        </button>
      )}
      items={menu}
    />
  )
}

/** The person at the top right: their initials, name and role, and a menu with their profile, anything extra for this area, and sign out. */
export function AccountMenu({ roleLabel, extra = [], emailSubtitle = false }: { roleLabel: string; extra?: MenuItem[]; emailSubtitle?: boolean }) {
  const { signOut } = useAuth()
  const p = useProfile()
  const items: MenuItem[] = [
    { label: p.name, heading: true, custom: <span className="block min-w-0 px-0.5 py-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-ink/60">{p.email}</span><span className="mt-1.5 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">{roleLabel}</span></span> },
    { label: 'Profile', to: '/account', icon: <UserCircle className="size-4" />, divider: true },
    ...extra,
    { label: 'Sign out', icon: <LogOut className="size-4 text-danger" />, onSelect: signOut, divider: true },
  ]
  return (
    <Menu
      label="Account menu"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-label="Account menu" className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 text-left transition hover:bg-surface">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden>{p.initials}</span>
          <span className="hidden min-w-0 leading-tight sm:block"><span className="block max-w-40 truncate text-sm font-semibold">{p.name}</span><span className="block max-w-40 truncate text-xs text-ink/60">{emailSubtitle ? p.email : roleLabel}</span></span>
          <ChevronDown className="hidden size-4 text-ink/50 sm:block" aria-hidden />
        </button>
      )}
      items={items}
    />
  )
}

