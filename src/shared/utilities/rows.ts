import type { MouseEvent } from 'react'

/** Lets a whole table row open the record: clicking anywhere on it presses the row's Edit or Rename button (clicks on buttons, links and inputs keep their own meaning). */
export function openRow(e: MouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
  e.currentTarget.querySelector<HTMLButtonElement>('button[aria-label^="Edit"], button[aria-label^="Rename"]')?.click()
}
