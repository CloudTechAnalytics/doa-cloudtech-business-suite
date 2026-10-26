import { ArrowRight, ChevronDown, Menu as MenuIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { landingMenus } from '@/app/navigation/navigation'
import type { SiteMenuColumn, SiteMenuItem } from '@/app/navigation/navigation'
import { Badge } from '@/shared/components'

type Key = 'apps' | 'industries'

function Tag({ tag }: { tag: SiteMenuItem['tag'] }) {
  return tag ? <Badge tone={tag === 'Preview' ? 'info' : 'neutral'}>{tag}</Badge> : null
}

function Column({ col, onNavigate }: { col: SiteMenuColumn; onNavigate: () => void }) {
  return (
    <section aria-label={col.title} style={{ '--c': col.color } as CSSProperties}>
      <h3 className="border-b pb-1.5 text-[13px] font-bold uppercase tracking-wide" style={{ color: col.color, borderColor: `${col.color}55` }}>{col.title}</h3>
      {col.description && <p className="mt-1.5 text-xs leading-snug text-ink/60">{col.description}</p>}
      {col.items.length === 0 && !col.cta && <p className="mt-2"><Badge>Coming soon</Badge></p>}
      <ul className="mt-1.5">
        {col.items.map((it) => (
          <li key={it.label}>
            <Link to={it.to} onClick={onNavigate} title={it.blurb} className="flex items-center gap-1.5 rounded px-1.5 py-[5px] text-[13px] text-ink/80 transition-colors hover:bg-[color-mix(in_srgb,var(--c)_10%,white)] hover:text-[var(--c)]">
              {it.label}<Tag tag={it.tag} />
            </Link>
          </li>
        ))}
        {!!col.more && <li className="px-1.5 py-[5px] text-xs text-ink/50">+ {col.more} more in the app</li>}
      </ul>
      {col.cta && (
        <Link to={col.cta.to} onClick={onNavigate} className="mt-1.5 inline-flex items-center gap-1 px-1.5 text-[13px] font-semibold hover:underline" style={{ color: col.color }}>
          {col.cta.label} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  )
}

/**
 * The public site's navigation. "Apps" and "Industries" open wide panels (on click; Escape or a click outside closes)
 * built from the registries; on phones they collapse into a simple list.
 */
export function SiteNav() {
  const menus = useMemo(() => landingMenus(), [])
  const [open, setOpen] = useState<Key | null>(null)
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setMobile(false) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const close = () => { setOpen(null); setMobile(false) }
  const toggle = (k: Key) => setOpen(open === k ? null : k)

  const trigger = (k: Key, label: string) => (
    <button
      type="button" aria-haspopup="true" aria-expanded={open === k} aria-controls={`menu-${k}`}
      onClick={() => toggle(k)}
      className={`flex h-16 items-center gap-1 px-1 text-[15px] font-medium transition-colors ${open === k ? 'text-brand' : 'text-ink/80 hover:text-ink'}`}
    >
      {label}<ChevronDown className={`size-4 transition-transform ${open === k ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  )

  const panel = (k: Key, cols: SiteMenuColumn[], footer: string) => (
    <div id={`menu-${k}`} role="region" aria-label={k === 'apps' ? 'Apps' : 'Industries'} className="absolute inset-x-0 top-full z-10 max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden border-b border-line bg-white shadow-raised [animation:menu-in_160ms_ease-out]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-mint via-[#1bb6f9] to-[#fbb130]" />
      <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-6 px-6 pb-5 pt-5 md:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => <Column key={c.id} col={c} onNavigate={close} />)}
      </div>
      <div className="relative bg-gradient-to-r from-brand to-[#0f3a66] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-2 text-sm">
          <span className="text-white/80">{footer}</span>
          <Link to="/start" onClick={close} className="inline-flex items-center gap-1.5 rounded-md bg-amber px-3 py-1.5 font-bold text-ink transition hover:bg-amber-dark">Try it free <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <nav aria-label="Site" className="hidden items-center gap-7 md:flex">
        {trigger('apps', 'Apps')}
        {trigger('industries', 'Industries')}
        <Link to="/pricing" className="text-[15px] font-medium text-ink/80 hover:text-ink">Pricing</Link>
        <Link to="/help" className="text-[15px] font-medium text-ink/80 hover:text-ink">Help</Link>
        <a href="/#why" className="text-[15px] font-medium text-ink/80 hover:text-ink">Why DOA</a>
      </nav>
      <button type="button" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} onClick={() => { setMobile((m) => !m); setOpen(null) }} className="grid size-9 place-items-center rounded-md text-ink hover:bg-surface md:hidden">
        {mobile ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}
      </button>

      {open && <div aria-hidden className="fixed inset-x-0 bottom-0 top-16 z-0 bg-ink/30" onClick={close} />}
      {open === 'apps' && panel('apps', menus.apps, 'Every app is included. Modules switch on per business.')}
      {open === 'industries' && panel('industries', menus.industries, 'Run more than one business? Pick them all.')}

      {mobile && (
        <div className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-white px-4 py-3 shadow-raised md:hidden">
          {([['Apps', menus.apps], ['Industries', menus.industries]] as const).map(([label, cols]) => (
            <details key={label} className="border-b border-line py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-base font-semibold">{label}<ChevronDown className="size-4" aria-hidden /></summary>
              <div className="space-y-4 pb-3">{cols.map((c) => <Column key={c.id} col={c} onNavigate={close} />)}</div>
            </details>
          ))}
          <Link to="/pricing" onClick={close} className="block border-b border-line py-3 text-base font-semibold">Pricing</Link>
          <Link to="/help" onClick={close} className="block border-b border-line py-3 text-base font-semibold">Help</Link>
          <a href="/#why" onClick={close} className="block py-3 text-base font-semibold">Why DOA</a>
        </div>
      )}
    </div>
  )
}
