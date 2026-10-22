import { ArrowLeft, Pencil } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from './dialog'

/** The app shell provides the place a detail page is drawn: it replaces the page's content area and the page underneath stays alive (and keeps its filters and scroll data). */
export interface DetailSlot { node: HTMLElement | null; enter: () => void; leave: () => void }
export const DetailSlotContext = createContext<DetailSlot | null>(null)

/**
 * A record's own page: opens in place of the list, with a Back button, and closes back to it. Used for a record's details,
 * and for the forms that create or edit one. With `view`, an existing record opens to read (fields shown as plain text, no Save button)
 * and an Edit button switches the same page to the form; without it (a new record, or an action) the form is open at once.
 * With `modal` (adding a record, or a quick action) it is a floating box instead: adding is a small job done over the list, while
 * reading a record deserves a page. Outside the app shell (no slot) it also falls back to a dialog.
 */
export function DetailPage({ title, onClose, children, wide = false, view = false, modal = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; view?: boolean; modal?: boolean }) {
  const slot = useContext(DetailSlotContext)
  const asBox = modal
  const [editing, setEditing] = useState(!view)
  const reading = view && !editing
  useLayoutEffect(() => {
    if (asBox) return
    slot?.enter()
    window.scrollTo(0, 0)
    return () => slot?.leave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (asBox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const shown = reading ? title.replace(/^(Edit|Rename) /, '') : title
  if (asBox || !slot?.node) return <Dialog title={shown} onClose={onClose} wide={wide}>{children}</Dialog>
  return createPortal(
    <section aria-label={title} className="pb-10">
      <button type="button" onClick={onClose} className="no-print mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-ink/70 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <div className={`rounded-lg border border-line bg-white p-5 shadow-card sm:p-6 ${wide ? '' : 'max-w-3xl'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold">{shown}</h1>
          {reading && <button type="button" onClick={() => setEditing(true)} className="no-print inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface"><Pencil className="size-4" aria-hidden /> Edit</button>}
        </div>
        <fieldset disabled={reading} className={reading ? 'record-read' : undefined}>{children}</fieldset>
      </div>
    </section>,
    slot.node,
  )
}
