import { ChevronLeft } from 'lucide-react'

/** The round button sitting on the edge of a sidebar that folds it down to icons and back. Place it inside the sidebar's (positioned) container. */
export function EdgeToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="no-print absolute -right-3 top-5 z-40 grid size-6 place-items-center rounded-full border border-line bg-white text-ink/70 shadow-card transition hover:text-ink hover:shadow-raised"
    >
      <ChevronLeft className={`size-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  )
}
