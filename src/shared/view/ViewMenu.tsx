import { Check, PanelRight, SlidersHorizontal } from 'lucide-react'
import { Menu } from '@/shared/components/menu'
import type { MenuItem } from '@/shared/components/menu'
import { setViewPrefs, useViewPrefs } from './viewPrefs'

const tick = (on: boolean) => (on ? <Check className="size-4 text-accent" aria-hidden /> : <span className="size-4" aria-hidden />)

/** "View" button: how lists are drawn (table or cards) and where a record opens (full page or a side panel). */
export function ViewMenu({ detail = true }: { detail?: boolean }) {
  const { list, detail: det } = useViewPrefs()
  const items: MenuItem[] = [
    { label: 'Show lists as', heading: true },
    { label: 'Table', icon: tick(list === 'table'), onSelect: () => setViewPrefs({ list: 'table' }) },
    { label: 'Cards', icon: tick(list === 'grid'), onSelect: () => setViewPrefs({ list: 'grid' }) },
    ...(detail ? [
      { label: 'Open a record in', heading: true, divider: true } as MenuItem,
      { label: 'Full page', icon: tick(det === 'page'), onSelect: () => setViewPrefs({ detail: 'page' }) },
      { label: 'Side panel', icon: tick(det === 'panel'), onSelect: () => setViewPrefs({ detail: 'panel' }) },
    ] : []),
  ]
  return (
    <Menu
      label="View options"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-label="View options" title="View: show lists as a table or cards, and open records as a full page or a side panel" className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink/70 hover:bg-surface hover:text-ink">
          {det === 'panel' && detail ? <PanelRight className="size-[18px]" aria-hidden /> : <SlidersHorizontal className="size-[18px]" aria-hidden />}
          <span className="hidden xl:inline">View</span>
        </button>
      )}
      items={items}
    />
  )
}
