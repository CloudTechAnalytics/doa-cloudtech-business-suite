import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * In card view a table row becomes a card, so each cell needs to say what it is. This copies each column heading onto the cells under it
 * (as data-label) for as long as card view is on, and keeps up as lists load or change.
 */
export function useGridLabels(on: boolean, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!on || !el) return
    let frame = 0
    const label = () => {
      frame = 0
      el.querySelectorAll('table').forEach((table) => {
        const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent?.trim() ?? '')
        if (!heads.length) return
        table.querySelectorAll('tbody tr').forEach((row) => {
          ;[...row.children].forEach((cell, i) => { if (heads[i] && (cell as HTMLElement).dataset.label !== heads[i]) (cell as HTMLElement).dataset.label = heads[i] })
        })
      })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(label) }
    label()
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true })
    return () => { mo.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [on, root])
}
