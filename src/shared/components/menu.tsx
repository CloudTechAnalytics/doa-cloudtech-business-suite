import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface MenuItem { label: string; to?: string; onSelect?: () => void; icon?: ReactNode }

/** Small popover menu: closes on outside click, Escape and selection. */
export function Menu({ trigger, items, align = 'end', side = 'bottom', label }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  label: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const cls = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-navy hover:bg-surface'
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu" aria-label={label}
          className={`absolute z-50 min-w-48 rounded-lg border border-navy/10 bg-white p-1 shadow-raised ${align === 'end' ? 'right-0' : 'left-0'} ${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {items.map((it) =>
            it.to ? (
              <Link key={it.label} role="menuitem" to={it.to} className={cls} onClick={() => setOpen(false)}>{it.icon}{it.label}</Link>
            ) : (
              <button key={it.label} role="menuitem" className={cls} onClick={() => { setOpen(false); it.onSelect?.() }}>{it.icon}{it.label}</button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
