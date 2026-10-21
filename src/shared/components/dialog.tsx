import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

/** Modal dialog: Escape and backdrop close it; content scrolls on small screens. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="no-print absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-raised sm:rounded-xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="no-print mb-4 flex items-start justify-between gap-3">
          <h2 className="font-brand text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-navy/60 hover:bg-surface"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
