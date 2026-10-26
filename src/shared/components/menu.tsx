import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

export interface MenuItem { label: string; to?: string; onSelect?: () => void; icon?: ReactNode; /** A non-interactive label row. */ heading?: boolean; /** Draws a divider above the item. */ divider?: boolean }

/**
 * Small popover menu: closes on outside click, Escape, scrolling and selection. The popover is drawn on the page itself (not inside the
 * element that holds the button), so a table or card with its own scrolling can never clip it; it opens above the button when there is no room below.
 */
export function Menu({ trigger, items, align = 'end', side = 'bottom', label }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) { setStyle(null); return }
    const button = ref.current?.getBoundingClientRect(); const box = popover.current?.getBoundingClientRect()
    if (!button || !box) return
    const below = window.innerHeight - button.bottom - 8
    const above = button.top - 8
    const up = side === 'top' ? box.height <= above || above >= below : box.height > below && above > below
    const left = align === 'end' ? Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8)) : Math.max(8, Math.min(button.left, window.innerWidth - box.width - 8))
    setStyle({ position: 'fixed', left, top: up ? Math.max(8, button.top - box.height - 8) : button.bottom + 8, maxHeight: `${Math.max(up ? above : below, 160)}px`, overflowY: 'auto' })
  }, [open, align, side, items.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !popover.current?.contains(t)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    const onScroll = (e: Event) => { if (!popover.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true) }
  }, [open])

  const cls = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface'
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && createPortal(
        <div
          ref={popover} role="menu" aria-label={label}
          style={style ?? { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
          className="z-[60] min-w-48 rounded-lg border border-line bg-white p-1 text-ink shadow-raised"
        >
          {items.map((it) => (
            <div key={it.label} className={it.divider ? 'mt-1 border-t border-line pt-1' : undefined}>
              {it.heading ? (
                <div className="truncate px-3 py-2 text-xs text-ink/60">{it.label}</div>
              ) : it.to ? (
                <Link role="menuitem" to={it.to} className={cls} onClick={() => setOpen(false)}>{it.icon}{it.label}</Link>
              ) : (
                <button role="menuitem" className={cls} onClick={() => { setOpen(false); it.onSelect?.() }}>{it.icon}{it.label}</button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
