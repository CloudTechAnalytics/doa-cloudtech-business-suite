import { ArrowRight, ChevronDown, Menu as MenuIcon, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
    <section aria-label={col.title} className="rounded-2xl bg-white/70 p-4 ring-1 ring-line/70 transition duration-200 hover:bg-white hover:shadow-card" style={{ '--c': col.color } as CSSProperties}>
      <div className="flex items-center gap-2.5 border-b pb-2.5" style={{ borderColor: `${col.color}40` }}>
        <span className="grid size-7 place-items-center rounded-md text-white" style={{ background: col.color }}><col.icon className="size-4" aria-hidden strokeWidth={2} /></span>
        <h3 className="text-[15px] font-bold text-ink">{col.title}</h3>
      </div>
      {col.description && <p className="mt-2 text-[13px] leading-snug text-ink/60">{col.description}</p>}
      {col.items.length === 0 && !col.cta && <p className="mt-3"><Badge>Coming soon</Badge></p>}
      <ul className="mt-2 space-y-0.5">
        {col.items.map((it) => (
          <li key={it.label}>
            <Link to={it.to} onClick={onNavigate} title={it.blurb} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition duration-150 hover:translate-x-0.5 hover:bg-[color-mix(in_srgb,var(--c)_12%,white)]">
              <it.icon className="size-4 shrink-0 text-ink/40 transition-colors group-hover:text-[var(--c)]" aria-hidden />
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-ink">{it.label}<Tag tag={it.tag} /></span>
            </Link>
          </li>
        ))}
      </ul>
      {col.cta && (
        <Link to={col.cta.to} onClick={onNavigate} className="mt-3 inline-flex items-center gap-1 px-2 text-sm font-semibold hover:underline" style={{ color: col.color }}>
          {col.cta.label} <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </section>
  )
}

/**
 * The public site's navigation. "Apps" and "Industries" open wide panels (on hover or click, Escape closes)
 * built from the registries; on phones they collapse into a simple list.
 */
export function SiteNav() {
  const menus = useMemo(() => landingMenus(), [])
  const [open, setOpen] = useState<Key | null>(null)
  const [mobile, setMobile] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hoveredAt = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setMobile(false) } }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(timer.current) }
  }, [])

  const close = () => { setOpen(null); setMobile(false) }
  const hoverOpen = (k: Key, at: number) => { clearTimeout(timer.current); hoveredAt.current = at; setOpen(k) }
  const hoverClose = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(null), 160) }
  // A tap fires mouseenter then click; ignore the click so it does not immediately close what the tap opened.
  const click = (k: Key, at: number) => setOpen(open === k && at - hoveredAt.current > 400 ? null : k)

  const trigger = (k: Key, label: string) => (
    <button
      type="button" aria-haspopup="true" aria-expanded={open === k} aria-controls={`menu-${k}`}
      onMouseEnter={(e) => hoverOpen(k, e.timeStamp)} onClick={(e) => click(k, e.timeStamp)}
      className={`flex h-16 items-center gap-1 px-1 text-[15px] font-medium transition-colors ${open === k ? 'text-brand' : 'text-ink/80 hover:text-ink'}`}
    >
      {label}<ChevronDown className={`size-4 transition-transform ${open === k ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  )

  const panel = (k: Key, cols: SiteMenuColumn[], footer: string) => (
    <div id={`menu-${k}`} role="region" aria-label={k === 'apps' ? 'Apps' : 'Industries'} className="absolute inset-x-0 top-full z-10 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-gradient-to-b from-[#f4f8fc] via-white to-[#eef4fa] shadow-raised [animation:menu-in_160ms_ease-out]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-mint via-[#1bb6f9] to-[#fbb130]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-mint/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-20 size-72 rounded-full bg-[#fbb130]/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-4 px-6 pb-6 pt-6 md:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => <Column key={c.id} col={c} onNavigate={close} />)}
      </div>
      <div className="relative bg-gradient-to-r from-brand to-[#0f3a66] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
          <span className="text-white/80">{footer}</span>
          <Link to="/start" onClick={close} className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 font-semibold text-white transition hover:bg-white/20">Try it free <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </div>
    </div>
  )

  return (
    <div onMouseLeave={hoverClose} onMouseEnter={() => clearTimeout(timer.current)}>
      <nav aria-label="Site" className="hidden items-center gap-7 md:flex">
        {trigger('apps', 'Apps')}
        {trigger('industries', 'Industries')}
        <a href="#why" className="text-[15px] font-medium text-ink/80 hover:text-ink">Why DOA</a>
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
              <div className="space-y-5 pb-3">{cols.map((c) => <Column key={c.id} col={c} onNavigate={close} />)}</div>
            </details>
          ))}
          <a href="#why" onClick={close} className="block py-3 text-base font-semibold">Why DOA</a>
        </div>
      )}
    </div>
  )
}
