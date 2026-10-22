import { ArrowLeft } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from './dialog'

/** The app shell provides the place a detail page is drawn: it replaces the page's content area and the page underneath stays alive (and keeps its filters and scroll data). */
export interface DetailSlot { node: HTMLElement | null; enter: () => void; leave: () => void }
export const DetailSlotContext = createContext<DetailSlot | null>(null)

/**
 * A record's own page: opens in place of the list, with a Back button, and closes back to it. Used for a record's details,
 * and for the forms that create or edit one. Outside the app shell (no slot) it falls back to a dialog.
 */
export function DetailPage({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const slot = useContext(DetailSlotContext)
  useLayoutEffect(() => {
    slot?.enter()
    window.scrollTo(0, 0)
    return () => slot?.leave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!slot?.node) return <Dialog title={title} onClose={onClose} wide={wide}>{children}</Dialog>
  return createPortal(
    <section aria-label={title} className="pb-10">
      <button type="button" onClick={onClose} className="no-print mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-ink/70 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <div className={`rounded-lg border border-line bg-white p-5 shadow-card sm:p-6 ${wide ? '' : 'max-w-3xl'}`}>
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </section>,
    slot.node,
  )
}
